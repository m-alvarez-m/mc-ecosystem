package com.mcecosystem.eventfx.haunt;

import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;

import java.util.List;

/** /haunt on|off|status — solo OPs (permiso en plugin.yml). */
public final class HauntCommand implements CommandExecutor, TabCompleter {

    private final HauntManager manager;

    public HauntCommand(HauntManager manager) {
        this.manager = manager;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command,
                             String label, String[] args) {
        if (args.length != 1) {
            return false;
        }
        switch (args[0].toLowerCase()) {
            case "on" -> {
                manager.setEnabled(true);
                sender.sendMessage("Haunting ACTIVADO. Que duerman bien...");
            }
            case "off" -> {
                manager.setEnabled(false);
                sender.sendMessage("Haunting desactivado.");
            }
            case "status" -> sender.sendMessage("Haunting: "
                    + (manager.isEnabled() ? "ACTIVO" : "apagado"));
            default -> {
                return false;
            }
        }
        return true;
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command,
                                      String alias, String[] args) {
        return args.length == 1 ? List.of("on", "off", "status") : List.of();
    }
}
