// Server-side proxy to Anthropic Messages API (vision) for carp species detection.
// Accepts { imageBase64: string, mediaType?: string } and returns { species: 'common'|'mirror'|'leather'|'ghost'|'koi'|'other'|null }
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const VALID = ['common', 'mirror', 'leather', 'ghost', 'koi', 'other'] as const;

function stripDataUrl(s: string): { b64: string; media: string } {
  const m = /^data:(image\/[a-zA-Z+]+);base64,(.*)$/.exec(s);
  if (m) return { media: m[1], b64: m[2] };
  return { media: 'image/jpeg', b64: s };
}

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ species: null, error: 'api_key_missing' }, { status: 200 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }); }

  const raw = body?.imageBase64;
  if (!raw || typeof raw !== 'string') return NextResponse.json({ error: 'no_image' }, { status: 400 });
  const { b64, media } = stripDataUrl(raw);

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 32,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: media, data: b64 } },
            { type: 'text', text: 'Identify the carp species. Reply with EXACTLY ONE WORD from: common, mirror, leather, ghost, koi, other. No punctuation.' },
          ],
        }],
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ species: null, error: `upstream_${r.status}`, detail: t.slice(0, 200) }, { status: 200 });
    }
    const j = await r.json();
    const text = (j?.content?.[0]?.text || '').toString().trim().toLowerCase().replace(/[^a-z]/g, '');
    const species = (VALID as readonly string[]).includes(text) ? text : null;
    return NextResponse.json({ species });
  } catch (e: any) {
    return NextResponse.json({ species: null, error: 'fetch_failed' }, { status: 200 });
  }
}
