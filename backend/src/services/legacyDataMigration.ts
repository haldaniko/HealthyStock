import { promises as fs } from "node:fs";
import path from "node:path";
import { query } from "./db.js";

type LegacyBlogPost = {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  coverImage?: string;
  author: string;
  publishedAt: string;
  readTimeMinutes: number;
  primaryKeyword: string;
  secondaryKeywords: string[];
  category: string;
  rating: "A+" | "A" | "B" | "C" | "D" | "F";
  status?: "draft" | "published";
};

type LegacySettings = {
  masterPrompt?: string;
  autoGenerationEnabled?: boolean;
  generationTopic?: string;
  generationTime?: string;
  generationFrequency?: "manual" | "daily" | "weekly" | "monthly";
  lastGeneratedAt?: string;
  lastGenerationStatus?: string;
};

type LegacySubscriber = {
  email: string;
  source: string;
  createdAt?: string;
};

type LegacyRefreshToken = {
  tokenHash: string;
  subject: string;
  createdAt: string;
  expiresAt: string;
};

type LegacyAuditEvent = {
  actor: string;
  action: string;
  target?: string;
  details?: Record<string, unknown>;
  createdAt?: string;
};

const dataDir = path.resolve(process.cwd(), "data");

export async function migrateLegacyDataIfNeeded() {
  await migrateGeneratedPosts();
  await migrateAdminSettings();
  await migrateSubscribers();
  await migrateRefreshTokens();
  await migrateAuditEvents();
}

async function migrateGeneratedPosts() {
  const existing = await query<{ count: string }>("SELECT COUNT(*)::text AS count FROM generated_posts");
  if (Number(existing[0]?.count ?? "0") > 0) {
    return;
  }

  const posts = await readJsonFile<LegacyBlogPost[]>(path.join(dataDir, "generated-posts.json"), []);
  for (const post of posts) {
    await query(
      `INSERT INTO generated_posts (
        id, title, slug, excerpt, content, cover_image, author, published_at,
        read_time_minutes, primary_keyword, secondary_keywords, category, rating, status, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10, $11, $12, $13, $14, NOW())
      ON CONFLICT (slug) DO NOTHING`,
      [
        post.id,
        post.title,
        post.slug,
        post.excerpt,
        post.content,
        post.coverImage ?? null,
        post.author,
        post.publishedAt,
        post.readTimeMinutes,
        post.primaryKeyword,
        post.secondaryKeywords,
        post.category,
        post.rating,
        post.status ?? "published"
      ]
    );
  }
}

async function migrateAdminSettings() {
  const existing = await query<{ count: string }>("SELECT COUNT(*)::text AS count FROM admin_settings");
  if (Number(existing[0]?.count ?? "0") > 0) {
    return;
  }

  const settings = await readJsonFile<LegacySettings | null>(path.join(dataDir, "admin-settings.json"), null);
  if (!settings) {
    return;
  }

  await query(
    `INSERT INTO admin_settings (
      id, master_prompt, auto_generation_enabled, generation_topic,
      generation_time, generation_times, generation_frequency, last_generated_at,
      last_generation_status, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
    ON CONFLICT (id) DO NOTHING`,
    [
      1,
      settings.masterPrompt ?? "",
      Boolean(settings.autoGenerationEnabled),
      settings.generationTopic ?? "",
      settings.generationTime ?? "09:00",
      [settings.generationTime ?? "09:00"],
      settings.generationFrequency ?? "manual",
      settings.lastGeneratedAt ?? null,
      settings.lastGenerationStatus ?? null
    ]
  );
}

async function migrateSubscribers() {
  const existing = await query<{ count: string }>("SELECT COUNT(*)::text AS count FROM subscribers");
  if (Number(existing[0]?.count ?? "0") > 0) {
    return;
  }

  const subscribers = await readJsonFile<LegacySubscriber[]>(path.join(dataDir, "subscribers.json"), []);
  for (const subscriber of subscribers) {
    await query(
      `INSERT INTO subscribers (email, source, created_at)
       VALUES ($1, $2, COALESCE($3::timestamptz, NOW()))
       ON CONFLICT (email) DO NOTHING`,
      [subscriber.email.trim().toLowerCase(), subscriber.source || "legacy", subscriber.createdAt ?? null]
    );
  }
}

async function migrateRefreshTokens() {
  const existing = await query<{ count: string }>("SELECT COUNT(*)::text AS count FROM refresh_tokens");
  if (Number(existing[0]?.count ?? "0") > 0) {
    return;
  }

  const tokens = await readJsonFile<LegacyRefreshToken[]>(path.join(dataDir, "refresh-tokens.json"), []);
  for (const token of tokens) {
    await query(
      `INSERT INTO refresh_tokens (token_hash, subject, created_at, expires_at)
       VALUES ($1, $2, $3::timestamptz, $4::timestamptz)
       ON CONFLICT (token_hash) DO NOTHING`,
      [token.tokenHash, token.subject, token.createdAt, token.expiresAt]
    ).catch(() => undefined);
  }

  await query(`DELETE FROM refresh_tokens WHERE expires_at <= NOW()`);
}

async function migrateAuditEvents() {
  const existing = await query<{ count: string }>("SELECT COUNT(*)::text AS count FROM audit_events");
  if (Number(existing[0]?.count ?? "0") > 0) {
    return;
  }

  const filePath = path.join(dataDir, "audit-log.jsonl");
  let content = "";
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    return;
  }

  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    try {
      const event = JSON.parse(line) as LegacyAuditEvent;
      await query(
        `INSERT INTO audit_events (actor, action, target, details, created_at)
         VALUES ($1, $2, $3, $4::jsonb, COALESCE($5::timestamptz, NOW()))`,
        [
          event.actor,
          event.action,
          event.target ?? null,
          JSON.stringify(event.details ?? {}),
          event.createdAt ?? null
        ]
      );
    } catch {
      // Ignore malformed lines from legacy log files.
    }
  }
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return fallback;
  }
}
