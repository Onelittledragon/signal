// SIGNAL — single-page market intelligence app.
// Real data: RSS news wires, Claude-generated geopolitical briefing on a live D3 orthographic globe.

(() => {
  const CFG = window.SIGNAL_CONFIG;
  const state = {
    news: [],
    geo: null,
    mood: null,       // { mood: "bull" | "bear", intensity: 0..1, label, score }
    updated: null,
    world: null,
    geoFilter: "all",       // "all" | "high" | "medium" | "low"
    activePopupRisk: null,
  };

  // ---- DOM helpers ------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
  const toast = (msg) => {
    const el = $("#toast"); el.textContent = msg;
    requestAnimationFrame(() => el.classList.add("show"));
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("show"), 2200);
  };
  const fmtTime = (d) => d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  const fmtTimeUTC = (d) => `${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")}:${String(d.getUTCSeconds()).padStart(2,"0")}`;
  const fmtDateTime = (d) => `${d.toLocaleDateString("en-US", { month: "short", day: "2-digit" })} ${fmtTime(d)}`;
  const relTime = (d) => {
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  };

  // ---- Tabs -------------------------------------------------------------
  const showTab = (name) => {
    $$(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    $$(".tab-panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === name));
    document.body.classList.toggle("situation-room", name === "geopolitical");
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (history.replaceState) history.replaceState(null, "", `#${name}`);
    if (name === "geopolitical") {
      ensureGlobe();
    }
    // Re-apply mood (the geo tab suppresses the neon tint)
    applyMood();
  };
  $$(".tab-btn").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  document.addEventListener("click", (e) => {
    const j = e.target.closest("[data-jump]");
    if (j) showTab(j.dataset.jump);
  });
  const startTab = (location.hash || "#signal").slice(1);
  if ($$(".tab-btn").some((b) => b.dataset.tab === startTab)) showTab(startTab);

  // Clocks
  const tickClock = () => {
    $("[data-clock]").textContent = fmtTime(new Date());
    const sr = $("[data-sr-clock]"); if (sr) sr.textContent = fmtTimeUTC(new Date());
  };
  tickClock(); setInterval(tickClock, 1000);
  const todayEl = $("[data-today-date]");
  if (todayEl) todayEl.textContent = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  // ---- Fetchers: proxy helpers -----------------------------------------
  async function proxiedFetch(url, { json = true } = {}) {
    let lastErr = null;
    for (const p of CFG.CORS_PROXIES) {
      try {
        const r = await fetch(p + encodeURIComponent(url));
        if (!r.ok) throw new Error(`HTTP ${r.status} (${p})`);
        return json ? await r.json() : await r.text();
      } catch (e) { lastErr = e; }
    }
    // Fallback: wrapper proxy that returns { contents: "..." }
    try {
      const r = await fetch(CFG.CORS_JSON_WRAPPER + encodeURIComponent(url));
      if (!r.ok) throw new Error(`wrapper HTTP ${r.status}`);
      const j = await r.json();
      return json ? JSON.parse(j.contents) : j.contents;
    } catch (e) { lastErr = e; }
    throw lastErr || new Error("all proxies failed");
  }

  // ---- News (server-side aggregator via /api/news) ----------------------
  // The Vercel function aggregates and dedupes all feeds, so every device
  // shares the same headline list and ordering.
  async function fetchNews() {
    const r = await fetch("/api/news", { cache: "no-store" });
    if (!r.ok) throw new Error("news " + r.status);
    const j = await r.json();
    const raw = (j.items || []).map((it) => ({
      title: stripTags(it.title || ""),
      link: it.link,
      source: it.source,
      time: new Date(it.time || Date.now()),
      summary: truncate(stripTags(it.summary || ""), 260),
    }));
    const all = raw;
    const sources = new Set(raw.map((n) => n.source));
    const successful = sources.size;
    if (all.length === 0) throw new Error("news endpoint empty");

    const seen = new Set();
    const deduped = [];
    for (const item of all.sort((a, b) => b.time - a.time)) {
      // Clean RSS junk suffixes like " - Reuters", " | MarketWatch", " :: CNBC"
      item.title = cleanHeadline(item.title);
      const key = item.title.toLowerCase().replace(/\s+/g, " ").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const { sentiment, magnitude } = scoreSentiment(`${item.title} ${item.summary}`);
      item.sentiment = sentiment;
      item.sentimentMag = magnitude;
      item.impact = scoreImpact(item);
      deduped.push(item);
    }
    // Sort by market impact (most market-moving first), not by timestamp.
    deduped.sort((a, b) => b.impact - a.impact);

    // Filler filter — only stories that actually matter for NQ/ES:
    //   1) must hit at least one topic bucket (i.e. it's about Fed/CPI/earnings/etc.),
    //      OR score unusually high on sentiment intensity,
    //   2) must clear a minimum impact floor,
    //   3) hard cap the timeline at 25 items so the feed doesn't flood.
    const curated = deduped.filter((n) => {
      const hitsTopic = (n.topics && n.topics.length > 0);
      const strongSent = (n.sentimentMag || 0) >= 2;
      return (hitsTopic || strongSent) && (n.impact || 0) >= 28;
    });
    // Fallback — if the filter is too aggressive, show the top 15 raw items so the feed is never empty.
    const items = curated.length >= 8 ? curated.slice(0, 25) : deduped.slice(0, 15);
    return { items, sources: successful };
  }

  // Strip the common " - Source", " | Source", " :: Source" suffixes RSS feeds tack on.
  function cleanHeadline(t) {
    let s = String(t || "").trim();
    s = s.replace(/\s+[—|\-–:]{1,3}\s*(Reuters|Bloomberg|CNBC|MarketWatch|Yahoo Finance|Yahoo|Investing\.com|Investing|Dow Jones|WSJ)\s*$/i, "");
    s = s.replace(/^(BREAKING|URGENT|JUST IN|UPDATE\s*\d*)\s*[:\-]\s*/i, "");
    return s.trim();
  }

  // Map the RSS source name to a short @handle for the Twitter-style meta row.
  const SOURCE_HANDLES = {
    "Reuters Business": "@Reuters",
    "Bloomberg":        "@Bloomberg",
    "MarketWatch":      "@MarketWatch",
    "CNBC Markets":     "@CNBC",
    "Yahoo Finance":    "@YahooFinance",
    "Investing.com":    "@Investingcom",
  };
  const handleFor = (src) => SOURCE_HANDLES[src] || `@${String(src || "").replace(/[^A-Za-z0-9]+/g, "")}`;

  const stripTags = (s) => String(s).replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  const truncate = (s, n) => s.length > n ? s.slice(0, n - 1).trim() + "…" : s;

  function scoreSentiment(text) {
    const t = text.toLowerCase();
    const bull = ["rally","surge","jump","soar","gain","gains","record high","beat","beats","tops","strong","upgrade","growth","optimis","rate cut","cuts rates","dovish","easing","recovery","rebound","buy","outperform","robust","accelerat","bullish"];
    const bear = ["slump","plunge","plummet","tumble","fall","falls","slide","miss","misses","weak","downgrade","recession","selloff","sell-off","rate hike","hikes rates","hawkish","tighten","decline","fears","crisis","bankrupt","default","layoff","contraction","bearish","warning","collapse"];
    let s = 0, hits = 0;
    for (const w of bull) if (t.includes(w)) { s += 1; hits++; }
    for (const w of bear) if (t.includes(w)) { s -= 1; hits++; }
    const sentiment = s >= 1 ? "bullish" : s <= -1 ? "bearish" : "neutral";
    return { sentiment, magnitude: hits };
  }

  // Market impact score — weights topic heft, sentiment strength, source
  // reputation, and recency. Higher = more market-moving for NQ/ES.
  // Topic weights reflect how much tape reaction a given category usually
  // drives in US equity index futures.
  const TOPIC_WEIGHTS = [
    { w: 30, label: "Fed / FOMC",        words: ["fomc","federal reserve","fed ","rate decision","rate cut","rate hike","powell","fed chair","dot plot"] },
    { w: 28, label: "Inflation",         words: ["cpi","inflation","pce","core pce","ppi"] },
    { w: 26, label: "Jobs",              words: ["nonfarm","payroll","unemployment rate","jobs report"] },
    { w: 22, label: "Growth / GDP",      words: ["gdp","recession","economic growth"] },
    { w: 22, label: "Global Central Bank", words: ["ecb","boj","bank of japan","bank of england","pboc"] },
    { w: 20, label: "Conflict",          words: ["war","attack","strike","missile","airstrike","invasion","ceasefire","sanctions"] },
    { w: 20, label: "Policy / Tariffs",  words: ["tariff","trade war","trump","biden","white house","congress"] },
    { w: 18, label: "Earnings",          words: ["earnings","guidance","revenue","profit warning","beats estimates","misses estimates"] },
    { w: 18, label: "Mega-Cap Tech",     words: ["nvidia","apple","microsoft","tesla","amazon","meta","google","alphabet","tsmc"] },
    { w: 16, label: "Oil / Energy",      words: ["oil","crude","brent","opec","saudi","iran","strait of hormuz","red sea"] },
    { w: 16, label: "China / Taiwan",    words: ["china","taiwan","xi jinping","beijing"] },
    { w: 14, label: "Rates / Bonds",     words: ["bond","treasury","yield","auction","2-year","10-year","yield curve"] },
    { w: 14, label: "Crypto",            words: ["bitcoin","crypto","ethereum"] },
    { w: 12, label: "Credit / Banks",    words: ["bank","credit","default","bankruptcy","systemic","contagion"] },
    { w: 10, label: "Indices",           words: ["sp 500","s&p","nasdaq","dow jones","futures"] },
    { w: 12, label: "Breaking",          words: ["breaking","urgent","alert","just in"] },
  ];
  const SOURCE_WEIGHTS = {
    "Reuters Business": 1.25,
    "Bloomberg": 1.25,
    "MarketWatch": 1.05,
    "CNBC Markets": 1.0,
    "Yahoo Finance": 0.9,
    "Investing.com": 0.9,
  };
  function scoreImpact(item) {
    const text = `${item.title} ${item.summary}`.toLowerCase();
    let topic = 0;
    const topics = [];
    for (const bucket of TOPIC_WEIGHTS) {
      for (const w of bucket.words) {
        if (text.includes(w)) { topic += bucket.w; topics.push(bucket.label); break; }
      }
    }
    item.topics = topics;
    // Sentiment magnitude adds conviction — mixed/strong-opinion stories rank higher.
    const sentimentBoost = (item.sentimentMag || 0) * 3;
    // Recency decay: full credit under 2h, halved by ~12h, minimal after a day.
    const ageH = Math.max(0, (Date.now() - item.time.getTime()) / 3_600_000);
    const recency = Math.exp(-ageH / 10) * 20;
    // Source weight scales the final score.
    const srcMult = SOURCE_WEIGHTS[item.source] ?? 1;
    // Title-length guard — gimmicky one-word headlines score lower.
    const titleLen = item.title.length;
    const lenMult = titleLen < 25 ? 0.7 : 1;
    return (topic + sentimentBoost + recency) * srcMult * lenMult;
  }

  // ---- Claude geopolitical briefing ------------------------------------
  async function fetchGeopolitical(newsContext) {
    const key = CFG.CLAUDE_API_KEY;
    if (!key) return null;
    const newsBlob = (newsContext || []).slice(0, 15)
      .map((n) => `- [${n.source}] ${n.title}`).join("\n");
    const system = "You are a senior geopolitical risk analyst producing a daily briefing for US equity index futures traders (NQ, ES). Return ONLY valid JSON matching the requested schema. No prose outside JSON.";
    const user = `Today is ${new Date().toUTCString()}. Based on your knowledge and the recent headlines below, produce a briefing of the 6 most market-relevant ACTIVE geopolitical risks right now.

Recent headlines for context:
${newsBlob}

Return JSON with this exact shape:
{
  "risks": [
    {
      "region": "<short region name>",
      "title": "<short flashpoint name, 3-8 words>",
      "severity": "high" | "medium" | "low",
      "lat": <number, decimal latitude, -90..90>,
      "lng": <number, decimal longitude, -180..180>,
      "desc": "<2 sentences, concrete and current>",
      "impact": "<one terse line of asset impact, e.g. 'Oil +, Defense +, EU equities -'>"
    }
  ],
  "matrix": [
    { "asset": "ES / NQ Futures", "read": "<one line>", "tone": "bull" | "bear" | "amber" | "neutral" },
    { "asset": "Crude Oil (CL)", "read": "<one line>", "tone": "..." },
    { "asset": "Gold", "read": "<one line>", "tone": "..." },
    { "asset": "USD (DXY)", "read": "<one line>", "tone": "..." },
    { "asset": "Defense equities", "read": "<one line>", "tone": "..." },
    { "asset": "EM FX", "read": "<one line>", "tone": "..." }
  ]
}`;
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: CFG.CLAUDE_MODEL,
        max_tokens: 2000,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!r.ok) throw new Error("Claude " + r.status);
    const j = await r.json();
    const text = j.content?.[0]?.text || "";
    const jsonStr = text.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonStr) throw new Error("Claude JSON parse");
    return JSON.parse(jsonStr);
  }

  // Cached briefing — used when no API key is configured.
  const CACHED_GEO = {
    risks: [
      { region: "Eastern Europe", title: "Ukraine–Russia front line",      severity: "high",   lat: 49.0, lng: 36.0, desc: "Extended-range strikes on energy and port infrastructure continue. Black Sea grain corridor remains under intermittent closure.", impact: "Oil +, Defense +, EU equities -" },
      { region: "Middle East",    title: "Red Sea shipping disruption",    severity: "high",   lat: 15.5, lng: 42.5, desc: "Persistent attacks on Suez-bound vessels keep Cape of Good Hope diversions in place. Marine insurance premia still elevated for Gulf transit.", impact: "Tankers +, Brent +, Retail margins -" },
      { region: "Asia-Pacific",   title: "Taiwan Strait tensions",         severity: "medium", lat: 24.0, lng: 120.0, desc: "PLA incursions across the median line remain routine. Semiconductor supply chain exposure keeps tail-risk premium bid in NVDA/TSM options.", impact: "Semis vol +, JPY bid on headlines" },
      { region: "Central Asia",   title: "Strait of Hormuz patrols",       severity: "medium", lat: 26.6, lng: 56.2, desc: "Increased IRGC naval activity and vessel seizures lifting Gulf crude insurance rates. No full closure, but headline risk is high.", impact: "Brent +, Gulf shipping -" },
      { region: "North America",  title: "US election policy uncertainty", severity: "medium", lat: 38.9, lng: -77.0, desc: "Divergent tariff and tax platforms now showing up in sector-level options skew, particularly autos and China-exposed tech.", impact: "Sector rotation risk" },
      { region: "Africa",         title: "Sahel instability",              severity: "low",    lat: 15.0, lng: 0.0, desc: "Political transitions in Sahelian states continue to pressure uranium and gold exports — marginal driver for spot markets.", impact: "Uranium +, EU utilities -" },
    ],
    matrix: [
      { asset: "ES / NQ Futures",   read: "Headline-sensitive; tail-risk premia elevated",   tone: "amber" },
      { asset: "Crude Oil (CL)",    read: "Bid on supply-corridor risk (Red Sea, Hormuz)",   tone: "bear" },
      { asset: "Gold",              read: "Haven demand firm; buy-the-dip bias intact",      tone: "bull" },
      { asset: "USD (DXY)",         read: "Two-way risk; firm on acute escalation only",     tone: "amber" },
      { asset: "Defense equities",  read: "Structural bid while conflicts remain active",     tone: "bull" },
      { asset: "EM FX",             read: "Under pressure from risk-off positioning",         tone: "bear" },
    ],
  };

  // ---- Mood: drives the neon page tint --------------------------------
  // This is a FORECAST read, not a live-tape read. It estimates where
  // NQ/ES *should* trade given the current news context — which matters
  // most when the market is closed (weekends, overnight). If something
  // unhinged hits Saturday night, the page should already be screaming
  // red before Sunday's globex open.
  //
  // Two multipliers on top of the macro-weighted regime score:
  //   1. Market-closed boost — futures gap risk compounds unabsorbed.
  //   2. Shock amplifier — recent catastrophic/conflict headlines force
  //      the intensity floor up regardless of breadth.
  const HTF_MACRO_TOPICS = new Set([
    "Fed / FOMC", "Inflation", "Jobs", "Growth / GDP",
    "Global Central Bank", "Rates / Bonds", "Policy / Tariffs",
    "Conflict",
  ]);
  const SHOCK_RE = /\b(nuclear|nuke|invasion|invade|missile|airstrike|\bwar\b|bombing|attack on|assassinat|hostage|coup|escalat|catastroph|collapse|bankrupt|emergency|unprecedent|crash|plunge|meltdown|default|martial law|state of emergency)\b/i;

  // NQ/ES (CME globex) trade Sun 6pm ET → Fri 5pm ET with a 5-6pm ET daily halt.
  function isMarketClosed(now = new Date()) {
    const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const day = et.getDay(); // 0 Sun, 6 Sat
    const mins = et.getHours() * 60 + et.getMinutes();
    if (day === 6) return true;                              // Saturday — always closed
    if (day === 0 && mins < 18 * 60) return true;            // Sunday before 6pm ET
    if (day === 5 && mins >= 17 * 60) return true;           // Friday after 5pm ET
    if (day >= 1 && day <= 4 && mins >= 17 * 60 && mins < 18 * 60) return true; // daily halt
    return false;
  }

  function computeMood() {
    if (!state.news.length) return { mood: null, label: "Reading the tape", bull: 0, bear: 0, score: 0, intensity: 0.15, shock: false, closed: false };
    const pool = state.news.slice(0, 25);
    let bull = 0, bear = 0;
    pool.forEach((n, i) => {
      const hasMacro = (n.topics || []).some((t) => HTF_MACRO_TOPICS.has(t));
      // Macro/regime-defining stories carry 2.2× weight; tactical at 0.8×.
      const weight = (n.impact || 1)
        * (i === 0 ? 1.6 : 1)
        * (hasMacro ? 2.2 : 0.8);
      if (n.sentiment === "bullish") bull += weight;
      else if (n.sentiment === "bearish") bear += weight;
    });
    const total = bull + bear;
    const score = total > 0 ? (bull - bear) / total : 0;  // -1 … +1
    // No middle ground — always pick a side. Tie defaults bullish.
    const mood = score >= 0 ? "bull" : "bear";
    const mag = Math.abs(score);

    // Detect shock: any recent (<12h) top-5 headline with catastrophic keywords.
    const shock = state.news.slice(0, 5).some((n) => {
      const ageH = Math.max(0, (Date.now() - n.time.getTime()) / 3_600_000);
      if (ageH > 12) return false;
      return SHOCK_RE.test(`${n.title} ${n.summary || ""}`);
    });
    const closed = isMarketClosed();

    // Base intensity from score magnitude, then layer amplifiers:
    //   · closed market → 1.45× (forecast pressure hasn't bled off yet)
    //   · shock         → raise floor to 0.80
    //   · both          → pin at 1.0 (code red)
    let intensity = Math.max(0.08, Math.min(1, mag * 1.8));
    if (closed) intensity = Math.min(1, intensity * 1.45);
    if (shock)  intensity = Math.min(1, Math.max(intensity, 0.80));
    if (shock && closed) intensity = 1;

    const side = mood === "bull" ? "BULL" : "BEAR";
    let label = side;
    if (shock && closed) label = `${side} · FORECAST SHOCK`;
    else if (shock)      label = `${side} · SHOCK`;
    else if (closed)     label = `${side} · FORECAST`;
    else if (mag >= 0.45) label = `${side} · STRONG`;

    return { mood, label, bull: Math.round(bull), bear: Math.round(bear), score, intensity, shock, closed };
  }

  // Inline uptrend / downtrend arrow icons — stroke currentColor so the CSS
  // color / glow apply. Classic line-chart arrows: rising pivots with arrowhead
  // in the upper-right for bull, falling pivots with arrowhead in the lower-right for bear.
  const BULL_SVG = `<svg class="pill-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="3 17 9 11 13 15 21 7"/>
    <polyline points="15 7 21 7 21 13"/>
  </svg>`;
  const BEAR_SVG = `<svg class="pill-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="3 7 9 13 13 9 21 17"/>
    <polyline points="15 17 21 17 21 11"/>
  </svg>`;

  function applyMood() {
    const m = computeMood();
    state.mood = m;
    // Don't tint while the Situation Room (geo) tab is active
    const inGeo = document.body.classList.contains("situation-room");
    document.body.classList.remove("mood-bull","mood-bear");
    if (m.mood && !inGeo) document.body.classList.add(`mood-${m.mood}`);
    document.body.style.setProperty("--mood-i", inGeo ? 0 : m.intensity);

    const pill = $("#signal-pill-mini");
    if (pill) {
      if (m.mood === "bull") pill.innerHTML = BULL_SVG;
      else if (m.mood === "bear") pill.innerHTML = BEAR_SVG;
      else pill.innerHTML = "";
      pill.classList.toggle("is-shock", !!m.shock);
      pill.setAttribute("aria-label", m.label || "Forecast read");
      pill.setAttribute("title", m.label || "Forecast read");
    }
    const eb = $("#signal-mood-label");
    if (eb) eb.textContent = m.label;
  }

  const badgeFor = (s) => s === "bullish" ? "badge-bull" : s === "bearish" ? "badge-bear" : "badge-neutral";

  // ---- Render: News (Twitter-style feed) -------------------------------
  let newsFilter = "all";

  const avatarFor = (src) => {
    const s = String(src || "?").trim();
    const parts = s.split(/\s+/).filter(Boolean);
    const initials = (parts.length >= 2 ? parts[0][0] + parts[1][0] : s.slice(0, 2)).toUpperCase();
    // Stable color from source name.
    let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    const hue = Math.abs(h) % 360;
    return { initials, hue };
  };

  const verifiedSources = new Set([
    "Reuters","Bloomberg","Financial Times","FT","Wall Street Journal","WSJ",
    "Associated Press","AP","CNBC","BBC","The New York Times","NYT","NYTimes",
  ]);

  function postHtml(n, i, opts = {}) {
    const score = Math.round(n.impact || 0);
    const fillPct = Math.min(100, score);
    const av = avatarFor(n.source);
    const tags = (n.topics || []).slice(0, 4);
    const verified = verifiedSources.has(String(n.source));
    const isPinned = !!opts.pinned;
    const impactClass = score >= 60 ? "tw-impact-high" : score >= 35 ? "tw-impact-mid" : "tw-impact-low";
    const verdict =
      score >= 80 ? "Likely already moving futures" :
      score >= 60 ? "High potential to move futures" :
      score >= 40 ? "Moderate tape influence" :
      score >= 25 ? "Background noise" :
                    "Low direct impact";

    return `
      <article class="tw-post ${esc(n.sentiment)} ${isPinned ? "tw-pinned" : ""}" style="animation-delay:${i * 26}ms">
        ${isPinned ? `<div class="tw-pin-flag"><span class="tw-pin-dot"></span> HIGHEST MARKET IMPACT · PINNED</div>` : ""}
        <div class="tw-post-row">
          <div class="tw-post-main">
            <div class="tw-post-head">
              <span class="tw-name">${esc(n.source)}</span>
              ${verified ? `<svg class="tw-verified" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M22.5 12.5l-2-2.3.3-3-3-.6L16.3 4l-2.8 1.2L11 3.4 8.7 5.2 5.9 4 4.5 6.6l-3 .6.3 3-2 2.3 2 2.3-.3 3 3 .6 1.2 2.6 2.8-1.2 2.5 1.8 2.3-1.8 2.8 1.2 1.5-2.6 3-.6-.3-3zM10.6 16.6l-3.8-3.8 1.5-1.5 2.3 2.3 5.3-5.3 1.5 1.5z"/></svg>` : ""}
              <span class="tw-handle">${esc(handleFor(n.source))}</span>
              <span class="tw-dot">·</span>
              <span class="tw-time">${relTime(n.time)}</span>
              <span class="tw-impact-chip ${impactClass}" title="Market impact score">${score}</span>
            </div>
            ${isPinned
              ? `<h2 class="tw-title tw-title-hero"><a href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a></h2>`
              : `<div class="tw-title"><a href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a></div>`}
            ${n.summary ? `<p class="tw-summary">${esc(n.summary)}</p>` : ""}
            ${tags.length ? `<div class="tw-tags">${tags.map((t) => `<span class="tw-tag">#${esc(String(t).replace(/\s+/g, ""))}</span>`).join("")}</div>` : ""}
            <div class="tw-impact-bar"><div class="tw-impact-fill ${impactClass}" style="width:${fillPct}%"></div></div>
            <div class="tw-actions">
              <span class="tw-action" title="Sentiment"><span class="tw-sent-dot ${esc(n.sentiment)}"></span>${esc(n.sentiment)}</span>
              <span class="tw-action" title="Market impact">⚡ impact ${score}</span>
              <span class="tw-action tw-action-verdict">${esc(verdict)}</span>
              <a class="tw-action tw-action-link" href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">Open ↗</a>
            </div>
          </div>
        </div>
      </article>`;
  }

  function renderNews() {
    const feed = $("#tw-feed");
    if (!feed) return;
    const sources = new Set(state.news.map((n) => n.source));
    $("#news-sources").textContent = `${sources.size} sources`;

    if (!state.news.length) {
      feed.innerHTML = `<div class="tw-empty">Live wire feeds are being scored for market impact. Stories will appear here ranked by projected NQ/ES effect.</div>`;
      $("#news-count").textContent = 0;
      applyMood();
      return;
    }

    const top = state.news[0];
    const rest = state.news.slice(1);
    const filtered = rest.filter((n) => newsFilter === "all" ? true : n.sentiment === newsFilter);
    const showTop = newsFilter === "all" || top.sentiment === newsFilter;

    const html = [];
    if (showTop) html.push(postHtml(top, 0, { pinned: true }));
    filtered.forEach((n, i) => html.push(postHtml(n, i + 1)));

    feed.innerHTML = html.length
      ? html.join("")
      : `<div class="tw-empty">No stories in this filter.</div>`;

    $("#news-count").textContent = (showTop ? 1 : 0) + filtered.length;

    // Sidebar
    const trending = $("#tw-trending");
    if (trending) {
      trending.innerHTML = state.news.slice(0, 5).map((n, i) => `
        <a class="tw-trend" href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">
          <div class="tw-trend-rank">${i + 1}</div>
          <div class="tw-trend-body">
            <div class="tw-trend-meta">${esc(n.source)} · impact ${Math.round(n.impact || 0)}</div>
            <div class="tw-trend-title">${esc(n.title)}</div>
          </div>
        </a>`).join("");
    }
    const bullN = state.news.filter((n) => n.sentiment === "bullish").length;
    const bearN = state.news.filter((n) => n.sentiment === "bearish").length;
    const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    setText("#tw-bull", bullN);
    setText("#tw-bear", bearN);
    setText("#tw-sources-n", sources.size);

    applyMood();
  }

  function renderTopMover() { /* superseded by Twitter-style feed; pinned post handles this */ }

  $$("[data-filter]").forEach((btn) => btn.addEventListener("click", () => {
    newsFilter = btn.dataset.filter;
    $$("[data-filter]").forEach((b) => b.classList.toggle("active", b === btn));
    renderNews();
  }));

  // =====================================================================
  // GLOBE — D3 orthographic projection, auto-rotate, drag, risk pins
  // =====================================================================
  const globe = {
    svg: null,
    projection: null,
    path: null,
    rotation: [0, -15, 0],
    autoRotate: true,
    width: 720,
    height: 720,
    initialized: false,
  };

  async function ensureGlobe() {
    if (!globe.initialized) {
      await initGlobe();
      globe.initialized = true;
    }
    drawGlobe();
  }

  async function initGlobe() {
    const svgEl = $("#globe-svg");
    if (!svgEl || typeof d3 === "undefined" || typeof topojson === "undefined") return;

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();

    const defs = svg.append("defs");
    const glow = defs.append("radialGradient")
      .attr("id", "globeGlow")
      .attr("cx", "50%").attr("cy", "50%").attr("r", "50%");
    glow.append("stop").attr("offset", "60%").attr("stop-color", "rgba(94,200,212,0)");
    glow.append("stop").attr("offset", "92%").attr("stop-color", "rgba(94,200,212,0.18)");
    glow.append("stop").attr("offset", "100%").attr("stop-color", "rgba(94,200,212,0)");

    const oceanGrad = defs.append("radialGradient")
      .attr("id", "oceanGrad")
      .attr("cx", "35%").attr("cy", "30%").attr("r", "80%");
    oceanGrad.append("stop").attr("offset", "0%").attr("stop-color", "#16263D");
    oceanGrad.append("stop").attr("offset", "60%").attr("stop-color", "#0A1320");
    oceanGrad.append("stop").attr("offset", "100%").attr("stop-color", "#03070C");

    globe.svg = svg;
    globe.projection = d3.geoOrthographic()
      .scale(310)
      .translate([globe.width / 2, globe.height / 2])
      .rotate(globe.rotation)
      .clipAngle(90);
    globe.path = d3.geoPath(globe.projection);

    // Outer glow
    svg.append("circle")
      .attr("cx", globe.width / 2)
      .attr("cy", globe.height / 2)
      .attr("r", 340)
      .attr("class", "globe-glow");

    // Ocean
    svg.append("path")
      .datum({ type: "Sphere" })
      .attr("class", "globe-ocean")
      .attr("fill", "url(#oceanGrad)")
      .attr("d", globe.path);

    // Graticule
    const graticule = d3.geoGraticule().step([15, 15]);
    svg.append("path")
      .datum(graticule)
      .attr("class", "globe-graticule")
      .attr("d", globe.path);

    // Placeholder groups — countries painted first, then great-circle arcs,
    // then risk pins on top so they sit above everything.
    svg.append("g").attr("id", "globe-countries-layer");
    svg.append("g").attr("id", "globe-arcs-layer");
    svg.append("g").attr("id", "globe-risks-layer");

    // Sphere outline
    svg.append("path")
      .datum({ type: "Sphere" })
      .attr("class", "globe-sphere")
      .attr("d", globe.path);

    // Load world topojson (countries)
    if (!state.world) {
      try {
        const res = await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json");
        const topo = await res.json();
        state.world = topojson.feature(topo, topo.objects.countries);
      } catch (e) {
        console.warn("world atlas fetch failed, retrying via proxy", e);
        try {
          const topo = await proxiedFetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json", { json: true });
          state.world = topojson.feature(topo, topo.objects.countries);
        } catch (e2) { console.warn("world atlas fallback failed", e2); }
      }
    }

    // Drag handler
    let v0, r0, q0;
    const drag = d3.drag()
      .on("start", (event) => {
        globe.autoRotate = false;
        updateToggleLabel();
        v0 = versor.cartesian(globe.projection.invert([event.x, event.y]));
        r0 = globe.projection.rotate();
        q0 = versor(r0);
      })
      .on("drag", (event) => {
        const v1 = versor.cartesian(globe.projection.rotate(r0).invert([event.x, event.y]));
        const q1 = versor.multiply(q0, versor.delta(v0, v1));
        const newRot = versor.rotation(q1);
        globe.rotation = newRot;
        globe.projection.rotate(newRot);
        renderGlobeFrame();
      });
    svg.call(drag);

    // Auto-rotate loop
    d3.timer((elapsed) => {
      if (!globe.autoRotate) return;
      globe.rotation[0] += 0.12;
      globe.projection.rotate(globe.rotation);
      renderGlobeFrame();
    });

    // Rotation controls
    $("#globe-toggle").addEventListener("click", () => {
      globe.autoRotate = !globe.autoRotate;
      updateToggleLabel();
    });
    $$(".gc-btn[data-rotate]").forEach((b) => {
      const dir = b.dataset.rotate;
      if (dir === "left" || dir === "right") {
        b.addEventListener("click", () => {
          globe.autoRotate = false;
          updateToggleLabel();
          globe.rotation[0] += dir === "left" ? -20 : 20;
          globe.projection.rotate(globe.rotation);
          renderGlobeFrame();
        });
      }
    });

    // Zoom controls — buttons + wheel + pinch-friendly
    $$(".gc-btn[data-zoom]").forEach((b) => {
      b.addEventListener("click", () => zoomGlobe(b.dataset.zoom));
    });
    svgEl.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      zoomGlobe(ev.deltaY < 0 ? "in" : "out");
    }, { passive: false });

    // Cursor lat/lng HUD + country-name tooltip
    svgEl.addEventListener("mousemove", onGlobePointerMove);
    svgEl.addEventListener("mouseleave", onGlobePointerLeave);

    // Close the flashpoint popup when the user clicks empty ocean
    svgEl.addEventListener("click", (ev) => {
      if (ev.target.closest(".risk-pin")) return;
      hideFlashpointPopup();
    });
  }

  // Clamp + apply a new projection scale. Re-renders the whole frame.
  function zoomGlobe(dir) {
    if (!globe.projection) return;
    const base = 310;
    const min = 220, max = 820;
    let s = globe.projection.scale();
    if (dir === "in")        s = Math.min(max, s * 1.18);
    else if (dir === "out")  s = Math.max(min, s * 0.85);
    else if (dir === "reset") s = base;
    else if (typeof dir === "number") s = Math.max(min, Math.min(max, s * dir));
    globe.projection.scale(s);
    renderGlobeFrame();
  }

  // Format decimal coord as "34.1° N" / "-118.2°" → "118.2° W" etc.
  function formatCoord(v, kind) {
    if (v == null || Number.isNaN(v)) return "—";
    const abs = Math.abs(v).toFixed(1);
    const dir = kind === "lat" ? (v >= 0 ? "N" : "S") : (v >= 0 ? "E" : "W");
    return `${abs}° ${dir}`;
  }

  function onGlobePointerMove(ev) {
    if (!globe.projection || !globe.svg) return;
    const svgEl = ev.currentTarget;
    const rect = svgEl.getBoundingClientRect();
    // Map client → viewBox coords
    const vx = (ev.clientX - rect.left) * (globe.width / rect.width);
    const vy = (ev.clientY - rect.top) * (globe.height / rect.height);
    const inv = globe.projection.invert([vx, vy]);
    const hud = $("#geo-cursor-coord");
    if (inv && hud) {
      const [lng, lat] = inv;
      hud.innerHTML = `<strong>LAT</strong> ${formatCoord(lat, "lat")} · <strong>LNG</strong> ${formatCoord(lng, "lng")}`;
    }
    // Country-name tooltip positioning (the hover class is added by country mouseenter)
    const tip = $("#geo-country-tip");
    if (tip && tip.classList.contains("show")) {
      const mapEl = svgEl.closest(".geo-map");
      if (mapEl) {
        const mapRect = mapEl.getBoundingClientRect();
        tip.style.left = (ev.clientX - mapRect.left) + "px";
        tip.style.top  = (ev.clientY - mapRect.top) + "px";
      }
    }
  }
  function onGlobePointerLeave() {
    const hud = $("#geo-cursor-coord");
    if (hud) hud.innerHTML = "LAT — · LNG —";
    const tip = $("#geo-country-tip");
    if (tip) tip.classList.remove("show");
  }

  function updateToggleLabel() {
    const btn = $("#globe-toggle"); if (!btn) return;
    btn.textContent = globe.autoRotate ? "PAUSE" : "PLAY";
  }

  function renderGlobeFrame() {
    if (!globe.path) return;
    const svg = globe.svg;
    svg.select(".globe-ocean").attr("d", globe.path);
    svg.select(".globe-graticule").attr("d", globe.path);
    svg.select(".globe-sphere").attr("d", globe.path);
    svg.select("#globe-countries-layer").selectAll("path").attr("d", globe.path);
    // Great-circle arcs follow the rotation too
    svg.select("#globe-arcs-layer").selectAll("path.risk-arc")
      .attr("d", (d) => globe.path({ type: "LineString", coordinates: [d.from, d.to] }));
    updateRiskPins();
    if (state.activePopupRisk) repositionFlashpointPopup();
  }

  function drawGlobe() {
    if (!globe.svg) return;
    // Countries — append-once with hover bindings, then refresh path data.
    const g = globe.svg.select("#globe-countries-layer");
    if (state.world) {
      const sel = g.selectAll("path").data(state.world.features);
      const enter = sel.enter().append("path").attr("class", "globe-country");
      enter.on("mouseenter", function (ev, d) {
        d3.select(this).classed("is-hover", true);
        const name = d.properties?.name;
        const tip = $("#geo-country-tip");
        if (tip && name) {
          tip.textContent = name;
          tip.classList.add("show");
        }
      });
      enter.on("mouseleave", function () {
        d3.select(this).classed("is-hover", false);
        const tip = $("#geo-country-tip");
        if (tip) tip.classList.remove("show");
      });
      enter.merge(sel).attr("d", globe.path);
      sel.exit().remove();
    }
    drawArcs();
    updateRiskPins();
  }

  // Connect flashpoints with animated great-circle arcs. Each pair with at
  // least one non-low severity gets wired up; color keyed to max severity.
  function drawArcs() {
    if (!globe.svg) return;
    const risks = filteredRisks();
    const sevRank = { high: 3, medium: 2, low: 1 };
    const pairs = [];
    for (let i = 0; i < risks.length; i++) {
      for (let j = i + 1; j < risks.length; j++) {
        const a = risks[i], b = risks[j];
        if (a.severity === "low" && b.severity === "low") continue;
        const maxSev = sevRank[a.severity] >= sevRank[b.severity] ? a.severity : b.severity;
        pairs.push({
          from: [Number(a.lng), Number(a.lat)],
          to:   [Number(b.lng), Number(b.lat)],
          severity: maxSev,
          key: `${i}-${j}`,
        });
      }
    }
    const layer = globe.svg.select("#globe-arcs-layer");
    const sel = layer.selectAll("path.risk-arc").data(pairs, (d) => d.key);
    sel.exit().remove();
    sel.enter().append("path")
      .attr("class", (d) => `risk-arc arc-${d.severity}`)
      .merge(sel)
      .attr("class", (d) => `risk-arc arc-${d.severity}`)
      .attr("d", (d) => globe.path({ type: "LineString", coordinates: [d.from, d.to] }));
  }

  function filteredRisks() {
    const all = state.geo?.risks || [];
    if (!state.geoFilter || state.geoFilter === "all") return all;
    return all.filter((r) => r.severity === state.geoFilter);
  }

  function updateRiskPins() {
    const risks = filteredRisks();
    const allRisks = state.geo?.risks || [];
    const g = globe.svg.select("#globe-risks-layer");
    const pins = g.selectAll("g.risk-pin").data(risks, (d) => `${d.region}|${d.title}`);
    pins.exit().remove();

    const enter = pins.enter().append("g").attr("class", "risk-pin");
    enter.append("circle").attr("class", "risk-pin-halo");
    enter.append("circle").attr("class", "risk-pin-ring");
    enter.append("circle").attr("class", "risk-pin-core");
    enter.append("circle").attr("class", "risk-pin-inner");

    const all = enter.merge(pins);
    const colors = { high: "#F14A3E", medium: "#E5A33A", low: "#30D37A" };

    all.each(function (d, i) {
      const sel = d3.select(this);
      const p = globe.projection([Number(d.lng), Number(d.lat)]);
      if (!p) { sel.style("display", "none"); return; }
      const center = [-globe.rotation[0], -globe.rotation[1]];
      const geoDist = d3.geoDistance([Number(d.lng), Number(d.lat)], center);
      const visible = geoDist <= Math.PI / 2 + 0.02;
      sel.style("display", visible ? null : "none");
      sel.attr("transform", `translate(${p[0]},${p[1]})`);
      const col = colors[d.severity] || colors.medium;
      // Halo for high-severity stands out from the regular ring animation.
      sel.select(".risk-pin-halo")
        .attr("fill", "none")
        .attr("stroke", col)
        .attr("stroke-width", d.severity === "high" ? 1.4 : 0.8)
        .attr("opacity", d.severity === "high" ? 0.35 : 0.18)
        .attr("r", d.severity === "high" ? 14 : 10);
      sel.select(".risk-pin-ring")
        .attr("stroke", col)
        .style("animation-delay", (i * 0.22) + "s");
      sel.select(".risk-pin-core")
        .attr("r", d.severity === "high" ? 7 : 6)
        .attr("fill", col)
        .style("filter", d.severity === "high" ? "drop-shadow(0 0 8px " + col + ")" : null);
      sel.select(".risk-pin-inner").attr("r", 2.4).attr("fill", "#07090D");
      const idxInAll = allRisks.indexOf(d);
      sel.on("click", (ev) => { ev.stopPropagation(); focusRisk(idxInAll); });
      sel.select("title").remove();
      sel.append("title").text(`${d.title} — ${d.region}`);
    });
  }

  function focusRisk(idx) {
    const r = state.geo?.risks?.[idx];
    if (!r) return;
    $("#active-risk-title").textContent = r.title;
    $$(".risk-card").forEach((c) => c.classList.remove("is-selected"));
    const card = $(`.risk-card[data-idx="${idx}"]`);
    if (card) { card.classList.add("is-selected"); card.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
    // Rotate globe to center on the flashpoint
    globe.autoRotate = false;
    updateToggleLabel();
    hideFlashpointPopup();
    const target = [-Number(r.lng), -Number(r.lat), 0];
    const start = globe.rotation.slice();
    const dur = 900;
    const t0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / dur);
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      globe.rotation = start.map((s, i) => s + (target[i] - s) * ease);
      globe.projection.rotate(globe.rotation);
      renderGlobeFrame();
      if (t < 1) requestAnimationFrame(step);
      else showFlashpointPopup(r);
    };
    requestAnimationFrame(step);
  }

  // --- Flashpoint popup (anchored to the pin on the globe) ----------------
  function showFlashpointPopup(risk) {
    const popup = $("#flashpoint-popup");
    if (!popup || !risk) return;
    const coords = `${formatCoord(Number(risk.lat), "lat")} · ${formatCoord(Number(risk.lng), "lng")}`;
    popup.className = `flashpoint-popup show sev-${esc(risk.severity)}`;
    popup.innerHTML = `
      <button class="flashpoint-popup-close" aria-label="Close">×</button>
      <div class="flashpoint-popup-tag"><span class="tag-dot"></span>${esc(risk.region)} · ${esc(risk.severity).toUpperCase()}</div>
      <div class="flashpoint-popup-title">${esc(risk.title)}</div>
      <div class="flashpoint-popup-desc">${esc(risk.desc)}</div>
      <div class="flashpoint-popup-impact"><strong>${esc(risk.impact)}</strong></div>
      <div class="flashpoint-popup-coords">${coords}</div>
    `;
    popup.querySelector(".flashpoint-popup-close").addEventListener("click", (ev) => {
      ev.stopPropagation();
      hideFlashpointPopup();
    });
    state.activePopupRisk = risk;
    repositionFlashpointPopup();
  }
  function hideFlashpointPopup() {
    const popup = $("#flashpoint-popup");
    if (popup) popup.classList.remove("show");
    state.activePopupRisk = null;
  }
  function repositionFlashpointPopup() {
    const risk = state.activePopupRisk;
    const popup = $("#flashpoint-popup");
    const svgEl = $("#globe-svg");
    if (!risk || !popup || !svgEl || !globe.projection) return;
    const coord = [Number(risk.lng), Number(risk.lat)];
    // Hide if the pin is past the visible hemisphere
    const center = [-globe.rotation[0], -globe.rotation[1]];
    const dist = d3.geoDistance(coord, center);
    if (dist > Math.PI / 2 - 0.05) {
      popup.classList.remove("show");
      return;
    } else if (!popup.classList.contains("show")) {
      popup.classList.add("show");
    }
    const p = globe.projection(coord);
    if (!p) return;
    const mapEl = svgEl.closest(".geo-map");
    if (!mapEl) return;
    const svgRect = svgEl.getBoundingClientRect();
    const mapRect = mapEl.getBoundingClientRect();
    const scale = svgRect.width / globe.width;
    const x = (svgRect.left - mapRect.left) + p[0] * scale;
    const y = (svgRect.top - mapRect.top) + p[1] * scale;
    popup.style.left = x + "px";
    popup.style.top  = y + "px";
  }

  // --- Metrics strip (risk index + severity counts) -----------------------
  function renderGeoMetrics() {
    if (!state.geo) return;
    const risks = state.geo.risks || [];
    const hi  = risks.filter((r) => r.severity === "high").length;
    const med = risks.filter((r) => r.severity === "medium").length;
    const low = risks.filter((r) => r.severity === "low").length;
    // Weighted index caps at 100.
    const idx = Math.min(100, hi * 22 + med * 11 + low * 4);
    const label =
      idx >= 75 ? "CRITICAL"  :
      idx >= 45 ? "ELEVATED"  :
      idx >= 20 ? "GUARDED"   :
                  "CONTAINED";
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set("#metric-index", idx);
    set("#metric-index-sub", label);
    const fill = $("#metric-index-fill");
    if (fill) fill.style.width = idx + "%";
    set("#metric-high", hi);
    set("#metric-med",  med);
    set("#metric-low",  low);
  }

  // --- Live-wire ticker above the globe -----------------------------------
  function buildTicker() {
    const track = $("#geo-ticker-track");
    if (!track) return;
    const geoTopics = new Set([
      "Conflict", "China / Taiwan", "Oil / Energy",
      "Policy / Tariffs", "Global Central Bank", "Fed / FOMC", "Inflation",
    ]);
    let pool = state.news.filter((n) => (n.topics || []).some((t) => geoTopics.has(t)));
    if (pool.length < 6) pool = state.news.slice(0, 12);
    pool = pool.slice(0, 14);
    const item = (n) => {
      const region = (n.topics && n.topics[0]) || n.source;
      return `<span class="geo-ticker-item">
        <span class="geo-ticker-region">${esc(region)}</span>
        <a href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>
        <span class="geo-ticker-sep">◆</span>
      </span>`;
    };
    const html = pool.map(item).join("");
    // Duplicate the track content so the CSS -50% translate loops seamlessly
    track.innerHTML = html + html;
  }

  // Severity filter chip wiring — applied when the globe layer is interactive.
  $$(".geo-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.geoFilter = btn.dataset.sev || "all";
      $$(".geo-chip").forEach((b) => b.classList.toggle("active", b === btn));
      hideFlashpointPopup();
      renderGeopolitical();
      if (globe.initialized) drawGlobe();
    });
  });

  // Minimal versor helpers (from d3/versor) — bundled inline so we avoid an extra CDN hop.
  const versor = (e) => {
    const [l, p, g] = e.map((x) => x * Math.PI / 360);
    const sl = Math.sin(l), cl = Math.cos(l);
    const sp = Math.sin(p), cp = Math.cos(p);
    const sg = Math.sin(g), cg = Math.cos(g);
    return [
      cl * cp * cg + sl * sp * sg,
      sl * cp * cg - cl * sp * sg,
      cl * sp * cg + sl * cp * sg,
      cl * cp * sg - sl * sp * cg,
    ];
  };
  versor.cartesian = (e) => {
    const l = e[0] * Math.PI / 180, p = e[1] * Math.PI / 180, cp = Math.cos(p);
    return [cp * Math.cos(l), cp * Math.sin(l), Math.sin(p)];
  };
  versor.rotation = (q) => [
    Math.atan2(2 * (q[0] * q[1] + q[2] * q[3]), 1 - 2 * (q[1] * q[1] + q[2] * q[2])) * 180 / Math.PI,
    Math.asin(Math.max(-1, Math.min(1, 2 * (q[0] * q[2] - q[3] * q[1])))) * 180 / Math.PI,
    Math.atan2(2 * (q[0] * q[3] + q[1] * q[2]), 1 - 2 * (q[2] * q[2] + q[3] * q[3])) * 180 / Math.PI,
  ];
  versor.delta = (v0, v1, a) => {
    a = a == null ? 1 : a;
    const w = cross(v0, v1), l = Math.sqrt(dot(w, w));
    if (!l) return [1, 0, 0, 0];
    const t = Math.acos(Math.max(-1, Math.min(1, dot(v0, v1)))) * (a || 1) / 2;
    const s = Math.sin(t);
    return [Math.cos(t), w[2] / l * s, -w[1] / l * s, w[0] / l * s];
  };
  versor.multiply = (a, b) => [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
  const dot = (a, b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];

  // ---- Render: Geopolitical sidebar + matrix ---------------------------
  function renderGeopolitical() {
    const host = $("#geo-risks");
    const matrix = $("#impact-matrix");
    const countLive = $("#geo-count-live");

    if (!state.geo) {
      host.innerHTML = `<div class="card"><div class="loading-dots"><span></span><span></span><span></span></div><span style="margin-left:10px;color:var(--ink-mute);font-size:13px">Acquiring intelligence feed…</span></div>`;
      matrix.innerHTML = `<div style="color:var(--ink-mute)">Awaiting briefing…</div>`;
      countLive.textContent = "—";
      return;
    }

    renderGeoMetrics();

    const allRisks = state.geo.risks || [];
    const visible = filteredRisks();
    const ordered = [...visible].sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]));
    const hi = visible.filter((r) => r.severity === "high").length;
    const med = visible.filter((r) => r.severity === "medium").length;
    countLive.textContent = `${hi} HI · ${med} MED · ${visible.length} TOTAL`;

    host.innerHTML = ordered.length ? ordered.map((r) => {
      const idx = allRisks.indexOf(r);
      const badge = r.severity === "high" ? "badge-bear" : r.severity === "medium" ? "badge-amber" : "badge-bull";
      return `<div class="risk-card ${esc(r.severity)}" data-idx="${idx}">
          <div class="risk-region">${esc(r.region)}</div>
          <div class="risk-head">
            <div class="risk-title">${esc(r.title)}</div>
            <span class="badge ${badge}">${esc(r.severity)}</span>
          </div>
          <div class="risk-desc">${esc(r.desc)}</div>
          <div class="risk-impact">
            <span>Asset Impact</span>
            <span>${esc(r.impact)}</span>
          </div>
        </div>`;
    }).join("") : `<div class="card" style="color:var(--ink-mute);text-align:center">No flashpoints match this filter.</div>`;

    const matrixRows = state.geo.matrix || [];
    matrix.innerHTML = matrixRows.length
      ? matrixRows.map((r) => {
          const badge = r.tone === "bull" ? "badge-bull" : r.tone === "bear" ? "badge-bear" : r.tone === "amber" ? "badge-amber" : "badge-neutral";
          return `<div class="matrix-row">
              <div>${esc(r.asset)}</div>
              <div>${esc(r.read)}</div>
              <div><span class="badge ${badge}">${esc(r.tone)}</span></div>
            </div>`;
        }).join("")
      : `<div style="color:var(--ink-mute)">No matrix available.</div>`;

    $$(".risk-card").forEach((c) => c.addEventListener("click", () => focusRisk(Number(c.dataset.idx))));
    if (globe.initialized) updateRiskPins();
  }

  // ---- Orchestration ---------------------------------------------------
  async function refresh(initial = false) {
    const btn = $("#refresh-btn"); btn.classList.add("spinning");

    await Promise.allSettled([
      fetchNews()
        .then((d) => { state.news = d.items; renderNews(); buildTicker(); })
        .catch((e) => {
          console.warn("News", e);
          if (state.news.length === 0) { const f = $("#tw-feed"); if (f) f.innerHTML = `<div class="tw-empty">News feeds are temporarily unavailable. Retrying in 5 minutes.</div>`; }
        }),
    ]);

    // Geopolitical — use Claude if keyed, else show cached briefing.
    if (CFG.CLAUDE_API_KEY) {
      if (!state.geo) renderGeopolitical();
      try {
        const geo = await fetchGeopolitical(state.news);
        if (geo) state.geo = geo;
      } catch (e) {
        console.warn("Geo AI", e);
        toast("Claude briefing failed — showing cached");
        if (!state.geo) state.geo = CACHED_GEO;
      }
    } else {
      state.geo = CACHED_GEO;
    }
    renderGeopolitical();
    if (globe.initialized) drawGlobe();

    state.updated = new Date();
    applyMood();
    $("#last-updated").textContent = `Updated ${fmtDateTime(state.updated)}`;

    btn.classList.remove("spinning");
  }

  $("#refresh-btn").addEventListener("click", () => refresh(false));

  // Initial load + auto-refresh
  refresh(true);
  setInterval(() => refresh(false), CFG.REFRESH_MS);

  // Pre-init the globe if geopolitical is the starting tab
  if (document.body.classList.contains("situation-room")) ensureGlobe();

})();
