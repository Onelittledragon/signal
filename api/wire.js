// 24/7 live news wire — Finnhub-backed, edge-cached.
// Pulls market news, keeps only items relevant to US stocks / futures /
// forex / macro, and classifies each headline as bullish / bearish / neutral
// with a high-impact flag. Every browser hits this one endpoint.

export const config = { runtime: 'edge' };

const FINNHUB_KEY =
  (typeof process !== 'undefined' && process.env && process.env.FINNHUB_API_KEY) ||
  'd87rok9r01qmhakh41d0d87rok9r01qmhakh41dg';

const CATEGORIES = ['general', 'forex', 'merger'];

// --- Relevance: keep only market-moving, US-market-relevant stories --------
const RELEVANT = [
  // Monetary policy
  'fed', 'fomc', 'federal reserve', 'powell', 'rate cut', 'rate hike',
  'interest rate', 'rate decision', 'dovish', 'hawkish', 'central bank',
  'quantitative', 'basis point', 'monetary policy',
  // Inflation / macro prints
  'cpi', 'inflation', 'pce', 'ppi', 'core inflation', 'deflation',
  'jobs report', 'payroll', 'nonfarm', 'unemployment', 'jobless claims',
  'pmi', 'gdp', 'ism', 'retail sales', 'consumer confidence', 'consumer sentiment',
  'durable goods', 'housing starts', 'recession', 'soft landing', 'stagflation',
  // Markets / instruments
  's&p', 'nasdaq', 'dow jones', 'wall street', 'stock market', 'equities',
  'futures', 'treasury', 'treasuries', 'yield', 'bond market', 'vix',
  'dollar', 'greenback', 'forex', 'currency', 'euro', 'yen', 'sterling',
  // Earnings / corporate catalysts
  'earnings', 'guidance', 'revenue', 'profit', 'quarterly results',
  'beats estimates', 'misses estimates', 'outlook', 'forecast', 'upgrade',
  'downgrade', 'buyback', 'dividend', 'merger', 'acquisition', 'ipo',
  // Geopolitics / commodities that move markets
  'tariff', 'trade war', 'sanction', 'opec', 'crude', 'oil price',
  'war', 'conflict', 'geopolit', 'china', 'ukraine', 'russia', 'iran',
  'israel', 'middle east', 'stimulus', 'shutdown', 'debt ceiling',
];

// Drop obvious off-topic noise even if a relevant word slips in.
const NOISE = [
  'horoscope', 'celebrity', 'recipe', 'box office', 'royal family',
  'how to watch', 'best deals', 'gift guide', 'sponsored',
];

// --- Sentiment lexicon -----------------------------------------------------
const BULLISH = [
  'surge', 'surges', 'soar', 'soars', 'rally', 'rallies', 'jump', 'jumps',
  'climb', 'climbs', 'gain', 'gains', 'rise', 'rises', 'rebound', 'rebounds',
  'record high', 'all-time high', 'beats', 'beat estimates', 'tops estimates',
  'upgrade', 'upgraded', 'strong', 'stronger', 'optimism', 'bullish',
  'rate cut', 'dovish', 'stimulus', 'cools', 'cooled', 'eases', 'easing',
  'better than expected', 'boost', 'boosts', 'outperform', 'recovery',
];
const BEARISH = [
  'plunge', 'plunges', 'slump', 'slumps', 'tumble', 'tumbles', 'crash',
  'crashes', 'sink', 'sinks', 'drop', 'drops', 'fall', 'falls', 'slide',
  'slides', 'selloff', 'sell-off', 'rout', 'misses', 'miss estimates',
  'downgrade', 'downgraded', 'weak', 'weaker', 'fears', 'warning', 'warns',
  'rate hike', 'hawkish', 'recession', 'tariff', 'sanction', 'war',
  'layoff', 'layoffs', 'cuts jobs', 'worse than expected', 'slowdown',
  'slows', 'contraction', 'bearish', 'tumbling', 'plummet', 'plummets',
];
// Words that, present at all, mark a story as high-impact.
const HIGH_IMPACT = [
  'fed', 'fomc', 'powell', 'cpi', 'inflation', 'rate cut', 'rate hike',
  'rate decision', 'payroll', 'nonfarm', 'jobs report', 'gdp', 'pce',
  'tariff', 'war', 'sanction', 'recession', 'opec', 'pmi', 'debt ceiling',
  'shutdown', 'crash', 'plunge', 'surge', 'record high', 'selloff',
];

const lc = (s) => String(s || '').toLowerCase();
const countHits = (text, list) => list.reduce((n, w) => (text.includes(w) ? n + 1 : n), 0);

function classify(item) {
  const text = lc(item.headline + ' ' + (item.summary || ''));
  const bull = countHits(text, BULLISH);
  const bear = countHits(text, BEARISH);
  let sentiment = 'neutral';
  if (bull > bear) sentiment = 'bullish';
  else if (bear > bull) sentiment = 'bearish';
  const impact =
    countHits(lc(item.headline), HIGH_IMPACT) > 0 || Math.max(bull, bear) >= 2
      ? 'high'
      : 'normal';
  return { sentiment, impact };
}

function isRelevant(item) {
  const text = lc(item.headline + ' ' + (item.summary || ''));
  if (NOISE.some((w) => text.includes(w))) return false;
  return RELEVANT.some((w) => text.includes(w));
}

async function fetchCategory(cat) {
  const url = `https://finnhub.io/api/v1/news?category=${cat}&token=${FINNHUB_KEY}`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`finnhub ${cat} ${r.status}`);
  return r.json();
}

export default async function handler() {
  try {
    const results = await Promise.allSettled(CATEGORIES.map(fetchCategory));
    const raw = [];
    for (const r of results) if (r.status === 'fulfilled' && Array.isArray(r.value)) raw.push(...r.value);

    const seen = new Set();
    const items = raw
      .filter((it) => it && it.headline && it.datetime)
      .filter(isRelevant)
      .filter((it) => {
        const k = lc(it.headline).replace(/\s+/g, ' ').trim();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => b.datetime - a.datetime)
      .slice(0, 80)
      .map((it) => {
        const { sentiment, impact } = classify(it);
        return {
          id: it.id,
          headline: it.headline,
          source: it.source || 'Wire',
          url: it.url,
          time: it.datetime * 1000,
          sentiment,
          impact,
        };
      });

    return new Response(JSON.stringify({ ts: Date.now(), items }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30',
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
