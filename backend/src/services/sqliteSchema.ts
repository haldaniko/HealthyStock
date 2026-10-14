// Kept in the backend build so the importer and the running app use one schema.
export const applicationTables = [
  "users", "refresh_tokens", "generated_posts", "admin_settings", "subscribers", "audit_events"
] as const;

export const sqliteSchema = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'superadmin')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at TEXT
);
CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);
CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_hash TEXT PRIMARY KEY, subject TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS refresh_tokens_subject_idx ON refresh_tokens(subject);
CREATE INDEX IF NOT EXISTS refresh_tokens_expires_at_idx ON refresh_tokens(expires_at);
CREATE TABLE IF NOT EXISTS generated_posts (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  excerpt TEXT NOT NULL, content TEXT NOT NULL, cover_image TEXT,
  author TEXT NOT NULL, published_at TEXT NOT NULL, read_time_minutes INTEGER NOT NULL,
  primary_keyword TEXT NOT NULL, secondary_keywords TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(secondary_keywords)),
  category TEXT NOT NULL, rating TEXT NOT NULL CHECK (rating IN ('A+', 'A', 'B', 'C', 'D', 'F')),
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS generated_posts_published_at_idx ON generated_posts(published_at DESC);
CREATE TABLE IF NOT EXISTS admin_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1), master_prompt TEXT NOT NULL,
  auto_generation_enabled INTEGER NOT NULL CHECK (auto_generation_enabled IN (0, 1)),
  generation_topic TEXT NOT NULL, generation_time TEXT NOT NULL,
  generation_times TEXT NOT NULL DEFAULT '["09:00"]' CHECK (json_valid(generation_times)),
  generation_frequency TEXT NOT NULL CHECK (generation_frequency IN ('manual', 'daily', 'weekly', 'monthly')),
  last_generated_at TEXT, last_generation_status TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS subscribers (
  email TEXT PRIMARY KEY, source TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL,
  target TEXT, details TEXT CHECK (details IS NULL OR json_valid(details)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS migration_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1), source TEXT NOT NULL,
  completed_at TEXT NOT NULL, counts TEXT NOT NULL CHECK (json_valid(counts))
);
`;
