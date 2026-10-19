import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const botEnv = process.argv[2];
const apiBase = process.argv[3];

if (!botEnv || !apiBase) {
  throw new Error("Usage: node scripts/connect-posting-bot.mjs <bot-.env> <https://host/api/bot/v1/>");
}
const parsedBase = new URL(apiBase);
if (parsedBase.protocol !== "https:" || !parsedBase.pathname.endsWith("/api/bot/v1/")) {
  throw new Error("Production API base must use HTTPS and end with /api/bot/v1/");
}

const siteFiles = [
  [path.join(root, ".env"), path.join(root, ".env.production.example")]
];
const botValues = parse(read(botEnv));
const siteValues = siteFiles.map(([target, example]) => ({ target, example, values: parse(read(target) || read(example)) }));
const existingSiteTokens = [...new Set(siteValues.map(({ values }) => values.get("BOT_INTEGRATION_TOKEN")).filter(isUsableSecret))];
if (existingSiteTokens.length > 1) throw new Error("Site environment files have different existing BOT_INTEGRATION_TOKEN values; no file was changed");
const existing = existingSiteTokens[0]
  || botValues.get("HEALTHYSTOCK_INTEGRATION_TOKEN");
const token = isUsableSecret(existing) ? existing : crypto.randomBytes(64).toString("base64url");

for (const site of siteValues) {
  if (!isUsableSecret(site.values.get("BOT_INTEGRATION_TOKEN"))) site.values.set("BOT_INTEGRATION_TOKEN", token);
  if (!usablePublicUrl(site.values.get("PUBLIC_SITE_URL"))) site.values.set("PUBLIC_SITE_URL", parsedBase.origin);
  write(site.target, site.values);
}

const specs = JSON.parse(botValues.get("SITES_JSON") || "[]");
const entry = {
  id: "healthystock",
  name: "HealthyStock",
  api_base: apiBase,
  token_env: "HEALTHYSTOCK_INTEGRATION_TOKEN"
};
const index = specs.findIndex((item) => item.id === entry.id);
if (index >= 0) specs[index] = entry;
else specs.push(entry);
botValues.set("SITES_JSON", JSON.stringify(specs));
botValues.set(entry.token_env, token);
write(botEnv, botValues);

const siteTokensMatch = siteValues.every(({ values }) => values.get("BOT_INTEGRATION_TOKEN") === token);
if (!siteTokensMatch) throw new Error("Existing site BOT_INTEGRATION_TOKEN values differ; no secret was replaced");
console.log(`Connected ${entry.id}: ${entry.api_base}`);
console.log("SITES_JSON is valid and integration token values match (values not shown).");

function read(file) {
  try { return fs.readFileSync(file, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return ""; throw error; }
}

function parse(source) {
  const values = new Map();
  for (const line of source.split(/\r?\n/u)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals > 0) values.set(line.slice(0, equals).trim(), line.slice(equals + 1));
  }
  return values;
}

function write(file, values) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${[...values].map(([key, value]) => `${key}=${value}`).join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
}

function isUsableSecret(value) {
  return Boolean(value && value.length >= 32 && !value.includes("replace-") && !value.includes("changeme"));
}

function usablePublicUrl(value) {
  if (!value || value.includes("yourdomain")) return false;
  try { return new URL(value).protocol === "https:" || new URL(value).hostname === "localhost"; }
  catch { return false; }
}
