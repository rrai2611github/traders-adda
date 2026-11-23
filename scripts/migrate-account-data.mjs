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
    CREATE TABLE IF NOT EXISTS user_saved_scans (
      user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
      scans jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(scans) = 'array'),
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS account_visits (
      user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      visit_date date NOT NULL,
      first_seen_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, visit_date)
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS account_visits_visit_date_idx ON account_visits (visit_date)");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_audit_events (
      id bigserial PRIMARY KEY,
      actor_user_id text NOT NULL,
      actor_email text NOT NULL,
      target_user_id text NOT NULL,
      target_email text NOT NULL,
      action text NOT NULL CHECK (action IN ('role_changed', 'account_disabled', 'account_enabled')),
      details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS admin_audit_events_created_at_idx ON admin_audit_events (created_at DESC, id DESC)");
  console.log("Account data tables are ready.");
} finally {
  await pool.end();
}
