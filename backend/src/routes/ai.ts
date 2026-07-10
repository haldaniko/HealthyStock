import { Router } from "express";
import { z } from "zod";
import { requireAdmin } from "../middleware/adminAuth.js";
import { getAdminSettings, patchGenerationStatus } from "../services/adminSettings.js";
import { generateArticle } from "../services/openrouter.js";
import { pickRandomCoverImage } from "../services/mediaStore.js";
import { createPostFromMarkdown, saveGeneratedPost } from "../services/postStore.js";

const router = Router();

router.use(requireAdmin);

const bodySchema = z.object({
  topic: z.string().min(5).max(200)
});

router.post("/generate-article", async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid topic" });
  }

  try {
    const settings = await getAdminSettings();
    const markdown = await generateArticle(parsed.data.topic, settings.masterPrompt);
    const draft = createPostFromMarkdown(markdown, parsed.data.topic);
    draft.coverImage = await pickRandomCoverImage() || draft.coverImage;
    const post = await saveGeneratedPost(draft);
    await patchGenerationStatus(`Generated manually: ${post.title}`, new Date().toISOString());
    return res.status(201).json({ markdown, post });
  } catch (error) {
    console.error("Failed to generate article", error);
    return res.status(502).json({ message: "Generation failed" });
  }
});

export default router;
