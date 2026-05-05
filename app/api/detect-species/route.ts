// Server-side proxy to Anthropic Messages API (vision) for carp/coarse species detection.
// Accepts { imageBase64: string, mediaType?: string } and returns
// { species: 'common'|'mirror'|'leather'|'ghost'|'koi'|'grass_carp'|'sturgeon'|'tench'|'catfish'|'other'|null }
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const VALID = [
  'common', 'mirror', 'leather', 'ghost', 'koi',
  'grass_carp', 'sturgeon', 'tench', 'catfish', 'other',
] as const;

// Decision-tree prompt. Earlier flat-list prompt drifted because the model
// defaulted to popular variants (e.g. "mirror" for any low-scale carp).
// This walks the model through discriminating cues in order — barbels and
// scutes ruled out first, scale count distinguishing leather vs mirror —
// matching how an angler would actually identify the fish.
const SPECIES_PROMPT = `You are identifying a freshwater fish from a UK/European angling photo.
Look at the fish carefully. Check these features in order:

1. DOES THE FISH HAVE BARBELS (WHISKERS) AROUND ITS MOUTH?
   - YES with 4+ prominent whiskers, wide flat head → "catfish" (likely Wels)
   - YES with 2 small barbels at corners of mouth, olive/dark green body, paddle-tail → "tench"
   - NO barbels OR only tiny inconspicuous ones → continue to step 2

2. DOES THE FISH HAVE BONY PLATES (SCUTES) RUNNING ALONG ITS BODY?
   - YES with prehistoric-looking scutes, pointed snout, shark-like tail → "sturgeon"
   - NO → continue to step 3

3. IS THE FISH A CARP? (deep body, large flank, single dorsal fin)
   If carp-shaped, identify by SCALES:
   - Fully scaled, even regular pattern, no large irregular scales → "common"
   - Has LARGE IRREGULAR scattered scales/plates (some big, some areas bare) → "mirror"
   - Has NO SCALES AT ALL or fewer than 5 tiny scales near dorsal fin/tail → "leather"
   - White/cream/pale body with orange or grey markings (koi-cross genetics) → "ghost"
   - Brightly colored ornamental (orange/white/black koi pattern, vivid) → "koi"
   - Slimmer body, large slate-colored scales, no barbels, terminal mouth → "grass_carp"

4. NOT a carp and NOT catfish/sturgeon/tench:
   → "other"

CRITICAL DECISION RULES:
- If you see WHISKERS/BARBELS prominently, it's NEVER carp. Default to catfish or tench based on body shape.
- LEATHER CARP has truly NO scales or extremely few (countable on one hand). Don't call it Mirror unless you can clearly see multiple irregular scales.
- MIRROR CARP always shows visible scales — large, irregular, scattered. If the body is bare/smooth all over, it's Leather.
- When uncertain between Mirror and Leather, count scales: 0-5 visible = Leather, 6+ visible = Mirror.

Return ONLY one of these exact strings, no punctuation, no other words:
common, mirror, leather, ghost, koi, grass_carp, sturgeon, tench, catfish, other`;

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
        // Classification task — temperature 0 keeps the model anchored to
        // the decision rules below instead of drifting toward popular
        // priors (e.g. preferring "mirror" because it's the famous one).
        temperature: 0,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: media, data: b64 } },
            { type: 'text', text: SPECIES_PROMPT },
          ],
        }],
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ species: null, error: `upstream_${r.status}`, detail: t.slice(0, 200) }, { status: 200 });
    }
    const j = await r.json();
    const text = (j?.content?.[0]?.text || '').toString().trim().toLowerCase().replace(/[^a-z_]/g, '');
    const species = (VALID as readonly string[]).includes(text) ? text : null;
    return NextResponse.json({ species });
  } catch (e: any) {
    return NextResponse.json({ species: null, error: 'fetch_failed' }, { status: 200 });
  }
}
