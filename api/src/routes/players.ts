import { FastifyInstance } from "fastify";
import type { Pool } from "pg";

// Dependencias inyectables. GET /players/:uuid es sólo lectura → basta
// con `Pick<Pool, "query">`. Sin adapter, gateway ni repositorio: la
// ruta habla con `pool.query(...)` directamente, siguiendo el mismo
// patrón que las rutas de events.
export interface PlayerRoutesDeps {
  pool: Pick<Pool, "query">;
}

// Esquema del path param. Fastify + ajv-formats valida el formato UUID
// ANTES de ejecutar el handler: si no cumple, responde 400 automático.
const getPlayerParamsSchema = {
  type: "object",
  required: ["uuid"],
  additionalProperties: false,
  properties: {
    uuid: { type: "string", format: "uuid" },
  },
} as const;

interface GetPlayerParams {
  uuid: string;
}

interface PlayerRow {
  uuid: string;
  name: string;
  first_seen: Date;
  last_seen: Date;
}

export async function playerRoutes(app: FastifyInstance, deps: PlayerRoutesDeps) {
  const { pool } = deps;

  app.get<{ Params: GetPlayerParams }>(
    "/players/:uuid",
    { schema: { params: getPlayerParamsSchema } },
    async (request, reply) => {
      const { uuid } = request.params;

      const result = await pool.query<PlayerRow>(
        `SELECT uuid, name, first_seen, last_seen
         FROM players
         WHERE uuid = $1`,
        [uuid]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: "player_not_found" });
      }

      // Proyección explícita: aunque `players` gane columnas en el
      // futuro, esta ruta expone SÓLO los cuatro campos del contrato.
      const row = result.rows[0]!;
      return reply.code(200).send({
        uuid: row.uuid,
        name: row.name,
        first_seen: row.first_seen,
        last_seen: row.last_seen,
      });
    }
  );
}
