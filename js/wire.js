// 24/7 News Wire — FastBull-style live headline feed.
// Polls /api/wire every 10s; new items animate in at the top.
(() => {
  const feed = document.getElementById('wire-feed');
  if (!feed) return;

  const countEl = document.getElementById('wire-count');
  const updatedEl = document.getElementById('wire-updated');
  const dateEl = document.getElementById('wire-date');

  const state = { items: [], filter: 'all', highOnly: false, seen: new Set(), timer: null };

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const fmtClock = (ms) => {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    const h = d.getHours();
    const h12 = h % 12 || 12;
    const ampm = h < 12 ? 'AM' : 'PM';
    return `${p(h12)}:${p(d.getMinutes())}:${p(d.getSeconds())} ${ampm}`;
  };

  const fmtDateLong = (ms) =>
    new Date(ms).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
  const dayKey = (ms) => new Date(ms).toDateString();

  function render() {
    // A headline shows colour only when it is high-impact AND directional.
    const isColored = (it) => it.impact === 'high' && it.sentiment !== 'neutral';
    const today = dayKey(Date.now());
    const items = state.items.filter(
      (it) =>
        dayKey(it.time) === today &&
        (state.filter === 'all' || it.sentiment === state.filter) &&
        (!state.highOnly || isColored(it))
    );
    if (!items.length) {
      feed.innerHTML = `<div class="wire-empty">No ${
        state.filter === 'all' ? '' : state.filter + ' '
      }headlines on the wire yet.</div>`;
    } else {
      feed.innerHTML = items
        .map((it) => {
          const tone =
            it.impact === 'high' && it.sentiment === 'bullish'
              ? 'bull'
              : it.impact === 'high' && it.sentiment === 'bearish'
              ? 'bear'
              : 'flat';
          const fresh = state.seen.has(it.headline) ? '' : ' wire-item--new';
          const sent =
            it.sentiment === 'bullish'
              ? '<span class="wire-sent wire-sent--bull">BULL</span>'
              : it.sentiment === 'bearish'
              ? '<span class="wire-sent wire-sent--bear">BEAR</span>'
              : '<span class="wire-sent wire-sent--flat">—</span>';
          return `<a class="wire-item wire-item--${tone}${fresh}" href="${esc(
            it.url
          )}" target="_blank" rel="noopener">
            <span class="wire-time">${fmtClock(it.time)}</span>
            <span class="wire-headline">${esc(it.headline)}</span>
            ${sent}
            <span class="wire-source">${esc(it.source)}</span>
          </a>`;
        })
        .join('');
    }
    state.items.forEach((it) => state.seen.add(it.headline));
    if (countEl) countEl.textContent = String(items.length);
  }

  function skeleton(n = 8) {
    const row = `
      <div class="wire-skel-row">
        <span class="skel" style="width:64px"></span>
        <span class="skel" style="flex:1;max-width:${55 + Math.round(Math.random() * 35)}%"></span>
        <span class="skel" style="width:70px"></span>
      </div>`;
    return Array.from({ length: n }, () => row).join('');
  }

  function showError() {
    feed.innerHTML = `
      <div class="data-error">
        <div class="data-error-ico">!</div>
        <div>
          <div class="data-error-title">Wire unavailable</div>
          <div>The 24/7 feed could not be reached. Auto-retry in 10s.</div>
        </div>
        <button class="data-error-retry" type="button">Retry now</button>
      </div>`;
    feed.querySelector('.data-error-retry').addEventListener('click', load);
  }

  async function load() {
    try {
      const r = await fetch('/api/wire', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      if (Array.isArray(data.items)) {
        state.items = data.items.sort((a, b) => b.time - a.time);
        render();
        if (updatedEl) {
          if (window.SignalDeck) window.SignalDeck.stamp(updatedEl, Date.now());
          else updatedEl.textContent = fmtClock(Date.now());
        }
      }
    } catch (e) {
      if (!state.items.length) showError();
    }
  }

  document.querySelectorAll('[data-wire-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document
        .querySelectorAll('[data-wire-filter]')
        .forEach((b) => b.classList.toggle('active', b === btn));
      state.filter = btn.dataset.wireFilter;
      render();
    });
  });

  const highBtn = document.querySelector('[data-wire-toggle="high"]');
  if (highBtn) {
    highBtn.addEventListener('click', () => {
      state.highOnly = !state.highOnly;
      highBtn.classList.toggle('active', state.highOnly);
      highBtn.setAttribute('aria-pressed', String(state.highOnly));
      render();
    });
  }

  function start() {
    if (state.timer) return;
    if (dateEl) dateEl.textContent = fmtDateLong(Date.now());
    feed.innerHTML = skeleton();
    load();
    state.timer = setInterval(load, 10000);
  }

  // Lazy-start when the 24/7 tab is first opened, then keep polling.
  const wireTabBtn = document.querySelector('.tab-btn[data-tab="wire"]');
  if (wireTabBtn) wireTabBtn.addEventListener('click', start);
  if ((location.hash || '').slice(1) === 'wire') start();
})();
