// Live geopolitical briefing — edge-cached Claude analysis.
// Generated server-side with ANTHROPIC_API_KEY (Vercel env var) so no key
// ever ships to the browser. Cached at the edge for 30 min — a briefing is
// slow-moving intelligence, not a tick stream. The response carries its own
// generated-at timestamp so the client can show honest freshness.
//
// If the key is missing or the call fails, this returns an error status and
// the client renders a clear "briefing offline" state — never canned data.

export const config = { runtime: 'edge' };

const MODEL = 'claude-haiku-4-5-20251001';

// Headline context — a couple of fast wire feeds, fetched best-effort.
const CONTEXT_FEEDS = [
  'https://feeds.content.dowjones.io/public/rss/mw_topstories',
  'https://www.cnbc.com/id/100003114/device/rss/rss.html',
];

const SCHEMA = {
  type: 'object',
  properties: {
    risks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          region: { type: 'string' },
          title: { type: 'string' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          lat: { type: 'number' },
          lng: { type: 'number' },
          desc: { type: 'string' },
          impact: { type: 'string' },
        },
        required: ['region', 'title', 'severity', 'lat', 'lng', 'desc', 'impact'],
        additionalProperties: false,
      },
    },
    matrix: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          asset: { type: 'string' },
          read: { type: 'string' },
          tone: { type: 'string', enum: ['bull', 'bear', 'amber', 'neutral'] },
        },
        required: ['asset', 'read', 'tone'],
        additionalProperties: false,
      },
    },
  },
  required: ['risks', 'matrix'],
  additionalProperties: false,
};

async function fetchWithTimeout(url, opts = {}, ms = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// Pull headline titles out of an RSS feed — context only, failures ignored.
async function feedTitles(url) {
  try {
    const r = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SIGNAL/2.0)' },
    });
    if (!r.ok) return [];
    const xml = await r.text();
    const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
    return items.slice(0, 10).map((b) => {
      const m = b.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      return m
        ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim()
        : '';
    }).filter(Boolean);
  } catch {
    return [];
  }
}

export default async function handler() {
  const key = typeof process !== 'undefined' && process.env && process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return new Response(JSON.stringify({ error: 'not_configured' }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=300',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  try {
    const headlineSets = await Promise.allSettled(CONTEXT_FEEDS.map(feedTitles));
    const headlines = headlineSets
      .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
      .slice(0, 16);

    const user = `Today is ${new Date().toUTCString()}. Produce a briefing of the 6 most market-relevant ACTIVE geopolitical risks right now for US equity index futures traders (NQ, ES), plus a cross-asset impact matrix.

Recent headlines for context:
${headlines.map((h) => `- ${h}`).join('\n') || '(no headlines available)'}

Rules:
- Only include risks that are genuinely active today; be concrete and current.
- "desc": 2 sentences. "impact": one terse line of asset impact (e.g. "Oil +, Defense +, EU equities -").
- lat/lng: decimal coordinates of the flashpoint.
- matrix: exactly these assets in order: "ES / NQ Futures", "Crude Oil (CL)", "Gold", "USD (DXY)", "Defense equities", "EM FX".`;

    const r = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2500,
        system:
          'You are a senior geopolitical risk analyst producing a live briefing for US equity index futures traders (NQ, ES). Be concrete, current, and specific.',
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: user }],
      }),
    }, 25000);

    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(`anthropic ${r.status}${txt ? ': ' + txt.slice(0, 160) : ''}`);
    }
    const j = await r.json();
    if (j.stop_reason === 'refusal') throw new Error('briefing declined');
    const text = (j.content || []).find((b) => b.type === 'text')?.text || '';
    const data = JSON.parse(text);

    return new Response(JSON.stringify({ ts: Date.now(), model: MODEL, ...data }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        // A geopolitical read is slow-moving — 30 min at the edge keeps every
        // client on one shared, recent briefing at negligible API cost.
        'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}
