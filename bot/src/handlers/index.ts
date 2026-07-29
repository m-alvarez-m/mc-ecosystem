// Barrel export del modulo handlers.
// Los consumidores (tipicamente el wiring de v1.1 donde se instancia
// el dispatcher y se registran los handlers) importan desde aqui.

export { ServerStartedHandler } from "./server-started-handler";
export { ServerStoppedHandler } from "./server-stopped-handler";
export { PlayerJoinedHandler, MissingPlayerNameError } from "./player-joined-handler";
export {
  PlayerLeftHandler,
  // Alias por colision de nombre con la de player-joined: ambos handlers
  // definen su propio error tipado con el mismo problema semantico. El
  // consumidor que necesita catch especifico importa desde el barrel.
  MissingPlayerNameError as PlayerLeftMissingNameError,
} from "./player-left-handler";
export {
  PlayerDeathHandler,
  // Alias por la misma razon: el handler define su propio MissingPlayerNameError.
  MissingPlayerNameError as PlayerDeathMissingNameError,
} from "./player-death-handler";
export {
  AdvancementHandler,
  MissingPlayerNameError as AdvancementMissingNameError,
  MissingAdvancementNameError,
} from "./advancement-handler";
