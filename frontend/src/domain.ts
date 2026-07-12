export interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  coverImage?: string;
  author: string;
  publishedAt: string;
  readTimeMinutes: number;
  primaryKeyword: string;
  secondaryKeywords: string[];
  category: string;
  rating: "A+" | "A" | "B" | "C" | "D" | "F";
  status?: "draft" | "published";
}

export interface HealthIndex {
  updatedAt: string;
  sourcePostCount: number;
  metrics: Array<{
    label: string;
    value: number;
    trend: "up" | "down" | "steady";
  }>;
  tickerItems: string[];
  signal: string;
}

export interface AdminSettings {
  masterPrompt: string;
  autoGenerationEnabled: boolean;
  generationTopic: string;
  generationTime: string;
  generationTimes: string[];
  generationFrequency: "manual" | "daily" | "weekly" | "monthly";
  lastGeneratedAt?: string;
  lastGenerationStatus?: string;
}
