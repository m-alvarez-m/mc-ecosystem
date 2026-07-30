// Barrel export del modulo Discord.

export { createDiscordClient } from "./client";

export { DiscordPublisher } from "./discord-publisher";
export type { DiscordPublisherOptions } from "./discord-publisher";

export {
  DiscordPublisherError,
  ChannelNotFoundError,
  ClientDisconnectedError,
  PublishError,
  InvalidPayloadError,
} from "./errors";

export { sanitizeDiscordMessage } from "./sanitize-discord-message";

export {
  FOOTER_TEXT,
  KIND_COLORS,
  NEUTRAL_COLOR,
  colorForKind,
} from "./embed-theme";
