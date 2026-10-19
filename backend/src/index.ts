import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "node:path";
import postsRouter from "./routes/posts.js";
import subscribersRouter from "./routes/subscribers.js";
import aiRouter from "./routes/ai.js";
import healthIndexRouter from "./routes/healthIndex.js";
import authRouter from "./routes/auth.js";
import adminRouter from "./routes/admin.js";
import botRouter from "./routes/bot.js";
import { startGenerationScheduler } from "./services/generationScheduler.js";
import { validateProductionAuthConfig } from "./services/auth.js";
import { initDb } from "./services/db.js";
import { migrateLegacyDataIfNeeded } from "./services/legacyDataMigration.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { validateBotIntegrationConfig } from "./services/botIntegration.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);

validateProductionAuthConfig();
validateBotIntegrationConfig();

if (process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
}

app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? [
      "http://localhost:3000",
      "http://localhost:8080"
    ],
    credentials: true
  })
);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(morgan("dev"));
app.use(express.json({ limit: "10mb" }));
const uploadDir = process.env.UPLOAD_DIR || path.resolve(process.cwd(), "uploads");
app.use("/uploads", express.static(uploadDir));
app.use("/api/uploads", express.static(uploadDir));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "healthystock-backend" });
});

app.use("/api/posts", postsRouter);
app.use("/api/subscribe", subscribersRouter);
app.use("/api/ai", aiRouter);
app.use("/api/health-index", healthIndexRouter);
app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/api/bot/v1", botRouter);
app.use(errorHandler);

async function startServer() {
  await initDb();
  await migrateLegacyDataIfNeeded();

  app.listen(port, () => {
    console.log(`HealthyStock backend listening on :${port}`);
    startGenerationScheduler();
  });
}

startServer().catch((error) => {
  console.error("Failed to start backend", error);
  process.exit(1);
});
