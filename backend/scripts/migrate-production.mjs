import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";
import Database from "better-sqlite3";
import { applicationTables, sqliteSchema } from "../dist/services/sqliteSchema.js";

const root = path.resolve(process.env.HOST_DATA_DIR || "/host");
const target = path.join(root, "db.sqlite3");
const media = path.join(root, "media");
const oldUploads = path.resolve(process.env.OLD_UPLOAD_DIR || "/old-uploads");
const uid = Number(process.env.APP_UID || "10001");
const gid = Number(process.env.APP_GID || "10001");
const pgConfig = {
  host: process.env.POSTGRES_HOST || "postgres",
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB
};
const q = (name) => `"${name.replaceAll('"', '""')}"`;
const columns = {
  users: ["id","email","password_hash","role","is_active","created_at","updated_at","last_login_at"],
  refresh_tokens: ["token_hash","subject","created_at","expires_at"],
  generated_posts: ["id","title","slug","excerpt","content","cover_image","author","published_at","read_time_minutes","primary_keyword","secondary_keywords","category","rating","status","created_at","updated_at"],
  admin_settings: ["id","master_prompt","auto_generation_enabled","generation_topic","generation_time","generation_times","generation_frequency","last_generated_at","last_generation_status","updated_at"],
  subscribers: ["email","source","created_at"],
  audit_events: ["id","actor","action","target","details","created_at"]
};

function checkSqlite(db, expectedCounts = null) {
  if (db.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("SQLite integrity_check failed");
  if (db.pragma("foreign_key_check").length) throw new Error("SQLite foreign_key_check failed");
  const marker = db.prepare("SELECT source, counts FROM migration_meta WHERE id = 1").get();
  if (!marker || marker.source !== "postgresql") throw new Error("SQLite migration marker missing or invalid");
  const importedCounts = JSON.parse(marker.counts);
  const actualCounts = {};
  for (const table of applicationTables) {
    if (!Number.isSafeInteger(importedCounts[table]) || importedCounts[table] < 0) throw new Error(`Invalid migration count: ${table}`);
    const actual = db.prepare(`SELECT COUNT(*) AS n FROM ${q(table)}`).get().n;
    actualCounts[table] = actual;
    if (expectedCounts && actual !== expectedCounts[table]) throw new Error(`${table}: expected ${expectedCounts[table]}, got ${actual}`);
    const names = new Set(db.pragma(`table_info(${q(table)})`).map((c) => c.name));
    for (const name of columns[table]) if (!names.has(name)) throw new Error(`${table}.${name} missing`);
  }
  return actualCounts;
}

async function hash(file) {
  const data = await fs.readFile(file);
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function copyMedia() {
  await fs.mkdir(media, { recursive: true });
  async function visit(source, dest) {
    await fs.mkdir(dest, { recursive: true });
    for (const entry of await fs.readdir(source, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error(`Unexpected media symlink: ${entry.name}`);
      const from = path.join(source, entry.name);
      const to = path.join(dest, entry.name);
      if (entry.isDirectory()) { await visit(from, to); continue; }
      if (!entry.isFile()) throw new Error(`Unexpected media entry: ${entry.name}`);
      let exists = false;
      try {
        const current = await fs.lstat(to);
        if (!current.isFile()) throw new Error(`Non-file media collision: ${to}`);
        exists = true;
      } catch (e) { if (e.code !== "ENOENT") throw e; }
      if (exists) {
        if ((await hash(from)) !== (await hash(to))) throw new Error(`Media collision with different content: ${to}`);
      } else {
        const staged = `${to}.import-${process.pid}`;
        try {
          await fs.copyFile(from, staged, fs.constants.COPYFILE_EXCL);
          if ((await hash(from)) !== (await hash(staged))) throw new Error(`Media copy mismatch: ${from}`);
          const original = await fs.stat(from);
          await fs.utimes(staged, original.atime, original.mtime);
          await fs.chown(staged, uid, gid);
          await fs.link(staged, to); // Atomic publication without replacing an existing file.
        } finally { await fs.rm(staged, { force: true }); }
      }
    }
    await fs.chown(dest, uid, gid);
    await fs.chmod(dest, 0o775);
  }
  await visit(oldUploads, media);
}

function value(table, column, raw) {
  if (raw == null) return null;
  if (raw instanceof Date) return raw.toISOString();
  if (Array.isArray(raw) || (table === "audit_events" && column === "details" && typeof raw === "object")) return JSON.stringify(raw);
  if (typeof raw === "boolean") return Number(raw);
  return raw;
}

async function verifyMediaReferences(db) {
  const rows = db.prepare("SELECT cover_image FROM generated_posts WHERE cover_image LIKE '/uploads/%'").all();
  for (const { cover_image: url } of rows) {
    const relative = decodeURIComponent(url.slice("/uploads/".length));
    const resolved = path.resolve(media, relative);
    if (!resolved.startsWith(media + path.sep) || !(await fs.stat(resolved).then((s) => s.isFile()).catch(() => false))) {
      throw new Error(`Missing referenced upload: ${url}`);
    }
  }
  console.log(`Verified ${rows.length} uploaded cover URL(s) against ./media`);
}

async function giveAppAccess() {
  // SQLite's DELETE journal is created beside db.sqlite3, so the project directory needs group write.
  const stat = await fs.stat(root);
  await fs.chown(root, stat.uid, gid);
  await fs.chmod(root, stat.mode | 0o1070); // Sticky bit protects other project files from renames.
  await fs.chown(target, uid, gid);
  await fs.chmod(target, 0o660);
  await fs.chown(media, uid, gid);
  await fs.chmod(media, 0o775);
}

let maintenance;
let source;
let previousSetting;
let fenced = false;
let published = false;
let temporary;
try {
  try {
    await fs.stat(target);
    const existing = new Database(target, { fileMustExist: true, readonly: true });
    try {
      console.log("Existing SQLite database verified; PostgreSQL data will not be imported again:", checkSqlite(existing));
      await verifyMediaReferences(existing);
    } finally { existing.close(); }
    await giveAppAccess();
    process.exit(0);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (!pgConfig.user || !pgConfig.password || !pgConfig.database) throw new Error("Missing POSTGRES_* credentials");
  maintenance = new pg.Client({ ...pgConfig, database: "postgres" });
  await maintenance.connect();
  const current = await maintenance.query("SELECT s.setconfig FROM pg_database d LEFT JOIN pg_db_role_setting s ON s.setdatabase = d.oid AND s.setrole = 0 WHERE d.datname = $1", [pgConfig.database]);
  if (current.rowCount !== 1) throw new Error("Source PostgreSQL database does not exist");
  previousSetting = current.rows[0].setconfig?.find((x) => x.startsWith("default_transaction_read_only="))?.split("=")[1];
  await maintenance.query(`ALTER DATABASE ${q(pgConfig.database)} SET default_transaction_read_only = on`);
  fenced = true;
  await maintenance.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [pgConfig.database]);
  source = new pg.Client(pgConfig);
  await source.connect();
  await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  temporary = path.join(root, `.db.sqlite3.import-${process.pid}`);
  // A stale temporary file means an interrupted attempt; it is never the live database.
  await fs.rm(temporary, { force: true });
  const db = new Database(temporary);
  try {
    db.pragma("journal_mode = DELETE");
    db.pragma("foreign_keys = ON");
    db.exec(sqliteSchema);
    const counts = {};
    for (const table of applicationTables) {
      const available = new Set((await source.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1", [table])).rows.map((r) => r.column_name));
      for (const column of columns[table]) if (!available.has(column)) throw new Error(`Source column missing: ${table}.${column}`);
      const rows = (await source.query(`SELECT ${columns[table].map(q).join(", ")} FROM public.${q(table)}`)).rows;
      const insert = db.prepare(`INSERT INTO ${q(table)} (${columns[table].map(q).join(", ")}) VALUES (${columns[table].map(() => "?").join(", ")})`);
      db.transaction(() => {
        for (const row of rows) insert.run(...columns[table].map((column) => value(table, column, row[column])));
      })();
      counts[table] = rows.length;
      const pgCount = Number((await source.query(`SELECT COUNT(*) AS n FROM public.${q(table)}`)).rows[0].n);
      if (pgCount !== rows.length) throw new Error(`PostgreSQL snapshot count mismatch: ${table}`);
      console.log(`${table}: ${rows.length} row(s)`);
    }
    db.prepare("INSERT INTO migration_meta (id, source, completed_at, counts) VALUES (1, 'postgresql', ?, ?)").run(new Date().toISOString(), JSON.stringify(counts));
    checkSqlite(db, counts);
    await copyMedia();
    await verifyMediaReferences(db);
  } finally { db.close(); }
  // Ensure no live target has appeared while the import was running.
  try { await fs.stat(target); throw new Error("db.sqlite3 appeared during import; refusing to replace it"); }
  catch (e) { if (e.code !== "ENOENT") throw e; }
  await fs.rename(temporary, target);
  published = true;
  await giveAppAccess();
  await source.query("COMMIT");
  console.log("Migration completed. PostgreSQL remains intact and read-only; ./db.sqlite3 is active.");
} catch (error) {
  console.error("Migration failed:", error);
  if (source) await source.query("ROLLBACK").catch(() => {});
  if (temporary) await fs.rm(temporary, { force: true }).catch(() => {});
  if (fenced && !published && maintenance) {
    const restore = previousSetting == null
      ? `ALTER DATABASE ${q(pgConfig.database)} RESET default_transaction_read_only`
      : `ALTER DATABASE ${q(pgConfig.database)} SET default_transaction_read_only = ${previousSetting === "on" ? "on" : "off"}`;
    await maintenance.query(restore).catch((e) => console.error("Could not restore PostgreSQL write setting:", e));
  }
  process.exitCode = 1;
} finally {
  if (source) await source.end().catch(() => {});
  if (maintenance) await maintenance.end().catch(() => {});
}
