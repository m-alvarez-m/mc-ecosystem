package com.mcecosystem.eventfx.haunt;

import com.google.gson.JsonObject;
import com.mcecosystem.eventfx.EventJson;
import com.mcecosystem.eventfx.EventOutput;
import org.bukkit.Location;
import org.bukkit.SoundCategory;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.Plugin;
import org.bukkit.util.Vector;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Random;
import java.util.UUID;
import java.util.function.BooleanSupplier;

/**
 * Haunting: apariciones fantasma y sonidos falsos, SOLO para jugadores en
 * soledad. Los relojes avanzan únicamente en soledad elegible (la compañía
 * los PAUSA, no los resetea) y las reglas de no-crueldad vetan cualquier
 * susto en mal momento. Nada se anuncia jamás al jugador: solo el catálogo
 * (haunt.appearance / haunt.sound) sabe la verdad.
 */
public final class HauntManager implements Listener {

    public record Settings(
            List<String> exempt,
            int solitudeRadius,
            int minSessionMinutes,
            int deathGraceMinutes,
            int combatGraceSeconds,
            double minHealthHearts,
            int maxPerSession,
            int appearanceIntervalMinutes,
            int appearanceJitterMinutes,
            int appearanceDurationSeconds,
            int closeDespawnDistance,
            int centerGraceSeconds,
            int dayMinDistance,
            int dayMaxDistance,
            int nightMinDistance,
            int nightMaxDistance,
            int minAngleSeparationDegrees,
            int viewConeDegrees,
            int turnaroundMaxPerNight,
            int turnaroundIntervalMinutes,
            int turnaroundJitterMinutes,
            int turnWindowSeconds,
            int turnaroundMinSeconds,
            int turnaroundMaxSeconds,
            int soundMinMinutes,
            int soundMaxMinutes,
            double soundVolume,
            List<String> soundPool,
            // La lluvia entierra pasos y susurros: pool y volumen alternos.
            List<String> stormPool,
            double stormVolumeMultiplier,
            // Sonido al materializarse el fantasma ("" = aparición muda).
            // Es un CUE de susto: volumen propio y alto (el ambiental es sutil).
            String appearanceSound,
            double appearanceSoundVolume,
            // Cebo del turnaround: debe ser AUDIBLE y distinto (los pasos
            // vanilla se pierden). "" = usar el soundPool ambiental.
            String turnaroundCueSound,
            double turnaroundCueVolume,
            // seen=true solo si el objetivo mantuvo al fantasma en su cono de
            // vision este tiempo acumulado (un instante no cuenta como "visto").
            double seenMinSeconds,
            List<String> skinPool) {}

    /** Relojes y memoria por jugador. Solo viven mientras está online. */
    private static final class Clock {
        long joinedAt = System.currentTimeMillis();
        long lastDeathAt;
        long lastCombatAt;
        long appearanceMs, soundMs, turnaroundMs; // soledad acumulada
        long appearanceTarget, soundTarget, turnaroundTarget;
        int appearancesThisSession;
        long lastTurnaroundNight = -1;
        Float lastBearingDeg; // rumbo absoluto de la última aparición
    }

    private static final class ActiveGhost {
        int entityId;
        Location loc;
        String skinEntry;
        String trigger;
        String timeOfDay;
        double distance;
        long spawnedAt;
        long durationMs;
        boolean seen;
        boolean seenForced;
        long seenAccumMs; // tiempo acumulado dentro del cono de vision
    }

    private static final class PendingTurn {
        Location soundLoc;
        long startedAt;
    }

    private static final long COARSE_TICK_MS = 5000; // vigilancia cada 5 s

    private final Plugin plugin;
    private final GhostPresenter presenter;
    private final GhostSkinResolver skinResolver;
    private final EventOutput output;
    private final Settings s;
    private final BooleanSupplier eventModeActive;
    private final Random random;
    private final File stateFile;

    private final Map<UUID, Clock> clocks = new HashMap<>();
    private final Map<UUID, ActiveGhost> ghosts = new HashMap<>();
    private final Map<UUID, PendingTurn> pendingTurns = new HashMap<>();
    private final Map<String, GhostSkin> skinCache = new HashMap<>();
    private boolean enabled;

    public HauntManager(Plugin plugin, GhostPresenter presenter,
                        GhostSkinResolver skinResolver, EventOutput output,
                        Settings settings, BooleanSupplier eventModeActive,
                        Random random) {
        this.plugin = plugin;
        this.presenter = presenter;
        this.skinResolver = skinResolver;
        this.output = output;
        this.s = settings;
        this.eventModeActive = eventModeActive;
        this.random = random;
        this.stateFile = new File(plugin.getDataFolder(), "haunting.json");
        this.enabled = loadEnabled();
    }

    /** Arranca las dos tareas: vigilancia gruesa (5 s) y fina (5 ticks).
     *  Blindadas: una excepción en un tick no debe matar el timer. */
    public void startTasks() {
        for (String warning : validate(s)) {
            plugin.getLogger().warning("[haunting config] " + warning);
        }
        plugin.getServer().getScheduler().runTaskTimer(plugin,
                () -> safely(this::coarseTick), 100L, 100L);
        plugin.getServer().getScheduler().runTaskTimer(plugin,
                () -> safely(this::fineTick), 5L, 5L);
        plugin.getServer().getPluginManager().registerEvents(this, plugin);
    }

    /**
     * Revisa la config y devuelve advertencias de valores que romperían el
     * haunting en silencio. La REGLA DE ORO: el rango mínimo de spawn debe
     * superar close_despawn_distance; si no, el fantasma nace dentro de su
     * propio radio de huida y se desvanece en 0.0 s (nadie lo ve, pero la
     * telemetría sí lo registra). Aprendido en vivo el 2026-07-18.
     */
    public static List<String> validate(Settings s) {
        List<String> warnings = new ArrayList<>();
        // Estrictamente <: en == el fantasma sobrevive al spawn (solo huye
        // al acercarse); < significa que NACE dentro del radio y muere ya.
        if (s.nightMinDistance() < s.closeDespawnDistance()) {
            warnings.add("night_min_distance (" + s.nightMinDistance()
                    + ") < close_despawn_distance (" + s.closeDespawnDistance()
                    + "): parte de los fantasmas nocturnos naceran dentro de su"
                    + " radio de huida y duraran ~0s. Sube night_min_distance.");
        }
        if (s.dayMinDistance() < s.closeDespawnDistance()) {
            warnings.add("day_min_distance (" + s.dayMinDistance()
                    + ") < close_despawn_distance (" + s.closeDespawnDistance()
                    + "): parte de los fantasmas diurnos naceran dentro de su"
                    + " radio de huida y duraran ~0s. Sube day_min_distance.");
        }
        if (s.nightMinDistance() > s.nightMaxDistance()) {
            warnings.add("night_min_distance > night_max_distance: rango invertido.");
        }
        if (s.dayMinDistance() > s.dayMaxDistance()) {
            warnings.add("day_min_distance > day_max_distance: rango invertido.");
        }
        if (s.soundMinMinutes() > s.soundMaxMinutes()) {
            warnings.add("sounds.interval_min_minutes > interval_max_minutes:"
                    + " rango invertido (los sonidos ambientales no sonaran).");
        }
        if (s.turnaroundMinSeconds() > s.turnaroundMaxSeconds()) {
            warnings.add("turnaround.duration_min_seconds > duration_max_seconds:"
                    + " rango invertido.");
        }
        return warnings;
    }

    private void safely(Runnable tick) {
        try {
            tick.run();
        } catch (Exception e) {
            plugin.getLogger().warning("Tick de haunting falló: " + e.getMessage());
        }
    }

    // ---------- estado on/off persistente ----------

    public synchronized boolean isEnabled() {
        return enabled;
    }

    public synchronized void setEnabled(boolean value) {
        enabled = value;
        try {
            Files.writeString(stateFile.toPath(),
                    "{\"enabled\": " + value + "}", StandardCharsets.UTF_8);
        } catch (Exception e) {
            plugin.getLogger().warning("No se pudo persistir el estado de haunting: " + e.getMessage());
        }
        if (!value) {
            // apagar = limpiar cualquier fantasma en curso, sin emitir nada
            ghosts.forEach((uuid, g) -> {
                Player p = plugin.getServer().getPlayer(uuid);
                if (p != null) {
                    presenter.removeGhost(p, g.entityId);
                }
            });
            ghosts.clear();
            pendingTurns.clear();
        }
    }

    private boolean loadEnabled() {
        try {
            if (stateFile.exists()) {
                return Files.readString(stateFile.toPath(), StandardCharsets.UTF_8)
                        .contains("true");
            }
        } catch (Exception ignored) {
            // estado ilegible = apagado, el default seguro
        }
        return false;
    }

    // ---------- reloj grueso: elegibilidad y disparos ----------

    private synchronized void coarseTick() {
        if (!enabled) {
            return;
        }
        for (Player p : plugin.getServer().getOnlinePlayers()) {
            Clock c = clocks.computeIfAbsent(p.getUniqueId(), u -> newClock());
            if (!eligible(p, c) || !isAlone(p)) {
                continue; // pausa: la soledad acumulada se conserva
            }
            c.appearanceMs += COARSE_TICK_MS;
            c.soundMs += COARSE_TICK_MS;
            c.turnaroundMs += COARSE_TICK_MS;

            if (c.soundMs >= c.soundTarget) {
                c.soundMs = 0;
                c.soundTarget = rollSoundTarget();
                ambientSound(p);
            }
            String tod = timeOfDay(p.getWorld());
            boolean night = !tod.equals("day");
            if (night && c.turnaroundMs >= c.turnaroundTarget
                    && c.appearancesThisSession < s.maxPerSession()
                    && worldNight(p.getWorld()) != c.lastTurnaroundNight
                    && !pendingTurns.containsKey(p.getUniqueId())
                    && !ghosts.containsKey(p.getUniqueId())) {
                c.turnaroundMs = 0;
                c.turnaroundTarget = rollTarget(s.turnaroundIntervalMinutes(), s.turnaroundJitterMinutes());
                c.lastTurnaroundNight = worldNight(p.getWorld());
                startTurnaround(p);
            }
            if (c.appearanceMs >= c.appearanceTarget
                    && c.appearancesThisSession < s.maxPerSession()
                    && !ghosts.containsKey(p.getUniqueId())
                    && !pendingTurns.containsKey(p.getUniqueId())) {
                if (tryAmbientAppearance(p, c, tod)) {
                    c.appearancesThisSession++;
                    c.appearanceMs = 0;
                    c.appearanceTarget = rollTarget(s.appearanceIntervalMinutes(), s.appearanceJitterMinutes());
                } else {
                    // sin lugar digno: reintentar en ~2 min, no perder el ciclo
                    c.appearanceMs = Math.max(0, c.appearanceTarget - 120_000);
                }
            }
        }
    }

    private Clock newClock() {
        Clock c = new Clock();
        c.appearanceTarget = rollTarget(s.appearanceIntervalMinutes(), s.appearanceJitterMinutes());
        c.turnaroundTarget = rollTarget(s.turnaroundIntervalMinutes(), s.turnaroundJitterMinutes());
        c.soundTarget = rollSoundTarget();
        return c;
    }

    private long rollTarget(int intervalMin, int jitterMin) {
        long jitter = jitterMin <= 0 ? 0
                : (long) ((random.nextDouble() * 2 - 1) * jitterMin * 60_000L);
        return Math.max(60_000, intervalMin * 60_000L + jitter);
    }

    private long rollSoundTarget() {
        int span = Math.max(1, s.soundMaxMinutes() - s.soundMinMinutes());
        return (s.soundMinMinutes() + random.nextInt(span)) * 60_000L;
    }

    /** Reglas de no-crueldad + contexto. Cualquier "no" pausa los relojes. */
    private boolean eligible(Player p, Clock c) {
        long now = System.currentTimeMillis();
        if (s.exempt().stream().anyMatch(n -> n.equalsIgnoreCase(p.getName()))) {
            return false;
        }
        if (p.getWorld().getEnvironment() != World.Environment.NORMAL) {
            return false; // solo Overworld: el Nether ya asusta solo
        }
        if (eventModeActive.getAsBoolean()) {
            return false; // en pleno torneo nadie está "solo"
        }
        if (now - c.joinedAt < s.minSessionMinutes() * 60_000L) {
            return false;
        }
        if (c.lastDeathAt > 0 && now - c.lastDeathAt < s.deathGraceMinutes() * 60_000L) {
            return false;
        }
        if (c.lastCombatAt > 0 && now - c.lastCombatAt < s.combatGraceSeconds() * 1000L) {
            return false;
        }
        return p.getHealth() >= s.minHealthHearts() * 2;
    }

    private boolean isAlone(Player p) {
        double r2 = (double) s.solitudeRadius() * s.solitudeRadius();
        for (Player other : p.getWorld().getPlayers()) {
            if (!other.equals(p)
                    && other.getLocation().distanceSquared(p.getLocation()) < r2) {
                return false;
            }
        }
        return true;
    }

    // ---------- sonidos ambientales falsos ----------

    private void ambientSound(Player p) {
        boolean storm = p.getWorld().hasStorm();
        // En tormenta la lluvia entierra los sonidos sutiles: pool alterno
        // (si existe) y volumen amplificado para atravesar el ruido.
        List<String> pool = storm && !s.stormPool().isEmpty()
                ? s.stormPool() : s.soundPool();
        if (pool.isEmpty()) {
            return;
        }
        String sound = pool.get(random.nextInt(pool.size()));
        float volume = (float) (storm
                ? s.soundVolume() * s.stormVolumeMultiplier() : s.soundVolume());
        // Desde una dirección vacía: rumbo aleatorio a 8-15 bloques.
        double bearing = random.nextDouble() * 360;
        Location src = offset(p.getLocation(), bearing, 8 + random.nextDouble() * 7);
        try {
            p.playSound(src, sound, SoundCategory.AMBIENT,
                    volume, 0.9f + random.nextFloat() * 0.2f);
        } catch (Exception e) {
            plugin.getLogger().warning("Sonido de haunting no reproducible: " + sound);
            return;
        }
        emitSound(p, src, sound);
    }

    // ---------- aparición ambiental ----------

    private boolean tryAmbientAppearance(Player p, Clock c, String tod) {
        GhostSkin skin = resolveSkin();
        if (skin == null) {
            return false;
        }
        boolean night = !tod.equals("day");
        int min = night ? s.nightMinDistance() : s.dayMinDistance();
        int max = night ? s.nightMaxDistance() : s.dayMaxDistance();

        Location best = null;
        double bestScore = -1;
        double bestBearing = 0;
        double playerYaw = p.getLocation().getYaw();
        for (int i = 0; i < 24; i++) {
            double offsetDeg = (random.nextDouble() * 2 - 1) * s.viewConeDegrees();
            double bearing = normalize(playerYaw + offsetDeg);
            if (c.lastBearingDeg != null
                    && angleDiff(bearing, c.lastBearingDeg) < s.minAngleSeparationDegrees()) {
                continue; // jamás el mismo ángulo dos veces seguidas
            }
            double dist = min + random.nextDouble() * (max - min);
            Location ground = findGround(offset(p.getLocation(), bearing, dist));
            if (ground == null) {
                continue;
            }
            // Visible al menos de cabeza: sin línea de visión no hay susto.
            if (blocked(p.getEyeLocation(), ground.clone().add(0, 1.6, 0))) {
                continue;
            }
            double score = 15 - lightLevel(ground); // penumbra suma
            if (blocked(p.getEyeLocation(), ground.clone().add(0, 0.3, 0))) {
                score += 4; // pies ocultos = obstrucción parcial, aún mejor
            }
            if (score > bestScore) {
                bestScore = score;
                best = ground;
                bestBearing = bearing;
            }
        }
        if (best == null) {
            return false;
        }
        c.lastBearingDeg = (float) bestBearing;
        spawnGhost(p, best, skin, "ambient", tod,
                s.appearanceDurationSeconds() * 1000L, false);
        return true;
    }

    // ---------- turnaround ----------

    private void startTurnaround(Player p) {
        // Sonido puntual DETRÁS del jugador; si voltea a tiempo, lo ve.
        // Cebo dedicado y FUERTE: el turnaround muere si no se oye.
        double behind = normalize(p.getLocation().getYaw() + 180 + (random.nextDouble() * 60 - 30));
        Location src = offset(p.getLocation(), behind, 10);
        String sound = !s.turnaroundCueSound().isEmpty()
                ? s.turnaroundCueSound()
                : s.soundPool().isEmpty()
                        ? "minecraft:block.gravel.step"
                        : s.soundPool().get(random.nextInt(s.soundPool().size()));
        float volume = s.turnaroundCueSound().isEmpty()
                ? (float) s.soundVolume() : (float) s.turnaroundCueVolume();
        try {
            p.playSound(src, sound, SoundCategory.AMBIENT, volume, 1.0f);
        } catch (Exception ignored) {
            return;
        }
        emitSound(p, src, sound);
        PendingTurn turn = new PendingTurn();
        turn.soundLoc = src;
        turn.startedAt = System.currentTimeMillis();
        pendingTurns.put(p.getUniqueId(), turn);
    }

    // ---------- reloj fino: fantasmas activos y turnarounds ----------

    private synchronized void fineTick() {
        long now = System.currentTimeMillis();

        pendingTurns.entrySet().removeIf(entry -> {
            Player p = plugin.getServer().getPlayer(entry.getKey());
            PendingTurn turn = entry.getValue();
            if (p == null) {
                return true;
            }
            if (now - turn.startedAt > s.turnWindowSeconds() * 1000L) {
                return true; // no volteó: no pasa nada, jamás lo sabrá
            }
            if (lookingAt(p, turn.soundLoc, 30)) {
                GhostSkin skin = resolveSkin();
                if (skin != null) {
                    String tod = timeOfDay(p.getWorld());
                    int mid = (s.nightMinDistance() + s.nightMaxDistance()) / 2;
                    double bearing = bearingTo(p.getLocation(), turn.soundLoc);
                    Location ground = findGround(offset(p.getLocation(), bearing, mid));
                    if (ground != null && !blocked(p.getEyeLocation(), ground.clone().add(0, 1.6, 0))) {
                        long dur = (s.turnaroundMinSeconds()
                                + random.nextInt(Math.max(1, s.turnaroundMaxSeconds() - s.turnaroundMinSeconds() + 1)))
                                * 1000L;
                        spawnGhost(p, ground, skin, "turnaround", tod, dur, true);
                        Clock c = clocks.get(p.getUniqueId());
                        if (c != null) {
                            c.appearancesThisSession++;
                            c.lastBearingDeg = (float) bearing;
                        }
                    }
                }
                return true;
            }
            return false;
        });

        ghosts.entrySet().removeIf(entry -> {
            Player p = plugin.getServer().getPlayer(entry.getKey());
            ActiveGhost g = entry.getValue();
            if (p == null) {
                return true; // se desconectó: el fantasma muere con su testigo
            }
            double dist = p.getLocation().distance(g.loc);
            // seen honesto: acumula tiempo mirandolo (fineTick = 5 ticks =
            // 250 ms) y solo cuenta como visto tras seen_min_seconds. Un
            // barrido instantaneo del cono ya no basta.
            if (!g.seen && lookingAt(p, g.loc, s.viewConeDegrees())) {
                g.seenAccumMs += 250;
                if (g.seenAccumMs >= s.seenMinSeconds() * 1000) {
                    g.seen = true;
                }
            }
            long elapsed = now - g.spawnedAt;
            boolean expired = elapsed >= g.durationMs;
            boolean tooClose = dist < s.closeDespawnDistance();
            if (tooClose || (expired && (!lookingAt(p, g.loc, 20)
                    || elapsed >= g.durationMs + s.centerGraceSeconds() * 1000L))) {
                // nunca desvanecerse en el centro de la mirada... si se puede
                presenter.removeGhost(p, g.entityId);
                emitAppearance(p, g, elapsed / 1000.0);
                return true;
            }
            return false;
        });
    }

    // ---------- spawn/emisión ----------

    private void spawnGhost(Player p, Location ground, GhostSkin skin,
                            String trigger, String tod, long durationMs, boolean seenForced) {
        // Orientado hacia el jugador: quieto, mirándolo. Ese es el susto.
        Vector toPlayer = p.getEyeLocation().toVector()
                .subtract(ground.toVector().add(new Vector(0, 1.6, 0)));
        float yaw = (float) Math.toDegrees(Math.atan2(-toPlayer.getX(), toPlayer.getZ()));
        float pitch = (float) Math.toDegrees(-Math.asin(toPlayer.clone().normalize().getY()));

        ActiveGhost g = new ActiveGhost();
        g.entityId = presenter.showGhost(p, ground, yaw, pitch, skin);
        if (!s.appearanceSound().isEmpty()) {
            try {
                // Desde la posición del fantasma: el susto tiene dirección.
                // Volumen propio (alto): es el cue que hace voltear a mirar.
                p.playSound(ground, s.appearanceSound(),
                        SoundCategory.AMBIENT, (float) s.appearanceSoundVolume(), 1.0f);
            } catch (Exception e) {
                plugin.getLogger().warning("Sonido de aparición no reproducible: "
                        + s.appearanceSound());
            }
        }
        g.loc = ground;
        g.skinEntry = currentSkinEntry();
        g.trigger = trigger;
        g.timeOfDay = tod;
        g.distance = p.getLocation().distance(ground);
        g.spawnedAt = System.currentTimeMillis();
        g.durationMs = durationMs;
        g.seenForced = seenForced;
        g.seen = seenForced;
        ghosts.put(p.getUniqueId(), g);
    }

    private void emitAppearance(Player p, ActiveGhost g, double durationSeconds) {
        JsonObject data = new JsonObject();
        data.addProperty("target", p.getUniqueId().toString());
        data.addProperty("skin", g.skinEntry);
        data.addProperty("distance", Math.round(g.distance * 10) / 10.0);
        data.addProperty("duration_s", Math.round(durationSeconds * 10) / 10.0);
        data.addProperty("seen", g.seen);
        data.addProperty("trigger", g.trigger);
        data.addProperty("time_of_day", g.timeOfDay);
        JsonObject json = EventJson.base("haunt.appearance");
        EventJson.position(json, g.loc);
        json.add("data", data);
        output.send(EventJson.eventUuid(json), json.toString());
    }

    private void emitSound(Player p, Location src, String sound) {
        JsonObject data = new JsonObject();
        data.addProperty("target", p.getUniqueId().toString());
        data.addProperty("sound", sound);
        JsonObject json = EventJson.base("haunt.sound");
        EventJson.position(json, src);
        json.add("data", data);
        output.send(EventJson.eventUuid(json), json.toString());
    }

    private GhostSkin resolveSkin() {
        String entry = currentSkinEntry();
        if (entry == null) {
            return null;
        }
        return skinCache.computeIfAbsent(entry,
                e -> skinResolver.resolve(e).orElse(null));
    }

    private String currentSkinEntry() {
        return s.skinPool().isEmpty() ? null
                : s.skinPool().get(random.nextInt(s.skinPool().size()));
    }

    // ---------- geometría y mundo ----------

    static String timeOfDay(World w) {
        if (w.hasStorm()) {
            return "storm"; // la tormenta cuenta como noche
        }
        long t = w.getTime();
        return (t >= 13000 && t <= 23000) ? "night" : "day";
    }

    private static long worldNight(World w) {
        return w.getFullTime() / 24000L;
    }

    private static Location offset(Location from, double bearingDeg, double dist) {
        double rad = Math.toRadians(bearingDeg);
        return from.clone().add(-Math.sin(rad) * dist, 0, Math.cos(rad) * dist);
    }

    /** Suelo válido cerca del Y del jugador: sólido con 2 de aire encima. */
    private static Location findGround(Location around) {
        World w = around.getWorld();
        int x = around.getBlockX(), z = around.getBlockZ();
        for (int y = around.getBlockY() + 6; y >= around.getBlockY() - 10; y--) {
            Block b = w.getBlockAt(x, y, z);
            // Solo materiales: Block.isPassable() no existe en todos los
            // mundos (mocks) y un no-sólido basta como hueco de pie.
            if (b.getType().isSolid()
                    && !w.getBlockAt(x, y + 1, z).getType().isSolid()
                    && !w.getBlockAt(x, y + 2, z).getType().isSolid()) {
                return new Location(w, x + 0.5, y + 1, z + 0.5);
            }
        }
        return null;
    }

    private static boolean blocked(Location eye, Location target) {
        Vector dir = target.toVector().subtract(eye.toVector());
        double len = dir.length();
        if (len < 0.5) {
            return false;
        }
        try {
            return eye.getWorld().rayTraceBlocks(eye, dir.normalize(), len) != null;
        } catch (Exception e) {
            return false; // mundo sin raytrace (tests): asumir despejado
        }
    }

    private static int lightLevel(Location loc) {
        try {
            return loc.getBlock().getLightLevel();
        } catch (Exception e) {
            return 0; // mundo sin luces (tests): penumbra total
        }
    }

    private static boolean lookingAt(Player p, Location target, double coneDeg) {
        Vector look = p.getEyeLocation().getDirection();
        Vector to = target.toVector().subtract(p.getEyeLocation().toVector());
        if (to.lengthSquared() < 0.01) {
            return true;
        }
        double angle = Math.toDegrees(look.angle(to.normalize()));
        return angle <= coneDeg;
    }

    private static double bearingTo(Location from, Location to) {
        double dx = to.getX() - from.getX();
        double dz = to.getZ() - from.getZ();
        return normalize(Math.toDegrees(Math.atan2(-dx, dz)));
    }

    private static double normalize(double deg) {
        double d = deg % 360;
        return d < 0 ? d + 360 : d;
    }

    private static double angleDiff(double a, double b) {
        double d = Math.abs(a - b) % 360;
        return d > 180 ? 360 - d : d;
    }

    // ---------- listeners de contexto ----------

    @EventHandler
    public void onJoin(PlayerJoinEvent e) {
        clocks.put(e.getPlayer().getUniqueId(), newClock());
    }

    @EventHandler
    public synchronized void onQuit(PlayerQuitEvent e) {
        UUID uuid = e.getPlayer().getUniqueId();
        clocks.remove(uuid);
        pendingTurns.remove(uuid);
        ActiveGhost g = ghosts.remove(uuid);
        if (g != null) {
            emitAppearance(e.getPlayer(), g,
                    (System.currentTimeMillis() - g.spawnedAt) / 1000.0);
        }
    }

    @EventHandler
    public void onDeath(PlayerDeathEvent e) {
        Clock c = clocks.get(e.getEntity().getUniqueId());
        if (c != null) {
            c.lastDeathAt = System.currentTimeMillis();
        }
    }

    @EventHandler(ignoreCancelled = true)
    public void onDamaged(EntityDamageEvent e) {
        if (e.getEntity() instanceof Player p) {
            Clock c = clocks.get(p.getUniqueId());
            if (c != null) {
                c.lastCombatAt = System.currentTimeMillis();
            }
        }
    }

    @EventHandler(ignoreCancelled = true)
    public void onDealtDamage(EntityDamageByEntityEvent e) {
        if (e.getDamager() instanceof Player p) {
            Clock c = clocks.get(p.getUniqueId());
            if (c != null) {
                c.lastCombatAt = System.currentTimeMillis();
            }
        }
    }
}
