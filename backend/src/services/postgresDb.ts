import pg from "pg";

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL;

export const pool = new Pool({
  connectionString: databaseUrl
});

export async function query<T>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

export async function initDb() {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'superadmin')),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS users_email_idx ON users (email)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      token_hash TEXT PRIMARY KEY,
      subject UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS refresh_tokens_subject_idx ON refresh_tokens (subject)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS refresh_tokens_expires_at_idx ON refresh_tokens (expires_at)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS generated_posts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      excerpt TEXT NOT NULL,
      content TEXT NOT NULL,
      cover_image TEXT,
      author TEXT NOT NULL,
      published_at DATE NOT NULL,
      read_time_minutes INTEGER NOT NULL,
      primary_keyword TEXT NOT NULL,
      secondary_keywords TEXT[] NOT NULL DEFAULT '{}',
      category TEXT NOT NULL,
      rating TEXT NOT NULL CHECK (rating IN ('A+', 'A', 'B', 'C', 'D', 'F')),
      status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS generated_posts_published_at_idx ON generated_posts (published_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_settings (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      master_prompt TEXT NOT NULL,
      auto_generation_enabled BOOLEAN NOT NULL,
      generation_topic TEXT NOT NULL,
      generation_time TEXT NOT NULL,
      generation_times TEXT[] NOT NULL DEFAULT ARRAY['09:00']::TEXT[],
      generation_frequency TEXT NOT NULL CHECK (generation_frequency IN ('manual', 'daily', 'weekly', 'monthly')),
      last_generated_at TIMESTAMPTZ,
      last_generation_status TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE admin_settings
    ADD COLUMN IF NOT EXISTS generation_times TEXT[] NOT NULL DEFAULT ARRAY['09:00']::TEXT[]
  `);

  await pool.query(`
    UPDATE admin_settings
    SET generation_times = ARRAY[generation_time]
    WHERE generation_times IS NULL OR cardinality(generation_times) = 0
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscribers (
      email TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_events (
      id BIGSERIAL PRIMARY KEY,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT,
      details JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}
