// Reservado para tipos auxiliares del modulo Discord.
//
// v1: DiscordPublisher tipa directamente contra `Client` de
// discord.js (que se importa por default en discord-publisher.ts).
// Este archivo existe para preservar la estructura del modulo y
// absorber tipos compartidos cuando emerja el segundo consumidor
// dentro de este mismo modulo (p. ej. un helper para narrowing de
// canales u otro adapter futuro).

export {};
