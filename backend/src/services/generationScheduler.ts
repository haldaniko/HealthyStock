import { createPostFromMarkdown, saveGeneratedPost } from "./postStore.js";
import { generateArticle } from "./openrouter.js";
import { getAdminSettings, patchGenerationStatus } from "./adminSettings.js";
import { pickRandomCoverImage } from "./mediaStore.js";

let schedulerStarted = false;
let generationInProgress = false;

export function startGenerationScheduler() {
  if (schedulerStarted) {
    return;
  }

  schedulerStarted = true;
  runScheduledGeneration().catch((error) => {
    const message = error instanceof Error ? error.message : "Scheduled generation failed";
    patchGenerationStatus(`Failed: ${message}`).catch(() => undefined);
  });

  setInterval(() => {
    runScheduledGeneration().catch((error) => {
      const message = error instanceof Error ? error.message : "Scheduled generation failed";
      patchGenerationStatus(`Failed: ${message}`).catch(() => undefined);
    });
  }, 60_000);
}

export async function runScheduledGeneration() {
  if (generationInProgress) {
    return;
  }

  const settings = await getAdminSettings();
  if (!settings.autoGenerationEnabled || settings.generationFrequency === "manual" || !isDue(settings)) {
    return;
  }

  generationInProgress = true;
  try {
    const markdown = await generateArticle(settings.generationTopic, settings.masterPrompt);
    const draft = createPostFromMarkdown(markdown, settings.generationTopic);
    draft.coverImage = await pickRandomCoverImage() || draft.coverImage;
    const post = await saveGeneratedPost(draft);
    await patchGenerationStatus(`Generated: ${post.title}`, new Date().toISOString());
  } finally {
    generationInProgress = false;
  }
}

function isDue(settings: Awaited<ReturnType<typeof getAdminSettings>>): boolean {
  const now = new Date();
  const [hour, minute] = settings.generationTime.split(":").map(Number);
  const scheduledAt = new Date(now);
  scheduledAt.setHours(hour, minute, 0, 0);

  if (now < scheduledAt) {
    return false;
  }

  if (!settings.lastGeneratedAt) {
    return true;
  }

  const lastRun = new Date(settings.lastGeneratedAt);
  if (Number.isNaN(lastRun.getTime())) {
    return true;
  }

  if (settings.generationFrequency === "daily") {
    return lastRun.toDateString() !== now.toDateString();
  }

  if (settings.generationFrequency === "weekly") {
    return periodKey(lastRun, "weekly") !== periodKey(now, "weekly");
  }

  if (settings.generationFrequency === "monthly") {
    return lastRun.getFullYear() !== now.getFullYear() || lastRun.getMonth() !== now.getMonth();
  }

  return false;
}

function periodKey(date: Date, period: "weekly") {
  if (period === "weekly") {
    const firstDay = new Date(date.getFullYear(), 0, 1);
    const days = Math.floor((date.getTime() - firstDay.getTime()) / 86_400_000);
    return `${date.getFullYear()}-${Math.ceil((days + firstDay.getDay() + 1) / 7)}`;
  }

  return "";
}
