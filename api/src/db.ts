import "dotenv/config";
import { Pool } from "pg";

// La API se conecta SIEMPRE como mc_app (append-only sobre events).
// La URL con la contraseña vive en api/.env, nunca en el código.
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL no definida. ¿Falta el archivo api/.env?");
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
