import type { BlogPost, HealthIndex } from "./domain";

export const apiUrl = window.__HEALTHYSTOCK_CONFIG__?.apiUrl || import.meta.env.VITE_API_URL || "http://localhost:4000";

export function assetUrl(path?: string | null) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("/covers/") || path.startsWith("/favicon")) return path;
  const servedPath = path.startsWith("/uploads/") ? `/api${path}` : path;
  return `${apiUrl}${servedPath.startsWith("/") ? servedPath : `/${servedPath}`}`;
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.message || data.error || `Request failed (${response.status})`);
  }
  return data as T;
}

export async function getPosts(search = ""): Promise<BlogPost[]> {
  const q = search ? `?search=${encodeURIComponent(search)}` : "";
  const data = await readJson<{ items: BlogPost[] }>(await fetch(`${apiUrl}/api/posts${q}`));
  return data.items;
}

export async function getPostBySlug(slug: string): Promise<BlogPost | null> {
  const response = await fetch(`${apiUrl}/api/posts/${slug}`);
  if (!response.ok) return null;
  return readJson<BlogPost>(response);
}

export async function getHealthIndex(): Promise<HealthIndex> {
  return readJson<HealthIndex>(await fetch(`${apiUrl}/api/health-index`));
}

export async function subscribe(email: string): Promise<string> {
  const data = await readJson<{ message: string }>(
    await fetch(`${apiUrl}/api/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, source: "homepage-newsletter" })
    })
  );
  return data.message;
}
