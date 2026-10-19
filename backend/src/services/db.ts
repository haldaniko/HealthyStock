import Database from "better-sqlite3";
import path from "node:path";
import { existsSync } from "node:fs";
import { query as pgQuery, initDb as initPostgresDb } from "./postgresDb.js";
import { applicationTables } from "./sqliteSchema.js";

const databaseUrl = process.env.DATABASE_URL;
const sqlitePath = databaseUrl?.startsWith("sqlite:") ? path.resolve(databaseUrl.slice(7)) : null;
let sqlite: Database.Database | undefined;

export function openSqlite() {
  if (!sqlitePath) throw new Error("SQLite path is not configured");
  if (!existsSync(sqlitePath)) throw new Error(`SQLite database is missing: ${sqlitePath}`);
  if (!sqlite) {
    sqlite = new Database(sqlitePath, { fileMustExist: true });
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("busy_timeout = 5000");
    // DELETE journal mode keeps a single durable database file on the host.
    sqlite.pragma("journal_mode = DELETE");
  }
  return sqlite;
}

export function isSqliteDatabase() {
  return Boolean(sqlitePath);
}

export function closeDatabase() {
  if (sqlite?.open) sqlite.close();
  sqlite = undefined;
}

function sqliteSql(sql: string) {
  const positions: number[] = [];
  const text = sql
    .replace(/COUNT\(\*\)::text/gi, "CAST(COUNT(*) AS TEXT)")
    .replace(/\$([0-9]+)::(?:date|timestamptz|jsonb)/gi, "$$$1")
    .replace(/\$([0-9]+)/g, (_match, number: string) => {
      positions.push(Number(number) - 1);
      return "?";
    })
    .replace(/NOW\(\)\s*\+\s*INTERVAL\s*'14 days'/gi, "strftime('%Y-%m-%dT%H:%M:%fZ','now','+14 days')")
    .replace(/NOW\(\)/gi, "strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  return { text, positions };
}

function convertParam(value: unknown): string | number | bigint | Buffer | null {
  if (value == null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint" || Buffer.isBuffer(value)) return value;
  throw new Error(`Unsupported SQLite parameter: ${typeof value}`);
}

function convertRow(row: Record<string, unknown>) {
  for (const key of ["secondary_keywords", "generation_times"]) {
    if (typeof row[key] === "string") row[key] = JSON.parse(row[key] as string);
  }
  for (const key of ["is_active", "auto_generation_enabled"]) {
    if (typeof row[key] === "number") row[key] = Boolean(row[key]);
  }
  return row;
}

export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  if (!sqlitePath) return pgQuery<T>(sql, params);
  const compiled = sqliteSql(sql);
  const statement = openSqlite().prepare(compiled.text);
  const values = compiled.positions.map((index) => convertParam(params[index]));
  if (!statement.reader) {
    statement.run(...values);
    return [];
  }
  return statement.all(...values).map((row) => convertRow(row as Record<string, unknown>) as T);
}

export async function initDb() {
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  if (!sqlitePath) return initPostgresDb();
  const db = openSqlite();
  if (db.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("SQLite integrity check failed");
  if ((db.pragma("foreign_key_check") as unknown[]).length) throw new Error("SQLite foreign key check failed");
  const marker = db.prepare("SELECT source FROM migration_meta WHERE id = 1").get() as { source: string } | undefined;
  if (!marker?.source) throw new Error("SQLite migration marker is missing");
  for (const table of applicationTables) {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) {
      throw new Error(`SQLite application table is missing: ${table}`);
    }
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_articles (
      external_id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL UNIQUE REFERENCES generated_posts(id) ON DELETE CASCADE,
      payload_hash TEXT NOT NULL,
      image_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      published_at TEXT
    )
  `);
}
