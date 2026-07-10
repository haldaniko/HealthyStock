import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const rootEnvPath = path.join(rootDir, ".env.production");
const rootExamplePath = path.join(rootDir, ".env.production.example");
const backendEnvPath = path.join(rootDir, "backend/.env.production");
const backendExamplePath = path.join(rootDir, "backend/.env.production.example");

const generated = {
  POSTGRES_PASSWORD: randomSecret(32),
  LOCAL_SUPERADMIN_EMAIL: "admin@healthystock.com",
  LOCAL_SUPERADMIN_PASSWORD: randomSecret(32),
  JWT_SECRET: randomSecret(64),
  REFRESH_TOKEN_SECRET: randomSecret(64)
};

const rootEnv = await upsertEnvFile(rootExamplePath, rootEnvPath, {
  POSTGRES_PASSWORD: generated.POSTGRES_PASSWORD,
  LOCAL_SUPERADMIN_EMAIL: generated.LOCAL_SUPERADMIN_EMAIL,
  LOCAL_SUPERADMIN_PASSWORD: generated.LOCAL_SUPERADMIN_PASSWORD
});

const postgresUser = rootEnv.POSTGRES_USER || "healthystock";
const postgresDb = rootEnv.POSTGRES_DB || "healthystock";
const postgresPassword = rootEnv.POSTGRES_PASSWORD || generated.POSTGRES_PASSWORD;
const dockerDatabaseUrl = `postgres://${postgresUser}:${postgresPassword}@postgres:5432/${postgresDb}`;

await upsertEnvFile(backendExamplePath, backendEnvPath, {
  JWT_SECRET: generated.JWT_SECRET,
  REFRESH_TOKEN_SECRET: generated.REFRESH_TOKEN_SECRET
}, {
  DATABASE_URL: dockerDatabaseUrl
});

console.log("Production env setup complete.");
console.log("");
console.log("Created/updated:");
console.log(`- ${relative(rootEnvPath)}`);
console.log(`- ${relative(backendEnvPath)}`);
console.log("");
console.log("Generated values only when missing or still set to placeholders:");
console.log("- POSTGRES_PASSWORD");
console.log("- LOCAL_SUPERADMIN_PASSWORD");
console.log("- JWT_SECRET");
console.log("- REFRESH_TOKEN_SECRET");
console.log("- DATABASE_URL is synchronized from POSTGRES_* values");
console.log("");
console.log("Review and replace placeholders before deploying:");
console.log("- VITE_API_URL");
console.log("- VITE_GA_MEASUREMENT_ID if Google Analytics is needed");
console.log("- CORS_ORIGIN");
console.log("- OPENROUTER_API_KEY");
console.log("- OPENROUTER_SITE_URL");
console.log("- OPENROUTER_* tuning values if needed");
console.log("- SMTP_* if email delivery is needed");

async function upsertEnvFile(examplePath, targetPath, generatedValues, forcedValues = {}) {
  const example = await fs.readFile(examplePath, "utf-8");
  const existing = await readOptional(targetPath);
  const existingValues = parseEnv(existing);
  const envValues = { ...parseEnv(example), ...existingValues };

  for (const [key, value] of Object.entries(generatedValues)) {
    if (shouldGenerate(envValues[key])) {
      envValues[key] = value;
    }
  }

  for (const [key, value] of Object.entries(forcedValues)) {
    envValues[key] = value;
  }

  const output = renderEnv(example, envValues);
  await fs.writeFile(targetPath, output, "utf-8");
  return envValues;
}

async function readOptional(filePath) {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

function parseEnv(source) {
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const index = line.indexOf("=");
    if (index < 0) {
      continue;
    }

    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    values[key] = value;
  }
  return values;
}

function renderEnv(template, values) {
  const seen = new Set();
  const lines = template.split(/\r?\n/).map((line) => {
    const index = line.indexOf("=");
    if (index < 0 || line.trim().startsWith("#")) {
      return line;
    }

    const key = line.slice(0, index).trim();
    seen.add(key);
    return `${key}=${values[key] ?? ""}`;
  });

  const extraKeys = Object.keys(values).filter((key) => !seen.has(key));
  if (extraKeys.length > 0) {
    lines.push("");
    lines.push("# Existing custom values preserved by setup script.");
    for (const key of extraKeys) {
      lines.push(`${key}=${values[key]}`);
    }
  }

  return `${lines.join("\n").replace(/\n+$/u, "")}\n`;
}

function shouldGenerate(value) {
  return (
    !value ||
    value.includes("replace-with") ||
    value.includes("your-strong") ||
    value.includes("example") ||
    value === "changeme"
  );
}

function randomSecret(bytes) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function relative(filePath) {
  return path.relative(rootDir, filePath);
}
