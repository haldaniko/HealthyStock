import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import Database from "better-sqlite3";
import express from "express";

const tempRoot = mkdtempSync(path.join(tmpdir(), "healthystock-bot-"));
const databasePath = path.join(tempRoot, "test.sqlite3");
const uploadPath = path.join(tempRoot, "uploads");
const token = "integration-test-token";
const externalId = "2b48ca54-0671-4cb7-b0bb-cc4331c86a48";
let origin = "";
let closeServer: (() => Promise<void>) | undefined;

const payload = {
  external_id: externalId,
  title: "Bot integration article",
  content: "First paragraph.\n\nSecond paragraph.",
  summary: "A useful integration test article.",
  category_slugs: ["nutrients"],
  author_slug: "maria-iordanova",
  tag_names: ["testing", "nutrition"]
};

function headers(givenToken = token) {
  return { authorization: `Bearer ${givenToken}`, "content-type": "application/json" };
}

async function read(response: Response) {
  const body = await response.json() as Record<string, unknown>;
  return { response, body };
}

before(async () => {
  process.env.DATABASE_URL = `sqlite:${databasePath}`;
  process.env.UPLOAD_DIR = uploadPath;
  process.env.PUBLIC_SITE_URL = "https://healthystock.example";
  process.env.BOT_INTEGRATION_TOKEN = token;
  process.env.NODE_ENV = "test";

  const { sqliteSchema } = await import("../src/services/sqliteSchema.js");
  const db = new Database(databasePath);
  db.exec(sqliteSchema);
  db.exec("DROP TABLE bot_articles"); // Simulate an existing pre-integration production database.
  db.prepare("INSERT INTO migration_meta (id, source, completed_at, counts) VALUES (1, 'test', ?, '{}')").run(new Date().toISOString());
  db.close();
  const { initDb } = await import("../src/services/db.js");
  await initDb();

  const [{ default: botRouter }, { default: postsRouter }, { errorHandler }] = await Promise.all([
    import("../src/routes/bot.js"),
    import("../src/routes/posts.js"),
    import("../src/middleware/errorHandler.js")
  ]);
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/uploads", express.static(uploadPath));
  app.use("/api/posts", postsRouter);
  app.use("/api/bot/v1", botRouter);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  origin = `http://127.0.0.1:${address.port}`;
  closeServer = () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

after(async () => {
  await closeServer?.();
  const { closeDatabase } = await import("../src/services/db.js");
  closeDatabase();
  rmSync(tempRoot, { recursive: true, force: true });
});

test("rejects missing, empty-config, and incorrect bearer tokens", async () => {
  assert.equal((await fetch(`${origin}/api/bot/v1/options/`)).status, 403);
  assert.equal((await fetch(`${origin}/api/bot/v1/options/`, { headers: { authorization: "Bearer wrong" } })).status, 403);
  process.env.BOT_INTEGRATION_TOKEN = "";
  assert.equal((await fetch(`${origin}/api/bot/v1/options/`, { headers: { authorization: `Bearer ${token}` } })).status, 403);
  process.env.BOT_INTEGRATION_TOKEN = token;
});

test("returns supported categories and authors", async () => {
  const { response, body } = await read(await fetch(`${origin}/api/bot/v1/options/`, { headers: { authorization: `Bearer ${token}` } }));
  assert.equal(response.status, 200);
  assert.equal(body.version, 1);
  assert.equal(body.site, "healthystock");
  assert(Array.isArray(body.categories) && body.categories.length > 0);
});

test("creates one draft, recovers it, and rejects a conflicting retry", async () => {
  const first = await read(await fetch(`${origin}/api/bot/v1/articles/`, { method: "POST", headers: headers(), body: JSON.stringify(payload) }));
  assert.equal(first.response.status, 201);
  assert.equal(first.body.status, "draft");
  assert.equal(first.body.image_url, null);

  const publicSlug = new URL(String(first.body.url)).pathname.split("/").pop();
  assert.equal((await fetch(`${origin}/api/posts/${publicSlug}`)).status, 404);

  const retry = await read(await fetch(`${origin}/api/bot/v1/articles/`, { method: "POST", headers: headers(), body: JSON.stringify(payload) }));
  assert.equal(retry.response.status, 201);
  assert.equal(retry.body.article_id, first.body.article_id);

  const recovered = await read(await fetch(`${origin}/api/bot/v1/articles/${externalId}/`, { headers: { authorization: `Bearer ${token}` } }));
  assert.equal(recovered.response.status, 200);
  assert.equal(recovered.body.article_id, first.body.article_id);

  const conflict = await fetch(`${origin}/api/bot/v1/articles/`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ ...payload, title: "Changed title" })
  });
  assert.equal(conflict.status, 409);

  const db = new Database(databasePath, { readonly: true });
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM bot_articles WHERE external_id = ?").get(externalId) as { count: number }).count, 1);
  db.close();
});

test("serializes concurrent create retries", async () => {
  const concurrentId = "318df23f-962c-48bf-9748-af017326c146";
  const concurrentPayload = { ...payload, external_id: concurrentId, title: "Concurrent retry" };
  const responses = await Promise.all(Array.from({ length: 6 }, () => fetch(`${origin}/api/bot/v1/articles/`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(concurrentPayload)
  })));
  assert(responses.every((response) => response.status === 201));
  const bodies = await Promise.all(responses.map((response) => response.json() as Promise<{ article_id: string }>));
  assert.equal(new Set(bodies.map((body) => body.article_id)).size, 1);
  const db = new Database(databasePath, { readonly: true });
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM bot_articles WHERE external_id = ?").get(concurrentId) as { count: number }).count, 1);
  db.close();
});

test("validates, stores, and idempotently returns an uploaded image", async () => {
  const badForm = new FormData();
  badForm.append("image", new Blob(["not an image"], { type: "image/png" }), "fake.png");
  assert.equal((await fetch(`${origin}/api/bot/v1/articles/${externalId}/image/`, { method: "PUT", headers: { authorization: `Bearer ${token}` }, body: badForm })).status, 400);

  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const imageForm = new FormData();
  imageForm.append("image", new Blob([png], { type: "image/png" }), "cover.png");
  const uploaded = await read(await fetch(`${origin}/api/bot/v1/articles/${externalId}/image/`, { method: "PUT", headers: { authorization: `Bearer ${token}` }, body: imageForm }));
  assert.equal(uploaded.response.status, 200);
  assert.match(String(uploaded.body.image_url), /^https:\/\/healthystock\.example\/uploads\/bot\//u);

  const secondForm = new FormData();
  secondForm.append("image", new Blob([png], { type: "image/png" }), "again.png");
  const repeated = await read(await fetch(`${origin}/api/bot/v1/articles/${externalId}/image/`, { method: "PUT", headers: { authorization: `Bearer ${token}` }, body: secondForm }));
  assert.equal(repeated.body.image_url, uploaded.body.image_url);
  assert.equal(readdirSync(path.join(uploadPath, "bot")).length, 1);

  const imagePath = new URL(String(uploaded.body.image_url)).pathname;
  assert.equal((await fetch(`${origin}${imagePath}`)).status, 200);
});

test("publishes once, exposes the public article, and then blocks image changes", async () => {
  const first = await read(await fetch(`${origin}/api/bot/v1/articles/${externalId}/publish/`, { method: "POST", headers: { authorization: `Bearer ${token}` } }));
  assert.equal(first.response.status, 200);
  assert.equal(first.body.status, "published");
  assert(String(first.body.url));

  const second = await read(await fetch(`${origin}/api/bot/v1/articles/${externalId}/publish/`, { method: "POST", headers: { authorization: `Bearer ${token}` } }));
  assert.deepEqual(second.body, first.body);

  const publicSlug = new URL(String(first.body.url)).pathname.split("/").pop();
  const publicArticle = await fetch(`${origin}/api/posts/${publicSlug}`);
  assert.equal(publicArticle.status, 200);
  const publicBody = await publicArticle.json() as { status: string; coverImage: string };
  assert.equal(publicBody.status, "published");
  assert.match(publicBody.coverImage, /^\/uploads\/bot\//u);

  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const form = new FormData();
  form.append("image", new Blob([png], { type: "image/png" }), "cover.png");
  assert.equal((await fetch(`${origin}/api/bot/v1/articles/${externalId}/image/`, { method: "PUT", headers: { authorization: `Bearer ${token}` }, body: form })).status, 409);

  const missing = "862cb2d5-f0f3-4e26-bbf1-c4ce9f02f120";
  assert.equal((await fetch(`${origin}/api/bot/v1/articles/${missing}/`, { headers: { authorization: `Bearer ${token}` } })).status, 404);
  assert.equal((await fetch(`${origin}/api/bot/v1/articles/${missing}/publish/`, { method: "POST", headers: { authorization: `Bearer ${token}` } })).status, 404);
});
