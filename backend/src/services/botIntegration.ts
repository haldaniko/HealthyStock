import { createHash, randomUUID } from "node:crypto";
import { promises as fs, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import slugify from "slugify";
import { isSqliteDatabase, openSqlite, query } from "./db.js";
import { pool } from "./postgresDb.js";

export const botCategories = [
  { slug: "comparisons", name: "Comparisons" },
  { slug: "nutrients", name: "Nutrients" },
  { slug: "rankings", name: "Rankings" }
] as const;

export const botAuthors = [
  { slug: "maria-iordanova", name: "Maria Iordanova" }
] as const;

export interface BotArticleInput {
  external_id: string;
  title: string;
  content: string;
  summary: string;
  category_slugs: string[];
  author_slug: string | null;
  tag_names: string[];
}

export interface BotArticleResult {
  article_id: string;
  status: "draft" | "published";
  url: string;
  image_url: string | null;
}

interface ArticleRow {
  external_id: string;
  payload_hash: string;
  id: string;
  slug: string;
  status: "draft" | "published";
  cover_image: string | null;
}

function apiError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
}

function publicBaseUrl() {
  const fallback = process.env.NODE_ENV === "production" ? "" : "http://localhost:3000";
  const value = (process.env.PUBLIC_SITE_URL || fallback).trim().replace(/\/$/u, "");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("PUBLIC_SITE_URL must be an absolute public URL");
  }
  if (!/^https?:$/u.test(parsed.protocol)) {
    throw new Error("PUBLIC_SITE_URL must use HTTP or HTTPS");
  }
  if (process.env.NODE_ENV === "production" && (parsed.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname))) {
    throw new Error("PUBLIC_SITE_URL must be a non-local HTTPS URL in production");
  }
  return value;
}

export function validateBotIntegrationConfig() {
  publicBaseUrl();
}

function result(row: ArticleRow): BotArticleResult {
  const base = publicBaseUrl();
  return {
    article_id: row.id,
    status: row.status,
    url: `${base}/blog/${encodeURIComponent(row.slug)}`,
    image_url: row.cover_image ? `${base}${row.cover_image}` : null
  };
}

function payloadHash(input: BotArticleInput) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function articleHtml(content: string) {
  const escaped = content
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
  return escaped.split(/\n{2,}/u).map((paragraph) => `<p>${paragraph.replace(/\n/gu, "<br>")}</p>`).join("\n");
}

function readTime(content: string) {
  const words = content.trim().split(/\s+/u).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 220));
}

function normalizedPost(input: BotArticleInput) {
  const category = botCategories.find((item) => item.slug === input.category_slugs[0])!;
  const author = input.author_slug
    ? botAuthors.find((item) => item.slug === input.author_slug)!.name
    : "HealthyStock Editorial Team";
  const slugBase = slugify(input.title, { lower: true, strict: true }).slice(0, 160) || "article";
  return {
    id: randomUUID(),
    slug: `${slugBase}-${input.external_id.replaceAll("-", "")}`,
    excerpt: input.summary || input.content.replace(/\s+/gu, " ").trim().slice(0, 500),
    html: articleHtml(input.content),
    author,
    category: category.name,
    primaryKeyword: input.tag_names[0] || category.name,
    secondaryKeywords: input.tag_names,
    readTimeMinutes: readTime(input.content)
  };
}

const selectArticle = `
  SELECT b.external_id, b.payload_hash, p.id, p.slug, p.status, p.cover_image
  FROM bot_articles b JOIN generated_posts p ON p.id = b.post_id
  WHERE b.external_id = $1`;

export async function getBotArticle(externalId: string): Promise<BotArticleResult | null> {
  const rows = await query<ArticleRow>(selectArticle, [externalId]);
  return rows[0] ? result(rows[0]) : null;
}

export async function createBotArticle(input: BotArticleInput): Promise<BotArticleResult> {
  const hash = payloadHash(input);
  const post = normalizedPost(input);
  if (isSqliteDatabase()) {
    const db = openSqlite();
    db.exec("BEGIN IMMEDIATE");
    try {
      const existing = db.prepare(selectArticle.replace("$1", "?")).get(input.external_id) as ArticleRow | undefined;
      if (existing) {
        if (existing.payload_hash !== hash) throw apiError(409, "external_id already exists with different article data");
        db.exec("COMMIT");
        return result(existing);
      }
      db.prepare(`INSERT INTO generated_posts (
        id, title, slug, excerpt, content, cover_image, author, published_at,
        read_time_minutes, primary_keyword, secondary_keywords, category, rating, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, date('now'), ?, ?, ?, ?, 'B', 'draft', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`).run(
        post.id, input.title, post.slug, post.excerpt, post.html, post.author, post.readTimeMinutes,
        post.primaryKeyword, JSON.stringify(post.secondaryKeywords), post.category
      );
      db.prepare("INSERT INTO bot_articles (external_id, post_id, payload_hash) VALUES (?, ?, ?)").run(input.external_id, post.id, hash);
      const created = db.prepare(selectArticle.replace("$1", "?")).get(input.external_id) as ArticleRow;
      db.exec("COMMIT");
      return result(created);
    } catch (error) {
      if (db.inTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.external_id]);
    const existing = (await client.query<ArticleRow>(selectArticle, [input.external_id])).rows[0];
    if (existing) {
      if (existing.payload_hash !== hash) throw apiError(409, "external_id already exists with different article data");
      await client.query("COMMIT");
      return result(existing);
    }
    await client.query(`INSERT INTO generated_posts (
      id, title, slug, excerpt, content, cover_image, author, published_at,
      read_time_minutes, primary_keyword, secondary_keywords, category, rating, status, updated_at
    ) VALUES ($1, $2, $3, $4, $5, NULL, $6, CURRENT_DATE, $7, $8, $9, $10, 'B', 'draft', NOW())`, [
      post.id, input.title, post.slug, post.excerpt, post.html, post.author, post.readTimeMinutes,
      post.primaryKeyword, post.secondaryKeywords, post.category
    ]);
    await client.query("INSERT INTO bot_articles (external_id, post_id, payload_hash) VALUES ($1, $2, $3)", [input.external_id, post.id, hash]);
    const created = (await client.query<ArticleRow>(selectArticle, [input.external_id])).rows[0];
    await client.query("COMMIT");
    return result(created);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function imageType(buffer: Buffer): { mime: string; extension: string } | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: "image/jpeg", extension: "jpg" };
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", extension: "png" };
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return { mime: "image/webp", extension: "webp" };
  return null;
}

function imageTarget(externalId: string, buffer: Buffer, extension: string) {
  const hash = createHash("sha256").update(buffer).digest("hex");
  const name = `${externalId}-${hash.slice(0, 16)}.${extension}`;
  const relative = `/uploads/bot/${name}`;
  return { hash, relative, absolute: path.join(process.env.UPLOAD_DIR || path.resolve(process.cwd(), "uploads"), "bot", name) };
}

export async function uploadBotArticleImage(externalId: string, buffer: Buffer): Promise<BotArticleResult> {
  const kind = imageType(buffer);
  if (!kind) throw apiError(400, "Image must be a valid JPG, PNG, or WebP file");
  if (buffer.byteLength > 10 * 1024 * 1024) throw apiError(400, "Image must be 10 MiB or smaller");
  const target = imageTarget(externalId, buffer, kind.extension);

  if (isSqliteDatabase()) {
    const db = openSqlite();
    db.exec("BEGIN IMMEDIATE");
    let wroteFile = false;
    try {
      const current = db.prepare(selectArticle.replace("$1", "?")).get(externalId) as ArticleRow | undefined;
      if (!current) throw apiError(404, "Article not found");
      if (current.status === "published") throw apiError(409, "Published articles cannot be changed");
      if (current.cover_image) {
        db.exec("COMMIT");
        return result(current);
      }
      mkdirSync(path.dirname(target.absolute), { recursive: true });
      writeFileSync(target.absolute, buffer, { flag: "wx" });
      wroteFile = true;
      db.prepare("UPDATE generated_posts SET cover_image = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(target.relative, current.id);
      db.prepare("UPDATE bot_articles SET image_hash = ? WHERE external_id = ?").run(target.hash, externalId);
      const updated = db.prepare(selectArticle.replace("$1", "?")).get(externalId) as ArticleRow;
      db.exec("COMMIT");
      return result(updated);
    } catch (error) {
      if (db.inTransaction) db.exec("ROLLBACK");
      if (wroteFile) await fs.unlink(target.absolute).catch(() => undefined);
      throw error;
    }
  }

  const client = await pool.connect();
  let wroteFile = false;
  try {
    await client.query("BEGIN");
    const current = (await client.query<ArticleRow>(`${selectArticle} FOR UPDATE`, [externalId])).rows[0];
    if (!current) throw apiError(404, "Article not found");
    if (current.status === "published") throw apiError(409, "Published articles cannot be changed");
    if (current.cover_image) {
      await client.query("COMMIT");
      return result(current);
    }
    await fs.mkdir(path.dirname(target.absolute), { recursive: true });
    await fs.writeFile(target.absolute, buffer, { flag: "wx" });
    wroteFile = true;
    await client.query("UPDATE generated_posts SET cover_image = $1, updated_at = NOW() WHERE id = $2", [target.relative, current.id]);
    await client.query("UPDATE bot_articles SET image_hash = $1 WHERE external_id = $2", [target.hash, externalId]);
    const updated = (await client.query<ArticleRow>(selectArticle, [externalId])).rows[0];
    await client.query("COMMIT");
    return result(updated);
  } catch (error) {
    await client.query("ROLLBACK");
    if (wroteFile) await fs.unlink(target.absolute).catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function publishBotArticle(externalId: string): Promise<BotArticleResult> {
  if (isSqliteDatabase()) {
    const db = openSqlite();
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = db.prepare(selectArticle.replace("$1", "?")).get(externalId) as ArticleRow | undefined;
      if (!current) throw apiError(404, "Article not found");
      if (current.status === "draft") {
        db.prepare("UPDATE generated_posts SET status = 'published', published_at = date('now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(current.id);
        db.prepare("UPDATE bot_articles SET published_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE external_id = ? AND published_at IS NULL").run(externalId);
      } else if (current.status !== "published") {
        throw apiError(409, "Article cannot be published from its current state");
      }
      const updated = db.prepare(selectArticle.replace("$1", "?")).get(externalId) as ArticleRow;
      db.exec("COMMIT");
      return result(updated);
    } catch (error) {
      if (db.inTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = (await client.query<ArticleRow>(`${selectArticle} FOR UPDATE`, [externalId])).rows[0];
    if (!current) throw apiError(404, "Article not found");
    if (current.status === "draft") {
      await client.query("UPDATE generated_posts SET status = 'published', published_at = CURRENT_DATE, updated_at = NOW() WHERE id = $1", [current.id]);
      await client.query("UPDATE bot_articles SET published_at = COALESCE(published_at, NOW()) WHERE external_id = $1", [externalId]);
    } else if (current.status !== "published") {
      throw apiError(409, "Article cannot be published from its current state");
    }
    const updated = (await client.query<ArticleRow>(selectArticle, [externalId])).rows[0];
    await client.query("COMMIT");
    return result(updated);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
