package com.mcecosystem.eventfx;

/**
 * Foto serializable de un SkinIdentifier de SkinsRestorer, sin depender de
 * sus clases (así el estado persiste en JSON y los tests no necesitan SR).
 */
public record SavedSkin(String value, String variant, String type) {}
