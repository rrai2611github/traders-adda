import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required to create account data tables.");

const pool = new pg.Pool({ connectionString, max: 2 });
try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_watchlists (
      user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
      symbols jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_positions (
      user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
      holdings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(holdings) = 'array'),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_strategy_trackers (
      user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
      config jsonb CHECK (config IS NULL OR jsonb_typeof(config) = 'object'),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  console.log("Account data tables are ready.");
} finally {
  await pool.end();
}
