package com.mcecosystem.eventfx;

import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;

import java.util.List;

/** /evento iniciar <nombre> | /evento terminar — solo OPs (plugin.yml). */
public final class EventoCommand implements CommandExecutor, TabCompleter {

    private final EventManager manager;

    public EventoCommand(EventManager manager) {
        this.manager = manager;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command,
                             String label, String[] args) {
        if (args.length >= 2 && args[0].equalsIgnoreCase("iniciar")) {
            manager.start(String.join(" ", java.util.Arrays.copyOfRange(args, 1, args.length)), sender);
            return true;
        }
        if (args.length == 1 && args[0].equalsIgnoreCase("terminar")) {
            if (manager.end()) {
                sender.sendMessage("Evento terminado: skins y efectos restaurados.");
            } else {
                sender.sendMessage("No hay ningún evento activo.");
            }
            return true;
        }
        return false; // muestra el usage de plugin.yml
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command,
                                      String alias, String[] args) {
        if (args.length == 1) {
            return List.of("iniciar", "terminar");
        }
        return List.of();
    }
}
