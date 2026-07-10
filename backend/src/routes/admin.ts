import { randomUUID } from "node:crypto";
import slugify from "slugify";
import { Router } from "express";
import { z } from "zod";
import { AdminRequest, requireAdmin } from "../middleware/adminAuth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { logAuditEvent } from "../services/auditLog.js";
import { getAdminSettings, updateAdminSettings } from "../services/adminSettings.js";
import { deleteCoverImage, listCoverImages, saveCoverImage } from "../services/mediaStore.js";
import { createPost, deletePost, getAllPosts, updatePost } from "../services/postStore.js";
import { BlogPost } from "../types.js";

const router = Router();

const ratingSchema = z.enum(["A+", "A", "B", "C", "D", "F"]);
const frequencySchema = z.enum(["manual", "daily", "weekly", "monthly"]);

const postSchema = z.object({
  title: z.string().min(3).max(180),
  slug: z.string().min(3).max(220).optional(),
  excerpt: z.string().min(20).max(500),
  content: z.string().min(20),
  coverImage: z.string().refine((value) => value === "" || /^https?:\/\//i.test(value) || value.startsWith("/"), "Cover image must be a URL or site-relative path").optional(),
  author: z.string().min(2).max(120).default("Maria Iordanova"),
  publishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  readTimeMinutes: z.coerce.number().int().min(1).max(90),
  primaryKeyword: z.string().min(2).max(120),
  secondaryKeywords: z.array(z.string().min(1).max(80)).max(15).default([]),
  category: z.string().min(2).max(80),
  rating: ratingSchema,
  status: z.enum(["draft", "published"]).default("published")
});

const settingsSchema = z.object({
  masterPrompt: z.string().min(100),
  autoGenerationEnabled: z.boolean(),
  generationTopic: z.string().min(5).max(200),
  generationTime: z.string().regex(/^\d{2}:\d{2}$/),
  generationFrequency: frequencySchema,
  lastGeneratedAt: z.string().optional(),
  lastGenerationStatus: z.string().optional()
});

router.use(requireAdmin);

router.get("/posts", asyncHandler(async (_req, res) => {
  const posts = await getAllPosts();
  return res.json({ total: posts.length, items: posts });
}));

router.get("/settings", asyncHandler(async (_req, res) => {
  const settings = await getAdminSettings();
  return res.json(settings);
}));

router.get("/media/covers", asyncHandler(async (_req, res) => {
  const items = await listCoverImages();
  return res.json({ items });
}));

router.post("/media/covers", asyncHandler(async (req: AdminRequest, res) => {
  const asset = await saveCoverImage(req.body);
  await logAuditEvent({
    actor: req.admin?.sub ?? "unknown",
    action: "media.create",
    target: asset.name
  });
  return res.status(201).json(asset);
}));

router.delete("/media/covers/:name", asyncHandler(async (req: AdminRequest, res) => {
  await deleteCoverImage(req.params.name);
  await logAuditEvent({
    actor: req.admin?.sub ?? "unknown",
    action: "media.delete",
    target: req.params.name
  });
  return res.json({ ok: true });
}));

router.put("/settings", asyncHandler(async (req: AdminRequest, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid settings payload", issues: parsed.error.flatten() });
  }

  const settings = await updateAdminSettings(parsed.data);
  await logAuditEvent({
    actor: req.admin?.sub ?? "unknown",
    action: "settings.update",
    target: "generation-settings"
  });
  return res.json(settings);
}));

router.post("/posts", asyncHandler(async (req: AdminRequest, res) => {
  const parsed = postSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid post payload", issues: parsed.error.flatten() });
  }

  const data = parsed.data;
  const post: BlogPost = {
    ...data,
    id: randomUUID(),
    slug: slugify(data.slug || data.title, { lower: true, strict: true }),
    coverImage: data.coverImage || undefined
  };

  const saved = await createPost(post);
  await logAuditEvent({
    actor: req.admin?.sub ?? "unknown",
    action: "post.create",
    target: saved.slug,
    details: { status: saved.status ?? "published" }
  });
  return res.status(201).json(saved);
}));

router.put("/posts/:slug", asyncHandler(async (req: AdminRequest, res) => {
  const parsed = postSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid post payload", issues: parsed.error.flatten() });
  }

  const data = parsed.data;
  const post: BlogPost = {
    ...data,
    id: randomUUID(),
    slug: slugify(data.slug || data.title, { lower: true, strict: true }),
    coverImage: data.coverImage || undefined
  };

  const saved = await updatePost(req.params.slug, post);
  await logAuditEvent({
    actor: req.admin?.sub ?? "unknown",
    action: "post.update",
    target: saved.slug,
    details: { previousSlug: req.params.slug, status: saved.status ?? "published" }
  });
  return res.json(saved);
}));

router.delete("/posts/:slug", asyncHandler(async (req: AdminRequest, res) => {
  const deleted = await deletePost(req.params.slug);
  if (!deleted) {
    return res.status(404).json({ message: "Only generated or overridden posts can be deleted" });
  }

  await logAuditEvent({
    actor: req.admin?.sub ?? "unknown",
    action: "post.delete",
    target: req.params.slug
  });
  return res.json({ ok: true });
}));

export default router;
