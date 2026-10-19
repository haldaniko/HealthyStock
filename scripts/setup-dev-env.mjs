import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function secret() {
  return crypto.randomBytes(64).toString("base64url");
}

function parseEnv(text) {
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    values.set(line.slice(0, index), line.slice(index + 1));
  }
  return values;
}

function stringifyEnv(values, order) {
  const keys = [...new Set([...order, ...values.keys()])];
  return `${keys.map((key) => `${key}=${values.get(key) ?? ""}`).join("\n")}\n`;
}

function ensureEnv({ file, example, defaults = {}, generated = {} }) {
  const target = path.join(root, file);
  const source = path.join(root, example);
  const initial = fs.existsSync(target)
    ? fs.readFileSync(target, "utf8")
    : fs.existsSync(source)
      ? fs.readFileSync(source, "utf8")
      : "";

  const values = parseEnv(initial);
  const order = [...values.keys()];

  for (const [key, value] of Object.entries(defaults)) {
    if (!values.get(key)) {
      values.set(key, value);
      order.push(key);
    }
  }

  for (const [key, makeValue] of Object.entries(generated)) {
    if (!values.get(key)) {
      values.set(key, makeValue());
      order.push(key);
    }
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, stringifyEnv(values, order));
  console.log(`Ready: ${file}`);
}

ensureEnv({
  file: ".env",
  example: ".env.example",
  defaults: {
    LOCAL_SUPERADMIN_EMAIL: "admin@healthystock.local",
    LOCAL_SUPERADMIN_PASSWORD: "MySecretPassword123!"
  }
});

ensureEnv({
  file: "frontend/.env",
  example: "frontend/.env.example",
  defaults: {
    VITE_API_URL: "http://localhost:4000"
  }
});

ensureEnv({
  file: "backend/.env",
  example: "backend/.env.example",
  defaults: {
    PORT: "4000",
    CORS_ORIGIN: "http://localhost:3000,http://localhost:8080",
    DATABASE_URL: "postgres://healthystock:healthystock@localhost:5432/healthystock",
    REDIS_URL: "redis://localhost:6379",
    PUBLIC_SITE_URL: "http://localhost:3000",
    POSTGRES_DB: "healthystock",
    POSTGRES_USER: "healthystock",
    POSTGRES_PASSWORD: "healthystock",
    OPENROUTER_MODEL: "meta-llama/llama-3.1-8b-instruct",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1/chat/completions",
    OPENROUTER_TIMEOUT_MS: "45000",
    OPENROUTER_MAX_INPUT_CHARS: "16000",
    OPENROUTER_MAX_OUTPUT_TOKENS: "2200",
    OPENROUTER_TEMPERATURE: "0.7",
    OPENROUTER_SITE_URL: "http://localhost:3000",
    OPENROUTER_APP_NAME: "HealthyStock",
    REFRESH_COOKIE_DOMAIN: "",
    REFRESH_COOKIE_SAMESITE: "lax",
    TRUST_PROXY: "false",
    SMTP_HOST: "",
    SMTP_PORT: "587",
    SMTP_USER: "",
    SMTP_PASS: "",
    SMTP_FROM: "\"HealthyStock <newsletter@healthystock.local>\""
  },
  generated: {
    JWT_SECRET: secret,
    REFRESH_TOKEN_SECRET: secret,
    BOT_INTEGRATION_TOKEN: secret
  }
});

console.log("");
console.log("Dev env is ready.");
console.log("Fill backend/.env OPENROUTER_API_KEY if AI generation is needed.");
console.log("Then run: docker compose up --build -d");
