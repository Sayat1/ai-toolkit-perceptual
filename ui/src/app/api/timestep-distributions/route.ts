import { NextRequest, NextResponse } from 'next/server';
import { listCurves, saveCurve, validateCurve } from '@/server/timestepCurves';

export async function GET() {
  const curves = await listCurves('distribution');
  return NextResponse.json({ curves });
}

export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }
  const result = validateCurve(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  const saved = await saveCurve('distribution', result.curve);
  return NextResponse.json({ curve: saved });
}
