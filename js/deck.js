// SIGNAL 2.0 — Command deck.
// Hero TRADE / CAUTION / AVOID verdict, CNN Fear & Greed gauge, and the
// economic calendar. Also owns the site-wide "updated Xs ago" ticker and
// the count-up number animation used across the deck.

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));

  const state = {
    mood: null,       // pushed from app.js via the signal:mood event
    fng: null,
    calendar: null,
    calError: false,
    fngError: false,
  };

  // ---- Live relative-time stamps ---------------------------------------
  // Any element with data-ts="<epoch ms>" gets its text refreshed every 10s.
  const relTime = (ms) => {
    const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (s < 5) return "just now";
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  };
  const stamp = (el, ms, prefix = "updated ") => {
    if (!el) return;
    el.dataset.ts = ms;
    el.dataset.prefix = prefix;
    el.textContent = prefix + relTime(ms);
  };
  setInterval(() => {
    document.querySelectorAll("[data-ts]").forEach((el) => {
      const ms = Number(el.dataset.ts);
      if (ms) el.textContent = (el.dataset.prefix || "") + relTime(ms);
    });
  }, 10_000);

  // ---- Count-up number animation ----------------------------------------
  const countUp = (el, target, { decimals = 0, duration = 900 } = {}) => {
    if (!el) return;
    const from = parseFloat(el.dataset.v || "0") || 0;
    const t0 = performance.now();
    el.dataset.v = target;
    const step = (now) => {
      const t = Math.min(1, (now - t0) / duration);
      const ease = 1 - Math.pow(1 - t, 3);
      const v = from + (target - from) * ease;
      el.textContent = v.toFixed(decimals);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  // ---- Shared error card --------------------------------------------------
  const errorHtml = (title, msg) => `
    <div class="data-error">
      <div class="data-error-ico">!</div>
      <div>
        <div class="data-error-title">${esc(title)}</div>
        <div>${esc(msg)}</div>
      </div>
      <button class="data-error-retry" type="button">Retry</button>
    </div>`;

  // =======================================================================
  // FEAR & GREED GAUGE
  // =======================================================================
  const FNG_BANDS = [
    { max: 25,  label: "Extreme fear",  color: "#F14A3E" },
    { max: 45,  label: "Fear",          color: "#ECA75C" },
    { max: 55,  label: "Neutral",       color: "#E5A33A" },
    { max: 75,  label: "Greed",         color: "#7BD9A4" },
    { max: 101, label: "Extreme greed", color: "#30D37A" },
  ];
  const fngBand = (v) => FNG_BANDS.findIndex((b) => v < b.max);

  // Arc helpers — gauge center (130,118), radius 100, sweep 180°.
  const polar = (cx, cy, r, deg) => {
    const rad = (deg - 180) * Math.PI / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  const arcPath = (a0, a1, r = 100, cx = 130, cy = 118) => {
    const [x0, y0] = polar(cx, cy, r, a0);
    const [x1, y1] = polar(cx, cy, r, a1);
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };

  function gaugeSvg() {
    // Five band segments with 2° gaps between them.
    const stops = [0, 25, 45, 55, 75, 100];
    const segs = FNG_BANDS.map((b, i) => {
      const a0 = stops[i] * 1.8 + (i === 0 ? 0 : 1);
      const a1 = stops[i + 1] * 1.8 - (i === FNG_BANDS.length - 1 ? 0 : 1);
      return `<path d="${arcPath(a0, a1)}" fill="none" stroke="${b.color}" stroke-width="14" stroke-linecap="butt" opacity="0.88"/>`;
    }).join("");
    // Minor ticks every 10 points.
    const ticks = [];
    for (let v = 10; v < 100; v += 10) {
      if (v % 25 === 0) continue;
      const [x0, y0] = polar(130, 118, 88, v * 1.8);
      const [x1, y1] = polar(130, 118, 82, v * 1.8);
      ticks.push(`<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="var(--line-strong)" stroke-width="1.4"/>`);
    }
    return `
      <svg class="fng-svg" viewBox="0 0 260 150" aria-hidden="true">
        <path d="${arcPath(0, 180)}" fill="none" stroke="var(--bg-alt)" stroke-width="14"/>
        ${segs}
        ${ticks.join("")}
        <g class="fng-needle-g" id="fng-needle">
          <!-- floating pointer: rides the arc, never crosses the value text -->
          <line x1="130" y1="62" x2="130" y2="36" stroke="var(--ink)" stroke-width="3" stroke-linecap="round"/>
          <circle cx="130" cy="36" r="3.4" fill="var(--ink)"/>
        </g>
      </svg>`;
  }

  function sparkSvg(hist, color) {
    if (!Array.isArray(hist) || hist.length < 2) return "";
    const w = 232, h = 36, pad = 2;
    const vals = hist.map((p) => p.v);
    const min = Math.min(...vals), max = Math.max(...vals);
    const range = max - min || 1;
    const stepX = (w - pad * 2) / (hist.length - 1);
    const pts = vals.map((v, i) => [pad + i * stepX, h - pad - ((v - min) / range) * (h - pad * 2)]);
    const d = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const [lx, ly] = pts[pts.length - 1];
    return `
      <div class="fng-spark">
        <div class="fng-spark-label">30-day trend</div>
        <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
          <path d="${d}" fill="none" stroke="var(--ink-mute)" stroke-width="1.6" stroke-linejoin="round"/>
          <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3" fill="${color}"/>
        </svg>
      </div>`;
  }

  function renderFng() {
    const body = $("#fng-body");
    if (!body) return;
    if (state.fngError && !state.fng) {
      body.innerHTML = errorHtml("Sentiment feed unavailable", "CNN Fear & Greed could not be reached.");
      body.querySelector(".data-error-retry").addEventListener("click", loadFng);
      return;
    }
    const f = state.fng;
    if (!f) return;
    const band = fngBand(f.score);
    const b = FNG_BANDS[band];
    body.innerHTML = `
      <div class="fng-gauge-wrap">
        ${gaugeSvg()}
        <div class="fng-center">
          <div class="fng-value" id="fng-value" data-v="0">0</div>
          <span class="fng-rating band-${band}">${esc(b.label)}</span>
        </div>
      </div>
      <div class="fng-legend"><span>EXTREME FEAR</span><span>NEUTRAL</span><span>EXTREME GREED</span></div>
      <div class="fng-history">
        ${[["Prev close", f.prevClose], ["1 week", f.week], ["1 month", f.month], ["1 year", f.year]].map(([l, v]) => `
          <div class="fng-hist-item">
            <div class="fng-hist-label">${l}</div>
            <div class="fng-hist-val" style="color:${FNG_BANDS[fngBand(v)].color}">${Math.round(v)}</div>
          </div>`).join("")}
      </div>
      ${sparkSvg(f.history, b.color)}`;
    countUp($("#fng-value"), Math.round(f.score));
    // Needle sweeps in from 0 for the satisfying settle animation.
    const needle = $("#fng-needle");
    requestAnimationFrame(() => requestAnimationFrame(() => {
      needle.style.transform = `rotate(${(-90 + f.score * 1.8).toFixed(1)}deg)`;
    }));
    stamp($("#fng-updated"), f.ts || Date.now());
  }

  async function loadFng() {
    try {
      const r = await fetch("/api/fng", { cache: "no-store" });
      if (!r.ok) throw new Error("fng " + r.status);
      const j = await r.json();
      if (j.score == null) throw new Error("fng empty");
      state.fng = j;
      state.fngError = false;
    } catch (e) {
      console.warn("FNG", e);
      state.fngError = true;
    }
    renderFng();
    renderHero();
  }

  // =======================================================================
  // ECONOMIC CALENDAR
  // =======================================================================
  const ET = "America/New_York";
  const etTime = (ms) => new Date(ms).toLocaleTimeString("en-US", { timeZone: ET, hour: "2-digit", minute: "2-digit", hour12: false });
  const etDayKey = (ms) => new Date(ms).toLocaleDateString("en-US", { timeZone: ET });
  const etDayLabel = (ms) => {
    const today = etDayKey(Date.now());
    const tomorrow = etDayKey(Date.now() + 86_400_000);
    const k = etDayKey(ms);
    if (k === today) return "Today";
    if (k === tomorrow) return "Tomorrow";
    return new Date(ms).toLocaleDateString("en-US", { timeZone: ET, weekday: "short", month: "short", day: "numeric" });
  };
  const untilTxt = (ms) => {
    const mins = Math.round((ms - Date.now()) / 60000);
    if (mins <= 0) return "now";
    if (mins < 60) return `in ${mins}m`;
    const h = Math.floor(mins / 60);
    return `in ${h}h ${mins % 60}m`;
  };

  function renderCalendar() {
    const body = $("#cal-body");
    if (!body) return;
    if (state.calError && !state.calendar) {
      body.innerHTML = errorHtml("Calendar unavailable", "Economic events could not be loaded.");
      body.querySelector(".data-error-retry").addEventListener("click", loadCalendar);
      return;
    }
    const items = state.calendar?.items;
    if (!items) return;
    const upcoming = items.filter((e) => e.time > Date.now() - 30 * 60000).slice(0, 12);
    if (!upcoming.length) {
      body.innerHTML = `<div class="cal-empty">No market-moving events in the next 72h.</div>`;
      return;
    }
    // First future medium/high event gets the live countdown.
    const nextIdx = upcoming.findIndex((e) => e.time > Date.now() && e.impact !== "low");
    let lastDay = null;
    const html = [];
    upcoming.forEach((e, i) => {
      const day = etDayLabel(e.time);
      if (day !== lastDay) { html.push(`<div class="cal-day">${esc(day)} · ET</div>`); lastDay = day; }
      const fx = [
        e.forecast ? `F <b>${esc(e.forecast)}</b>` : "",
        e.previous ? `P <b>${esc(e.previous)}</b>` : "",
      ].filter(Boolean).join(" · ");
      html.push(`
        <div class="cal-row imp-${esc(e.impact)}">
          <span class="cal-time">${etTime(e.time)}</span>
          <span class="cal-main">
            <span class="cal-name"><span class="cal-country">${esc(e.country)}</span>${esc(e.title)}</span>
            ${fx || i === nextIdx ? `<span class="cal-fx">${fx}${i === nextIdx ? `${fx ? " · " : ""}<span class="cal-next" data-next-ts="${e.time}">${untilTxt(e.time)}</span>` : ""}</span>` : ""}
          </span>
          <span class="cal-impact" title="${esc(e.impact)} impact"><i></i><i></i><i></i></span>
        </div>`);
    });
    body.innerHTML = html.join("");
    stamp($("#cal-updated"), state.calendar.ts || Date.now());
  }

  // Tick the "in Xm" countdown every 30s without a full re-render.
  setInterval(() => {
    document.querySelectorAll("[data-next-ts]").forEach((el) => {
      el.textContent = untilTxt(Number(el.dataset.nextTs));
    });
  }, 30_000);

  async function loadCalendar() {
    try {
      const r = await fetch("/api/calendar", { cache: "no-store" });
      if (!r.ok) throw new Error("calendar " + r.status);
      const j = await r.json();
      if (!Array.isArray(j.items)) throw new Error("calendar empty");
      state.calendar = j;
      state.calError = false;
    } catch (e) {
      console.warn("Calendar", e);
      state.calError = true;
    }
    renderCalendar();
    renderHero();
  }

  // =======================================================================
  // HERO VERDICT — TRADE / CAUTION / AVOID
  // =======================================================================
  function nextHighImpact(withinMin = 90) {
    const items = state.calendar?.items || [];
    return items.find((e) => e.impact === "high" && e.time > Date.now() && e.time - Date.now() < withinMin * 60000) || null;
  }

  function computeVerdict() {
    const m = state.mood;
    if (!m || !m.mood) return null;
    const reasons = [];
    let verdict = "TRADE";
    const escalate = (to) => {
      const rank = { TRADE: 0, CAUTION: 1, AVOID: 2 };
      if (rank[to] > rank[verdict]) verdict = to;
    };

    const total = (m.bull || 0) + (m.bear || 0);
    const bullPct = total ? Math.round((m.bull / total) * 100) : 50;
    const side = m.mood === "bull" ? "bull" : "bear";
    const sidePct = m.mood === "bull" ? bullPct : 100 - bullPct;

    if (m.shock) {
      escalate("AVOID");
      reasons.push({ t: "Shock headline on the wire", c: "bear" });
    }
    if (Math.abs(m.score) < 0.18) {
      escalate("CAUTION");
      reasons.push({ t: "Mixed tape — no clear edge", c: "amber" });
    } else {
      reasons.push({ t: `Tape ${sidePct}% ${side} · ${m.mood === "bull" ? "long" : "short"} bias`, c: side });
    }
    const ev = nextHighImpact();
    if (ev) {
      escalate("CAUTION");
      reasons.push({ t: `${ev.title} ${untilTxt(ev.time)}`, c: "amber" });
    }
    if (state.fng) {
      const s = state.fng.score;
      if (s <= 25 || s >= 75) {
        escalate("CAUTION");
        reasons.push({ t: `Sentiment ${FNG_BANDS[fngBand(s)].label.toLowerCase()} (${Math.round(s)})`, c: "amber" });
      } else {
        reasons.push({ t: `Sentiment ${FNG_BANDS[fngBand(s)].label.toLowerCase()} (${Math.round(s)})`, c: s >= 55 ? "bull" : s < 45 ? "bear" : "amber" });
      }
    }
    if (m.closed) {
      escalate("CAUTION");
      reasons.push({ t: "Globex closed — forecast read", c: "amber" });
    }

    const subs = {
      TRADE: `Conditions favor a position. Directional edge: <strong>${m.mood === "bull" ? "LONG" : "SHORT"} bias</strong> — ${side} pressure dominates the tape.`,
      CAUTION: `Tradeable, but respect the risk: <strong>size down, tight stops</strong>. ${m.mood === "bull" ? "Long" : "Short"} bias if forced to pick a side.`,
      AVOID: `Stand down. <strong>Headline shock risk</strong> — spreads widen and stops get run. Protect capital first.`,
    };
    return { verdict, sub: subs[verdict], reasons: reasons.slice(0, 4), bullPct };
  }

  let heroMemo = "";
  function renderHero() {
    const hero = $("#deck-hero");
    if (!hero) return;
    const v = computeVerdict();
    if (!v) return; // keep skeleton until the first mood arrives
    // Skip the full re-render (and animation restarts) when nothing changed —
    // just refresh the "updated" stamp so it keeps ticking truthfully.
    const memo = JSON.stringify(v);
    if (memo === heroMemo) {
      stamp($("#hero-updated"), Date.now());
      return;
    }
    heroMemo = memo;
    hero.className = `deck-hero v-${v.verdict.toLowerCase()}`;
    hero.innerHTML = `
      <div class="deck-hero-top">
        <span class="deck-hero-eyebrow"><span class="deck-live-dot"></span>Trade signal · live composite</span>
        <span class="deck-hero-updated" id="hero-updated"></span>
      </div>
      <div class="deck-verdict">${v.verdict}</div>
      <p class="deck-verdict-sub">${v.sub}</p>
      <div class="deck-pressure">
        <div class="deck-pressure-bar">
          <div class="deck-pressure-bull" style="width:0%"></div>
          <div class="deck-pressure-bear" style="width:0%"></div>
        </div>
        <div class="deck-pressure-legend">
          <span class="p-bull">BULL ${v.bullPct}%</span>
          <span class="p-bear">BEAR ${100 - v.bullPct}%</span>
        </div>
      </div>
      <div class="deck-why">
        ${v.reasons.map((r) => `<span class="deck-why-chip w-${esc(r.c)}">${esc(r.t)}</span>`).join("")}
      </div>`;
    stamp($("#hero-updated"), Date.now());
    // Animate the pressure meter to its value on the next frame.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      hero.querySelector(".deck-pressure-bull").style.width = v.bullPct + "%";
      hero.querySelector(".deck-pressure-bear").style.width = (100 - v.bullPct) + "%";
    }));
  }

  // Mood updates stream in from app.js.
  window.addEventListener("signal:mood", (ev) => {
    state.mood = ev.detail;
    renderHero();
  });

  // ---- Boot -------------------------------------------------------------
  // The news feed (main signal) loads first in app.js; the deck's secondary
  // fetches wait for idle so first paint stays fast.
  const boot = () => { loadFng(); loadCalendar(); };
  if ("requestIdleCallback" in window) requestIdleCallback(boot, { timeout: 2500 });
  else setTimeout(boot, 400);
  setInterval(loadFng, 10 * 60 * 1000);
  setInterval(loadCalendar, 15 * 60 * 1000);

  // Expose the stamp/countUp helpers for other modules (app.js feed foot).
  window.SignalDeck = { stamp, countUp, relTime };
})();
