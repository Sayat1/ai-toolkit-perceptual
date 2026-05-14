// In-memory tracker for active URL-based model downloads. Lives for the
// lifetime of the Next.js server process — transfers in progress when the
// process restarts are lost (and their partial files on disk become orphans,
// which the list-models endpoint will show; the user can delete them). For an
// MVP that's fine; a real solution would use a queue + db row.
import { createWriteStream, existsSync, unlinkSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type TransferStatus = 'pending' | 'downloading' | 'done' | 'error' | 'cancelled';

export interface Transfer {
  id: string;
  url: string;
  filename: string;
  targetPath: string;
  status: TransferStatus;
  bytes: number;
  total: number | null;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
}

const transfers = new Map<string, Transfer>();
const aborters = new Map<string, AbortController>();

export function listTransfers(): Transfer[] {
  return Array.from(transfers.values()).sort((a, b) => b.startedAt - a.startedAt);
}

export function getTransfer(id: string): Transfer | undefined {
  return transfers.get(id);
}

export function clearFinished(): number {
  let removed = 0;
  for (const [id, t] of transfers) {
    if (t.status === 'done' || t.status === 'error' || t.status === 'cancelled') {
      transfers.delete(id);
      aborters.delete(id);
      removed++;
    }
  }
  return removed;
}

export function cancelTransfer(id: string): boolean {
  const t = transfers.get(id);
  if (!t || t.status !== 'downloading' && t.status !== 'pending') return false;
  aborters.get(id)?.abort();
  t.status = 'cancelled';
  t.finishedAt = Date.now();
  // Best-effort cleanup of the partial file.
  try {
    if (existsSync(t.targetPath)) unlinkSync(t.targetPath);
  } catch {
    // ignore
  }
  return true;
}

export function startUrlDownload(url: string, filename: string, targetPath: string): Transfer {
  const id = randomUUID();
  const transfer: Transfer = {
    id,
    url,
    filename,
    targetPath,
    status: 'pending',
    bytes: 0,
    total: null,
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
  };
  transfers.set(id, transfer);

  const ac = new AbortController();
  aborters.set(id, ac);

  // Fire-and-forget. We don't await — the API endpoint returns the
  // transfer id immediately and the client polls /transfers for progress.
  void (async () => {
    try {
      const res = await fetch(url, { signal: ac.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} from source`);
      const contentLength = res.headers.get('content-length');
      transfer.total = contentLength ? Number(contentLength) : null;
      transfer.status = 'downloading';
      if (!res.body) throw new Error('No body in response');
      const readable = Readable.fromWeb(res.body as any);
      // Tap into the stream to count bytes as they flow through. `pipeline`
      // handles cleanup if anything throws.
      readable.on('data', (chunk: Buffer) => {
        transfer.bytes += chunk.length;
      });
      await pipeline(readable, createWriteStream(targetPath));
      transfer.status = 'done';
      transfer.finishedAt = Date.now();
    } catch (e: any) {
      // If we cancelled, status is already set; don't clobber.
      if (transfer.status !== 'cancelled') {
        transfer.status = 'error';
        transfer.error = e?.message ?? String(e);
        transfer.finishedAt = Date.now();
        try {
          if (existsSync(targetPath)) unlinkSync(targetPath);
        } catch {
          // ignore
        }
      }
    } finally {
      aborters.delete(id);
    }
  })();

  return transfer;
}
