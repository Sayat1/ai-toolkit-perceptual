import { NextRequest, NextResponse } from 'next/server';
import { createWriteStream, existsSync, unlinkSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { getModelsRoot } from '@/server/settings';

const MODEL_EXTENSIONS = new Set(['.safetensors', '.ckpt', '.pt', '.pth', '.bin', '.gguf']);

function sanitizeFilename(raw: string): string | null {
  // Browsers send the basename only via the File API, but trust nothing —
  // strip path components and tightly restrict the allowed character set.
  const base = path.basename(raw);
  if (!base || base === '.' || base === '..') return null;
  if (base !== raw) return null;
  if (!/^[A-Za-z0-9._-]{1,255}$/.test(base)) return null;
  const ext = path.extname(base).toLowerCase();
  if (!MODEL_EXTENSIONS.has(ext)) return null;
  return base;
}

// Streaming upload: client sends the file as the raw request body with an
// `X-Filename` header. We pipe `request.body` (a WHATWG ReadableStream) to
// `fs.createWriteStream` so a multi-GB checkpoint never lives in memory.
//
// We intentionally bypass `request.formData()` (which buffers the whole
// body) and any Next.js Pages-router body limits (which don't apply to App
// Router route handlers but are a common point of confusion).
export async function POST(request: NextRequest) {
  const rawName = request.headers.get('x-filename');
  if (!rawName) {
    return NextResponse.json({ error: 'X-Filename header is required' }, { status: 400 });
  }
  const filename = sanitizeFilename(rawName);
  if (!filename) {
    return NextResponse.json(
      { error: `Invalid filename "${rawName}". Allowed characters: A-Z a-z 0-9 . _ -, with a model extension.` },
      { status: 400 },
    );
  }
  if (!request.body) {
    return NextResponse.json({ error: 'Request body is empty' }, { status: 400 });
  }

  const modelsDir = await getModelsRoot();
  await mkdir(modelsDir, { recursive: true });
  const target = path.join(modelsDir, filename);

  if (existsSync(target)) {
    return NextResponse.json({ error: 'A model with that filename already exists' }, { status: 409 });
  }

  try {
    const stream = Readable.fromWeb(request.body as any);
    await pipeline(stream, createWriteStream(target));
    return NextResponse.json({ ok: true, filename, path: target });
  } catch (e: any) {
    // Cleanup any partial write on failure so the listing doesn't show a
    // truncated model that looks valid.
    try {
      if (existsSync(target)) unlinkSync(target);
    } catch {
      // ignore
    }
    return NextResponse.json({ error: e?.message ?? 'Upload failed' }, { status: 500 });
  }
}
