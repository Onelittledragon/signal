// 24/7 News Wire — FastBull-style live headline feed.
// Polls /api/wire every 10s; new items animate in at the top.
(() => {
  const feed = document.getElementById('wire-feed');
  if (!feed) return;

  const countEl = document.getElementById('wire-count');
  const updatedEl = document.getElementById('wire-updated');

  const state = { items: [], filter: 'all', seen: new Set(), timer: null };

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const fmtClock = (ms) => {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };

  function render() {
    const items = state.items.filter(
      (it) => state.filter === 'all' || it.sentiment === state.filter
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
          const fresh = state.seen.has(it.id) ? '' : ' wire-item--new';
          return `<a class="wire-item wire-item--${tone}${fresh}" href="${esc(
            it.url
          )}" target="_blank" rel="noopener">
            <span class="wire-time">${fmtClock(it.time)}</span>
            <span class="wire-headline">${esc(it.headline)}</span>
            <span class="wire-source">${esc(it.source)}</span>
          </a>`;
        })
        .join('');
    }
    state.items.forEach((it) => state.seen.add(it.id));
    if (countEl) countEl.textContent = String(items.length);
  }

  async function load() {
    try {
      const r = await fetch('/api/wire', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      if (Array.isArray(data.items)) {
        state.items = data.items.sort((a, b) => b.time - a.time);
        render();
        if (updatedEl) updatedEl.textContent = fmtClock(Date.now());
      }
    } catch (e) {
      if (!state.items.length) {
        feed.innerHTML = `<div class="wire-empty">Wire unavailable — retrying…</div>`;
      }
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

  function start() {
    if (state.timer) return;
    load();
    state.timer = setInterval(load, 10000);
  }

  // Lazy-start when the 24/7 tab is first opened, then keep polling.
  const wireTabBtn = document.querySelector('.tab-btn[data-tab="wire"]');
  if (wireTabBtn) wireTabBtn.addEventListener('click', start);
  if ((location.hash || '').slice(1) === 'wire') start();
})();
