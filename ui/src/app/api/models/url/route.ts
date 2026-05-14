import { NextRequest, NextResponse } from 'next/server';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { getModelsRoot } from '@/server/settings';
import { startUrlDownload } from '@/server/modelTransfers';

const MODEL_EXTENSIONS = new Set(['.safetensors', '.ckpt', '.pt', '.pth', '.bin', '.gguf']);

function sanitizeFilename(raw: string): string | null {
  const base = path.basename(raw);
  if (!base || base === '.' || base === '..') return null;
  if (base !== raw) return null;
  if (!/^[A-Za-z0-9._-]{1,255}$/.test(base)) return null;
  const ext = path.extname(base).toLowerCase();
  if (!MODEL_EXTENSIONS.has(ext)) return null;
  return base;
}

function deriveFilenameFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() ?? '';
    return sanitizeFilename(decodeURIComponent(last));
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  let body: { url?: string; filename?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }
  const { url, filename: explicit } = body;
  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'url is required' }, { status: 400 });
  }
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return NextResponse.json({ error: 'Only http(s) URLs are supported' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  }

  const filename = explicit ? sanitizeFilename(explicit) : deriveFilenameFromUrl(url);
  if (!filename) {
    return NextResponse.json(
      { error: 'Could not derive a safe filename from the URL. Pass a `filename` field (e.g. "my-model.safetensors").' },
      { status: 400 },
    );
  }

  const modelsDir = await getModelsRoot();
  await mkdir(modelsDir, { recursive: true });
  const target = path.join(modelsDir, filename);
  if (existsSync(target)) {
    return NextResponse.json({ error: 'A file with that name already exists' }, { status: 409 });
  }

  const transfer = startUrlDownload(url, filename, target);
  return NextResponse.json({ ok: true, transfer });
}
