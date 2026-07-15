package com.mcecosystem.eventcollector;

import java.io.File;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.logging.Logger;

/**
 * Buffer local en SQLite para eventos que no pudieron entregarse a la API.
 * Escriben los hilos del HttpClient (fallos) y lee/borra el hilo del
 * scheduler: todos los métodos se sincronizan sobre la única conexión.
 */
public final class EventBuffer implements AutoCloseable {

    public record Pending(long id, String json) {}

    private final Connection conn;
    private final Logger logger;

    public EventBuffer(File dataFolder, Logger logger) throws SQLException {
        this.logger = logger;
        if (!dataFolder.exists() && !dataFolder.mkdirs()) {
            throw new SQLException("No se pudo crear la carpeta de datos: " + dataFolder);
        }
        try {
            // El driver llega vía "libraries:" de plugin.yml; registrarlo explícitamente.
            Class.forName("org.sqlite.JDBC");
        } catch (ClassNotFoundException e) {
            throw new SQLException("Driver SQLite no disponible", e);
        }
        File dbFile = new File(dataFolder, "buffer.db");
        this.conn = DriverManager.getConnection("jdbc:sqlite:" + dbFile.getAbsolutePath());
        try (Statement st = conn.createStatement()) {
            st.execute("""
                CREATE TABLE IF NOT EXISTS buffered_events (
                  id          INTEGER PRIMARY KEY AUTOINCREMENT,
                  event_uuid  TEXT NOT NULL UNIQUE,
                  json        TEXT NOT NULL,
                  buffered_at TEXT NOT NULL DEFAULT (datetime('now'))
                )""");
            st.execute("""
                CREATE TABLE IF NOT EXISTS milestones (
                  what        TEXT PRIMARY KEY,
                  achieved_at TEXT NOT NULL DEFAULT (datetime('now'))
                )""");
        }
    }

    /**
     * Reclama un hito único en la historia del servidor. La PRIMARY KEY hace
     * el claim atómico y persistente: devuelve true solo la primera vez.
     */
    public synchronized boolean claimMilestone(String what) {
        try (PreparedStatement ps = conn.prepareStatement(
                "INSERT OR IGNORE INTO milestones (what) VALUES (?)")) {
            ps.setString(1, what);
            return ps.executeUpdate() == 1;
        } catch (SQLException e) {
            logger.severe("No se pudo reclamar el hito '" + what + "': " + e.getMessage());
            return false;
        }
    }

    public synchronized void store(String eventUuid, String json) {
        // OR IGNORE: si el mismo evento ya está en el buffer, no duplicar.
        try (PreparedStatement ps = conn.prepareStatement(
                "INSERT OR IGNORE INTO buffered_events (event_uuid, json) VALUES (?, ?)")) {
            ps.setString(1, eventUuid);
            ps.setString(2, json);
            ps.executeUpdate();
        } catch (SQLException e) {
            // Peor caso: el evento se pierde. Al menos que quede rastro en consola.
            logger.severe("No se pudo guardar el evento en el buffer local: " + e.getMessage());
        }
    }

    public synchronized List<Pending> loadPending(int limit) {
        List<Pending> out = new ArrayList<>();
        try (PreparedStatement ps = conn.prepareStatement(
                "SELECT id, json FROM buffered_events ORDER BY id LIMIT ?")) {
            ps.setInt(1, limit);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    out.add(new Pending(rs.getLong(1), rs.getString(2)));
                }
            }
        } catch (SQLException e) {
            logger.severe("No se pudo leer el buffer local: " + e.getMessage());
        }
        return out;
    }

    public synchronized void delete(long id) {
        try (PreparedStatement ps = conn.prepareStatement(
                "DELETE FROM buffered_events WHERE id = ?")) {
            ps.setLong(1, id);
            ps.executeUpdate();
        } catch (SQLException e) {
            logger.severe("No se pudo borrar del buffer local (id " + id + "): " + e.getMessage());
        }
    }

    public synchronized int count() {
        try (Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery("SELECT COUNT(*) FROM buffered_events")) {
            return rs.next() ? rs.getInt(1) : 0;
        } catch (SQLException e) {
            return -1;
        }
    }

    @Override
    public synchronized void close() {
        try {
            conn.close();
        } catch (SQLException e) {
            logger.warning("Error cerrando el buffer local: " + e.getMessage());
        }
    }
}
