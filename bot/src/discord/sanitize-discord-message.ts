// Sanitiza contenido arbitrario de usuario para que Discord no lo
// interprete como mención. Inserta un zero-width space (U+200B) dentro
// del token de mención — visualmente idéntico para el lector, pero el
// parser de Discord ya no lo reconoce como mención y no dispara ping.
//
// Patrones cubiertos (T1 del backlog v1.1):
//   @everyone        →  @​everyone
//   @here            →  @​here
//   <@123>           →  <@​123>       (mención de usuario)
//   <@!123>          →  <@​!123>      (mención de usuario con nick)
//   <@&123>          →  <@​&123>      (mención de rol)
//
// Fuera de scope (bajo/nulo riesgo de spam de notificaciones):
//   <#channelId>     mención de canal — sólo linkea, no pingea.
//   </cmd:id>        mención de slash command — informativa.
//   URLs, markdown y demás — no menciones.
//
// El resto del contenido pasa sin cambio: no se trunca, no se filtra
// semánticamente, no se recorta whitespace. Es una operación pura de
// una única responsabilidad.

const ZWSP = "​";

// Cada patrón vive como constante nombrada para que el intent sea
// legible en la lista de reemplazos, sin regex embebidas ad hoc.
const USER_OR_ROLE_MENTION = /<@([!&]?\d+)>/g;
const EVERYONE_MENTION = /@everyone/g;
const HERE_MENTION = /@here/g;

export function sanitizeDiscordMessage(content: string): string {
  return content
    .replace(USER_OR_ROLE_MENTION, `<@${ZWSP}$1>`)
    .replace(EVERYONE_MENTION, `@${ZWSP}everyone`)
    .replace(HERE_MENTION, `@${ZWSP}here`);
}
