// cloud-claude PWA shell — Sprint 1 (PIN unlock + gating).
(() => {
  'use strict';

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('[pwa] sw failed', err));
    });
  }

  const $ = (id) => document.getElementById(id);
  const unlock = $('unlock');
  const app = $('app');
  const tabbar = document.querySelector('.tabbar');
  const dots = $('pinDots');
  const sub = $('unlockSub');
  const MAX = 12;
  let pin = '';
  let busy = false;
  let lockTimer = null;

  function show(authed) {
    unlock.hidden = authed;
    app.hidden = !authed;
    tabbar.hidden = !authed;
    if (authed) loadHealth();
  }

  function renderDots() {
    const n = Math.max(pin.length, 4);
    let html = '';
    for (let i = 0; i < n; i += 1) html += `<i class="${i < pin.length ? 'f' : ''}"></i>`;
    dots.innerHTML = html;
  }

  function setSub(text, error) {
    sub.textContent = text;
    sub.classList.toggle('error', !!error);
  }

  async function submit() {
    if (busy || !pin) return;
    busy = true;
    try {
      const r = await fetch('/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      if (r.ok) {
        pin = '';
        renderDots();
        setSub('Enter PIN to unlock');
        show(true);
        return;
      }
      const j = await r.json().catch(() => ({}));
      pin = '';
      renderDots();
      if (r.status === 429 && j.retryAfter) startLockout(j.retryAfter);
      else if (r.status === 503) setSub('No PIN configured on the hub', true);
      else setSub('Wrong PIN', true);
    } catch {
      setSub('Hub unreachable', true);
    } finally {
      busy = false;
    }
  }

  function startLockout(seconds) {
    let left = seconds;
    if (lockTimer) clearInterval(lockTimer);
    const tick = () => {
      if (left <= 0) { clearInterval(lockTimer); lockTimer = null; setSub('Enter PIN to unlock'); return; }
      setSub(`Too many attempts — retry in ${left}s`, true);
      left -= 1;
    };
    tick();
    lockTimer = setInterval(tick, 1000);
  }

  function onKey(k) {
    if (lockTimer) return; // locked out
    if (k === 'del') pin = pin.slice(0, -1);
    else if (k === 'go') return submit();
    else if (/^\d$/.test(k) && pin.length < MAX) pin += k;
    renderDots();
  }

  document.getElementById('keypad').addEventListener('click', (e) => {
    const btn = e.target.closest('.key');
    if (btn) onKey(btn.dataset.k);
  });

  function loadHealth() {
    fetch('/healthz')
      .then((r) => r.json())
      .then((h) => { const c = $('deviceChip'); if (c) c.textContent = h && h.ok ? `hub ● v${h.version}` : 'hub ○'; })
      .catch(() => { const c = $('deviceChip'); if (c) c.textContent = 'hub ○'; });
  }

  // On load: already authenticated? show the app, else the unlock screen.
  renderDots();
  fetch('/auth/me')
    .then((r) => show(r.ok))
    .catch(() => show(false));
})();
