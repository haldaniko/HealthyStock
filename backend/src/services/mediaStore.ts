import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import slugify from "slugify";

const uploadRoot = process.env.UPLOAD_DIR || path.resolve(process.cwd(), "uploads");
const coverDir = path.join(uploadRoot, "covers");

const allowedMimeTypes: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif"
};

export interface MediaAsset {
  name: string;
  url: string;
  size: number;
  createdAt: string;
  builtIn?: boolean;
}

const builtInCoverImages: MediaAsset[] = [
  { name: "cover1.svg", url: "/covers/cover1.svg", size: 0, createdAt: "2026-01-01T00:00:00.000Z", builtIn: true },
  { name: "cover2.svg", url: "/covers/cover2.svg", size: 0, createdAt: "2026-01-01T00:00:00.000Z", builtIn: true },
  { name: "cover3.svg", url: "/covers/cover3.svg", size: 0, createdAt: "2026-01-01T00:00:00.000Z", builtIn: true },
  { name: "cover4.svg", url: "/covers/cover4.svg", size: 0, createdAt: "2026-01-01T00:00:00.000Z", builtIn: true }
];

async function ensureCoverDir() {
  await fs.mkdir(coverDir, { recursive: true });
}

function parseDataUrl(dataUrl: string) {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) {
    const error = new Error("Upload must be a base64 image data URL.");
    Object.assign(error, { statusCode: 400 });
    throw error;
  }

  const mimeType = match[1].toLowerCase();
  const extension = allowedMimeTypes[mimeType];
  if (!extension) {
    const error = new Error("Only JPG, PNG, WEBP, and GIF images are allowed.");
    Object.assign(error, { statusCode: 400 });
    throw error;
  }

  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) {
    const error = new Error("Image file is empty.");
    Object.assign(error, { statusCode: 400 });
    throw error;
  }
  if (buffer.byteLength > 6 * 1024 * 1024) {
    const error = new Error("Image must be 6MB or smaller.");
    Object.assign(error, { statusCode: 400 });
    throw error;
  }

  return { buffer, extension };
}

export async function listCoverImages(): Promise<MediaAsset[]> {
  await ensureCoverDir();
  const entries = await fs.readdir(coverDir, { withFileTypes: true });
  const assets = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const stat = await fs.stat(path.join(coverDir, entry.name));
        return {
          name: entry.name,
          url: `/uploads/covers/${entry.name}`,
          size: stat.size,
          createdAt: stat.birthtime.toISOString()
        };
      })
  );

  return [...assets.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), ...builtInCoverImages];
}

export async function saveCoverImage(input: { fileName?: string; dataUrl?: string }): Promise<MediaAsset> {
  await ensureCoverDir();
  if (!input.dataUrl) {
    const error = new Error("Image data is required.");
    Object.assign(error, { statusCode: 400 });
    throw error;
  }

  const { buffer, extension } = parseDataUrl(input.dataUrl);
  const baseName = slugify(input.fileName || "cover-image", { lower: true, strict: true }).replace(/\.(jpg|jpeg|png|webp|gif)$/i, "") || "cover-image";
  const name = `${baseName}-${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`;
  const filePath = path.join(coverDir, name);

  await fs.writeFile(filePath, buffer, { flag: "wx" });
  const stat = await fs.stat(filePath);

  return {
    name,
    url: `/uploads/covers/${name}`,
    size: stat.size,
    createdAt: stat.birthtime.toISOString()
  };
}

export async function deleteCoverImage(name: string) {
  const safeName = path.basename(name);
  if (safeName !== name) {
    const error = new Error("Invalid image name.");
    Object.assign(error, { statusCode: 400 });
    throw error;
  }

  await ensureCoverDir();
  await fs.unlink(path.join(coverDir, safeName)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      const notFound = new Error("Image not found.");
      Object.assign(notFound, { statusCode: 404 });
      throw notFound;
    }
    throw error;
  });
}

export async function pickRandomCoverImage() {
  const assets = await listCoverImages();
  if (!assets.length) return null;
  return assets[Math.floor(Math.random() * assets.length)].url;
}
