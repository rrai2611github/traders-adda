import { Pool } from "pg";

export const authDbPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export function requireAuthDb(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for account data.");
  return authDbPool;
}
