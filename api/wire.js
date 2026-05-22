// 24/7 live news wire — edge-cached.
// Aggregates Finnhub market news + live RSS wires (Investing.com, Reuters,
// MarketWatch, CNBC), keeps only market-moving stories relevant to US
// stocks / futures / forex / macro, and classifies sentiment + impact.

export const config = { runtime: 'edge' };

const FINNHUB_KEY =
  (typeof process !== 'undefined' && process.env && process.env.FINNHUB_API_KEY) ||
  'd87rok9r01qmhakh41d0d87rok9r01qmhakh41dg';

const FINNHUB_CATEGORIES = ['general', 'forex', 'merger'];

// RSS wires — these refresh fast and read like a newswire.
const RSS_FEEDS = [
  { name: 'Investing.com', url: 'https://www.investing.com/rss/news_25.rss' },
  { name: 'Investing.com', url: 'https://www.investing.com/rss/news_1.rss' },   // forex
  { name: 'Investing.com', url: 'https://www.investing.com/rss/news_95.rss' },  // economy
  { name: 'MarketWatch',   url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
  { name: 'CNBC',          url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html' },
  { name: 'CNBC',          url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html' }, // economy
];

const RSS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; SIGNAL/1.0)',
  'Accept': 'application/rss+xml, application/xml, text/xml, */*',
};

const MAX_AGE_MS = 1000 * 60 * 60 * 36; // wire feel — last 36h only

// --- Relevance: keep only market-moving, US-market-relevant stories --------
const RELEVANT = [
  // Monetary policy
  'fed', 'fomc', 'federal reserve', 'powell', 'rate cut', 'rate hike',
  'interest rate', 'rate decision', 'dovish', 'hawkish', 'central bank',
  'quantitative', 'basis point', 'monetary policy', 'ecb', 'boj', 'boe',
  // Inflation / macro prints
  'cpi', 'inflation', 'pce', 'ppi', 'core inflation', 'deflation',
  'jobs report', 'payroll', 'nonfarm', 'unemployment', 'jobless claims',
  'pmi', 'gdp', 'ism', 'retail sales', 'consumer confidence', 'consumer sentiment',
  'durable goods', 'housing starts', 'recession', 'soft landing', 'stagflation',
  'economic data', 'economy', 'manufacturing',
  // Markets / instruments
  's&p', 's&p 500', 'nasdaq', 'dow jones', 'wall street', 'stock market',
  'equities', 'stocks', 'futures', 'treasury', 'treasuries', 'yield', 'yields',
  'bond market', 'vix', 'volatility', 'nyse',
  'dollar', 'greenback', 'forex', 'currency', 'euro', 'yen', 'sterling', 'usd',
  // Earnings / corporate catalysts
  'earnings', 'guidance', 'revenue', 'profit', 'quarterly results',
  'beats estimates', 'misses estimates', 'outlook', 'forecast', 'upgrade',
  'downgrade', 'buyback', 'dividend', 'merger', 'acquisition', 'ipo', 'analyst',
  // Geopolitics / commodities that move markets
  'tariff', 'trade war', 'sanction', 'opec', 'crude', 'oil price', 'oil prices',
  'war', 'conflict', 'geopolit', 'china', 'ukraine', 'russia', 'iran',
  'israel', 'middle east', 'stimulus', 'shutdown', 'debt ceiling', 'gold',
];

// Drop obvious off-topic noise even if a relevant word slips in.
const NOISE = [
  'horoscope', 'celebrity', 'recipe', 'box office', 'royal family',
  'how to watch', 'best deals', 'gift guide', 'sponsored', 'review:',
  'best of', 'top 10 things', 'things to watch', 'puzzle', 'crossword',
  'lottery', 'streaming', 'travel guide', 'weekend', 'obituary',
];

// --- Sentiment lexicon -----------------------------------------------------
const BULLISH = [
  'surge', 'surges', 'surged', 'soar', 'soars', 'soared', 'rally', 'rallies',
  'rallied', 'jump', 'jumps', 'jumped', 'climb', 'climbs', 'climbed', 'gain',
  'gains', 'gained', 'rise', 'rises', 'rose', 'rebound', 'rebounds', 'rebounded',
  'record high', 'all-time high', 'beats', 'beat estimates', 'tops estimates',
  'tops forecasts', 'upgrade', 'upgraded', 'strong', 'stronger', 'optimism',
  'bullish', 'rate cut', 'rate cuts', 'dovish', 'stimulus', 'cools', 'cooled',
  'eases', 'easing', 'better than expected', 'boost', 'boosts', 'boosted',
  'outperform', 'recovery', 'higher', 'advances', 'upbeat', 'lifts', 'jumps',
];
const BEARISH = [
  'plunge', 'plunges', 'plunged', 'slump', 'slumps', 'slumped', 'tumble',
  'tumbles', 'tumbled', 'crash', 'crashes', 'crashed', 'sink', 'sinks', 'sank',
  'drop', 'drops', 'dropped', 'fall', 'falls', 'fell', 'slide', 'slides', 'slid',
  'selloff', 'sell-off', 'rout', 'misses', 'miss estimates', 'downgrade',
  'downgraded', 'weak', 'weaker', 'fears', 'warning', 'warns', 'warned',
  'rate hike', 'rate hikes', 'hawkish', 'recession', 'tariff', 'tariffs',
  'sanction', 'sanctions', 'war', 'layoff', 'layoffs', 'cuts jobs',
  'worse than expected', 'slowdown', 'slows', 'slowed', 'contraction',
  'bearish', 'plummet', 'plummets', 'plummeted', 'lower', 'sinks', 'drags',
  'disappointing', 'misses forecasts', 'concern', 'concerns', 'pressure',
];
const HIGH_IMPACT = [
  'fed', 'fomc', 'powell', 'cpi', 'inflation', 'rate cut', 'rate hike',
  'rate decision', 'payroll', 'nonfarm', 'jobs report', 'gdp', 'pce', 'ppi',
  'tariff', 'war', 'sanction', 'recession', 'opec', 'pmi', 'debt ceiling',
  'shutdown', 'crash', 'plunge', 'surge', 'record high', 'selloff', 'rout',
  'jobless claims', 'retail sales', 'ism',
];

const lc = (s) => String(s || '').toLowerCase();
const hasWord = (text, w) => {
  if (w.includes(' ') || w.includes('&') || w.includes('-')) return text.includes(w);
  return new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text);
};
const countHits = (text, list) => list.reduce((n, w) => (hasWord(text, w) ? n + 1 : n), 0);

function classify(headline, summary) {
  const text = lc(headline + ' ' + (summary || ''));
  const head = lc(headline);
  const bull = countHits(text, BULLISH);
  const bear = countHits(text, BEARISH);
  let sentiment = 'neutral';
  if (bull > bear) sentiment = 'bullish';
  else if (bear > bull) sentiment = 'bearish';
  const impact =
    countHits(head, HIGH_IMPACT) > 0 || Math.max(bull, bear) >= 2 ? 'high' : 'normal';
  return { sentiment, impact };
}

// Drop non-English (CJK / Cyrillic / Arabic) headlines.
const isEnglish = (s) => !/[　-鿿가-힯Ѐ-ӿ؀-ۿ]/.test(s);

function isRelevant(headline, summary) {
  if (!isEnglish(headline)) return false;
  const text = lc(headline + ' ' + (summary || ''));
  if (NOISE.some((w) => text.includes(w))) return false;
  return RELEVANT.some((w) => hasWord(text, w));
}

// --- RSS parsing -----------------------------------------------------------
const decodeEntities = (s) =>
  String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ''; }
    })
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCodePoint(parseInt(n, 10)); } catch { return ''; }
    })
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'").replace(/&hellip;/g, '…').replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–').replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘')
    .replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”');

const stripTags = (s) =>
  decodeEntities(
    String(s || '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, '')
  ).replace(/\s+/g, ' ').trim();

function extract(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1] : '';
}

function parseFeed(xml, source) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ||
    xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks.slice(0, 40)) {
    const title = stripTags(extract(b, 'title'));
    if (!title) continue;
    let link = stripTags(extract(b, 'link'));
    if (!link) {
      const m = b.match(/<link[^>]*href="([^"]+)"/i);
      if (m) link = m[1];
    }
    const dateStr = extract(b, 'pubDate') || extract(b, 'updated') || extract(b, 'published') || '';
    const time = new Date(dateStr || Date.now()).getTime();
    const summary = stripTags(extract(b, 'description') || extract(b, 'summary') || extract(b, 'content'));
    items.push({ headline: title, url: link, source, time, summary });
  }
  return items;
}

async function fetchRss(feed) {
  const r = await fetch(feed.url, { headers: RSS_HEADERS, cache: 'no-store' });
  if (!r.ok) throw new Error(`${feed.name} ${r.status}`);
  return parseFeed(await r.text(), feed.name);
}

async function fetchFinnhub(cat) {
  const r = await fetch(
    `https://finnhub.io/api/v1/news?category=${cat}&token=${FINNHUB_KEY}`,
    { cache: 'no-store' }
  );
  if (!r.ok) throw new Error(`finnhub ${cat} ${r.status}`);
  const arr = await r.json();
  return (Array.isArray(arr) ? arr : []).map((it) => ({
    headline: it.headline,
    url: it.url,
    source: it.source || 'Wire',
    time: it.datetime * 1000,
    summary: it.summary || '',
  }));
}

export default async function handler() {
  try {
    const tasks = [
      ...FINNHUB_CATEGORIES.map(fetchFinnhub),
      ...RSS_FEEDS.map(fetchRss),
    ];
    const results = await Promise.allSettled(tasks);
    const raw = [];
    for (const r of results) if (r.status === 'fulfilled') raw.push(...r.value);

    const now = Date.now();
    const seen = new Set();
    const items = raw
      .filter((it) => it && it.headline && it.time && now - it.time < MAX_AGE_MS)
      .filter((it) => isRelevant(it.headline, it.summary))
      .filter((it) => {
        const k = lc(it.headline).replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => b.time - a.time)
      .slice(0, 100)
      .map((it, i) => {
        const { sentiment, impact } = classify(it.headline, it.summary);
        return {
          id: `${it.time}-${i}`,
          headline: it.headline,
          source: it.source,
          url: it.url,
          time: it.time,
          sentiment,
          impact,
        };
      });

    return new Response(JSON.stringify({ ts: now, items }), {
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
