import { DEFAULT_MASTER_PROMPT } from "./openrouter.js";
import { query } from "./db.js";

export type GenerationFrequency = "manual" | "daily" | "weekly" | "monthly";

export interface AdminSettings {
  masterPrompt: string;
  autoGenerationEnabled: boolean;
  generationTopic: string;
  generationTime: string;
  generationTimes: string[];
  generationFrequency: GenerationFrequency;
  lastGeneratedAt?: string;
  lastGenerationStatus?: string;
}

export const defaultAdminSettings: AdminSettings = {
  masterPrompt: DEFAULT_MASTER_PROMPT,
  autoGenerationEnabled: false,
  generationTopic: "Evidence-based healthy food research brief",
  generationTime: "09:00",
  generationTimes: ["09:00"],
  generationFrequency: "manual"
};

interface AdminSettingsRow {
  master_prompt: string;
  auto_generation_enabled: boolean;
  generation_topic: string;
  generation_time: string;
  generation_times: string[] | null;
  generation_frequency: GenerationFrequency;
  last_generated_at: string | null;
  last_generation_status: string | null;
}

export async function getAdminSettings(): Promise<AdminSettings> {
  const rows = await query<AdminSettingsRow>(
    `SELECT master_prompt, auto_generation_enabled, generation_topic, generation_time, generation_times,
            generation_frequency, last_generated_at, last_generation_status
     FROM admin_settings
     WHERE id = 1
     LIMIT 1`
  );

  if (!rows[0]) {
    return defaultAdminSettings;
  }

  return normalizeSettings({
    masterPrompt: rows[0].master_prompt,
    autoGenerationEnabled: rows[0].auto_generation_enabled,
    generationTopic: rows[0].generation_topic,
    generationTime: rows[0].generation_time,
    generationTimes: rows[0].generation_times ?? [rows[0].generation_time],
    generationFrequency: rows[0].generation_frequency,
    lastGeneratedAt: rows[0].last_generated_at ?? undefined,
    lastGenerationStatus: rows[0].last_generation_status ?? undefined
  });
}

export async function updateAdminSettings(nextSettings: Partial<AdminSettings>): Promise<AdminSettings> {
  const settings = normalizeSettings(nextSettings);

  await query(
    `INSERT INTO admin_settings (
      id, master_prompt, auto_generation_enabled, generation_topic,
      generation_time, generation_times, generation_frequency, last_generated_at,
      last_generation_status, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
    ON CONFLICT (id)
    DO UPDATE SET
      master_prompt = EXCLUDED.master_prompt,
      auto_generation_enabled = EXCLUDED.auto_generation_enabled,
      generation_topic = EXCLUDED.generation_topic,
      generation_time = EXCLUDED.generation_time,
      generation_times = EXCLUDED.generation_times,
      generation_frequency = EXCLUDED.generation_frequency,
      last_generated_at = EXCLUDED.last_generated_at,
      last_generation_status = EXCLUDED.last_generation_status,
      updated_at = NOW()`,
    [
      1,
      settings.masterPrompt,
      settings.autoGenerationEnabled,
      settings.generationTopic,
      settings.generationTime,
      settings.generationTimes,
      settings.generationFrequency,
      settings.lastGeneratedAt ?? null,
      settings.lastGenerationStatus ?? null
    ]
  );

  return settings;
}

export async function patchGenerationStatus(lastGenerationStatus: string, lastGeneratedAt?: string) {
  const settings = await getAdminSettings();
  await updateAdminSettings({
    ...settings,
    lastGenerationStatus,
    lastGeneratedAt: lastGeneratedAt ?? settings.lastGeneratedAt
  });
}

function normalizeSettings(settings: Partial<AdminSettings>): AdminSettings {
  const generationFrequency = ["manual", "daily", "weekly", "monthly"].includes(settings.generationFrequency ?? "")
    ? settings.generationFrequency
    : defaultAdminSettings.generationFrequency;
  const generationTimes = normalizeGenerationTimes(settings.generationTimes, settings.generationTime);
  const generationTime = generationTimes[0] ?? defaultAdminSettings.generationTime;

  return {
    masterPrompt: settings.masterPrompt?.trim() || defaultAdminSettings.masterPrompt,
    autoGenerationEnabled: Boolean(settings.autoGenerationEnabled),
    generationTopic: settings.generationTopic?.trim() || defaultAdminSettings.generationTopic,
    generationTime,
    generationTimes,
    generationFrequency: generationFrequency as GenerationFrequency,
    lastGeneratedAt: settings.lastGeneratedAt,
    lastGenerationStatus: settings.lastGenerationStatus
  };
}

function normalizeGenerationTimes(times?: string[], fallbackTime?: string): string[] {
  const candidates = [
    ...(Array.isArray(times) ? times : []),
    ...(fallbackTime ? [fallbackTime] : [])
  ];
  const validTimes = candidates
    .map((time) => time.trim())
    .filter((time) => /^\d{2}:\d{2}$/.test(time))
    .filter((time) => {
      const [hour, minute] = time.split(":").map(Number);
      return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
    });

  const uniqueTimes = Array.from(new Set(validTimes)).sort();
  return uniqueTimes.length > 0 ? uniqueTimes : defaultAdminSettings.generationTimes;
}
