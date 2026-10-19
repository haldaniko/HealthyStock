import { createHash, timingSafeEqual } from "node:crypto";
import { NextFunction, Request, Response, Router } from "express";
import multer from "multer";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler.js";
import {
  botAuthors,
  botCategories,
  createBotArticle,
  getBotArticle,
  publishBotArticle,
  uploadBotArticleImage
} from "../services/botIntegration.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0 }
});

const articleSchema = z.object({
  external_id: z.string().uuid(),
  title: z.string().trim().min(1).max(300),
  content: z.string().trim().min(1),
  summary: z.string().trim().max(1000).optional().default(""),
  category_slugs: z.array(z.string()).min(1),
  author_slug: z.string().nullable().optional().default(null),
  tag_names: z.array(z.string().trim().min(1).max(80)).max(10).optional().default([])
}).strict();

const idSchema = z.string().uuid();

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function requireBotToken(req: Request, res: Response, next: NextFunction) {
  const expected = (process.env.BOT_INTEGRATION_TOKEN || "").trim();
  const header = req.get("authorization") || "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!expected || !supplied || !timingSafeEqual(digest(expected), digest(supplied))) {
    return res.status(403).json({ message: "Forbidden" });
  }
  return next();
}

function externalId(value: string, res: Response) {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) {
    res.status(400).json({ message: "external_id must be a UUID" });
    return null;
  }
  return parsed.data;
}

router.use(requireBotToken);

router.get("/options/", (_req, res) => {
  return res.json({ version: 1, site: "healthystock", categories: botCategories, authors: botAuthors });
});

router.post("/articles/", asyncHandler(async (req, res) => {
  const parsed = articleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid article payload", issues: parsed.error.flatten() });
  }
  const categorySlugs = new Set<string>(botCategories.map((item) => item.slug));
  if (parsed.data.category_slugs.some((slug) => !categorySlugs.has(slug))) {
    return res.status(400).json({ message: "One or more categories do not exist" });
  }
  const authorSlugs = new Set<string>(botAuthors.map((item) => item.slug));
  if (parsed.data.author_slug && !authorSlugs.has(parsed.data.author_slug)) {
    return res.status(400).json({ message: "Author does not exist" });
  }
  const article = await createBotArticle(parsed.data);
  return res.status(201).json(article);
}));

router.get("/articles/:externalId/", asyncHandler(async (req, res) => {
  const id = externalId(req.params.externalId, res);
  if (!id) return;
  const article = await getBotArticle(id);
  if (!article) return res.status(404).json({ message: "Article not found" });
  return res.json(article);
}));

router.put("/articles/:externalId/image/", (req, res, next) => {
  upload.single("image")(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      return res.status(400).json({ message: error.code === "LIMIT_FILE_SIZE" ? "Image must be 10 MiB or smaller" : "Invalid image upload" });
    }
    if (error) return next(error);
    return next();
  });
}, asyncHandler(async (req, res) => {
  const id = externalId(req.params.externalId, res);
  if (!id) return;
  if (!req.file || req.file.fieldname !== "image") return res.status(400).json({ message: "image file is required" });
  const article = await uploadBotArticleImage(id, req.file.buffer);
  return res.json(article);
}));

router.post("/articles/:externalId/publish/", asyncHandler(async (req, res) => {
  const id = externalId(req.params.externalId, res);
  if (!id) return;
  const article = await publishBotArticle(id);
  return res.json(article);
}));

export default router;
