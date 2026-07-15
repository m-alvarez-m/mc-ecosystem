package com.mcecosystem.eventcollector;

import com.google.gson.JsonObject;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Location;
import org.bukkit.entity.Entity;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityDeathEvent;
import org.bukkit.event.entity.PlayerDeathEvent;

/**
 * player.death, player.kill y mob.kill según docs/event-catalog.md,
 * más la alimentación del DamageAggregator para damage.minute.
 */
public final class CombatListener implements Listener {

    private final EventOutput sender;
    private final DamageAggregator aggregator;

    public CombatListener(EventOutput sender, DamageAggregator aggregator) {
        this.sender = sender;
        this.aggregator = aggregator;
    }

    // ---------- daño golpe a golpe (solo acumula, nunca emite) ----------

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onDamage(EntityDamageByEntityEvent event) {
        double damage = event.getFinalDamage();
        Player attacker = resolvePlayerDamager(event.getDamager());
        if (attacker != null) {
            aggregator.addDealt(attacker.getUniqueId(), damage);
        }
        if (event.getEntity() instanceof Player victim) {
            aggregator.addTaken(victim.getUniqueId(), damage);
        }
    }

    // ---------- muertes ----------

    @EventHandler(priority = EventPriority.MONITOR)
    public void onPlayerDeath(PlayerDeathEvent event) {
        Player victim = event.getEntity();
        Location deathPos = victim.getLocation();

        JsonObject data = new JsonObject();
        data.addProperty("cause", causeOf(victim));
        data.addProperty("message", plainText(event.deathMessage()));

        Player killer = victim.getKiller();
        if (killer != null) {
            // PvP: killer_uuid en player.death + evento espejo player.kill.
            data.addProperty("killer_uuid", killer.getUniqueId().toString());
            emitPlayerKill(killer, victim);
        } else {
            String mob = mobDamagerOf(victim);
            if (mob != null) {
                data.addProperty("killer_mob", mob);
            }
            // Sin killer ni mob: muerte de entorno; "cause" ya lo cuenta.
        }

        JsonObject json = EventJson.base("player.death", victim.getUniqueId());
        addPosition(json, deathPos);
        json.add("data", data);
        sender.send(EventJson.eventUuid(json), json.toString());
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onEntityDeath(EntityDeathEvent event) {
        LivingEntity entity = event.getEntity();
        if (entity instanceof Player) {
            return; // lo cubre onPlayerDeath
        }
        Player killer = entity.getKiller();
        if (killer == null) {
            return; // mob muerto sin jugador involucrado: no interesa en v1
        }
        JsonObject data = new JsonObject();
        data.addProperty("mob", entity.getType().getKey().toString());
        data.addProperty("weapon", weaponOf(killer));

        JsonObject json = EventJson.base("mob.kill", killer.getUniqueId());
        addPosition(json, entity.getLocation());
        json.add("data", data);
        sender.send(EventJson.eventUuid(json), json.toString());
    }

    private void emitPlayerKill(Player killer, Player victim) {
        JsonObject data = new JsonObject();
        data.addProperty("victim_uuid", victim.getUniqueId().toString());
        data.addProperty("weapon", weaponOf(killer));

        JsonObject json = EventJson.base("player.kill", killer.getUniqueId());
        addPosition(json, killer.getLocation());
        json.add("data", data);
        sender.send(EventJson.eventUuid(json), json.toString());
    }

    // ---------- resolución de causas y atacantes ----------

    /** Jugador responsable de un daño: directo, o shooter de un proyectil. */
    private static Player resolvePlayerDamager(Entity damager) {
        if (damager instanceof Player p) {
            return p;
        }
        if (damager instanceof Projectile proj && proj.getShooter() instanceof Player p) {
            return p;
        }
        return null;
    }

    /** DamageCause del último daño, en minúsculas: "fall", "lava", "entity_attack"... */
    private static String causeOf(Player victim) {
        EntityDamageEvent last = victim.getLastDamageCause();
        return last == null ? "unknown" : last.getCause().name().toLowerCase();
    }

    /**
     * Mob que mató al jugador, si lo hubo. Para proyectiles se atribuye
     * al shooter (skeleton), no al proyectil (arrow).
     */
    private static String mobDamagerOf(Player victim) {
        if (!(victim.getLastDamageCause() instanceof EntityDamageByEntityEvent byEntity)) {
            return null;
        }
        Entity damager = byEntity.getDamager();
        if (damager instanceof Projectile proj && proj.getShooter() instanceof Entity shooter) {
            damager = shooter;
        }
        if (damager instanceof Player) {
            return null; // PvP se maneja con killer_uuid
        }
        return damager.getType().getKey().toString();
    }

    private static String weaponOf(Player player) {
        return player.getInventory().getItemInMainHand().getType().getKey().toString();
    }

    private static void addPosition(JsonObject json, Location loc) {
        json.addProperty("world", loc.getWorld().getName());
        json.addProperty("x", loc.getBlockX());
        json.addProperty("y", loc.getBlockY());
        json.addProperty("z", loc.getBlockZ());
    }

    private static String plainText(Component component) {
        return component == null ? "" : PlainTextComponentSerializer.plainText().serialize(component);
    }
}
