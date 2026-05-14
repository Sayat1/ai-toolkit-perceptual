import { NextResponse } from 'next/server';
import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { getModelsRoot } from '@/server/settings';

export interface ModelEntry {
  filename: string;
  bytes: number;
  modifiedMs: number;
  path: string;
}

const MODEL_EXTENSIONS = new Set(['.safetensors', '.ckpt', '.pt', '.pth', '.bin', '.gguf']);

export async function GET() {
  const dir = await getModelsRoot();
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    // ignore
  }
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (e: any) {
    return NextResponse.json({ error: `Could not read models folder: ${e?.message ?? e}` }, { status: 500 });
  }
  const models: ModelEntry[] = [];
  for (const name of entries) {
    const ext = path.extname(name).toLowerCase();
    if (!MODEL_EXTENSIONS.has(ext)) continue;
    const full = path.join(dir, name);
    try {
      const s = await stat(full);
      if (!s.isFile()) continue;
      models.push({ filename: name, bytes: s.size, modifiedMs: s.mtimeMs, path: full });
    } catch {
      // skip unreadable entries
    }
  }
  models.sort((a, b) => b.modifiedMs - a.modifiedMs);
  return NextResponse.json({ root: dir, models });
}
