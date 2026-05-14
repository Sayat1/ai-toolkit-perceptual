import { NextRequest, NextResponse } from 'next/server';
import { cancelTransfer, clearFinished, listTransfers } from '@/server/modelTransfers';

export async function GET() {
  return NextResponse.json({ transfers: listTransfers() });
}

// POST /api/models/transfers  { action: "clearFinished" } | { action: "cancel", id: string }
export async function POST(request: NextRequest) {
  let body: { action?: string; id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }
  if (body.action === 'clearFinished') {
    const removed = clearFinished();
    return NextResponse.json({ ok: true, removed });
  }
  if (body.action === 'cancel') {
    if (!body.id) return NextResponse.json({ error: 'id is required for cancel' }, { status: 400 });
    const ok = cancelTransfer(body.id);
    return NextResponse.json({ ok });
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
