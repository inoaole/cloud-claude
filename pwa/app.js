// cloud-claude PWA shell — Sprint 0.
// Registers the service worker and shows hub health. Real screens land in later sprints.
(() => {
  'use strict';

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('[pwa] sw registration failed', err);
      });
    });
  }

  // Sprint 0 liveness: confirm the hub is up (no auth yet).
  fetch('/healthz')
    .then((r) => r.json())
    .then((h) => {
      const chip = document.getElementById('deviceChip');
      if (chip) chip.textContent = h && h.ok ? `hub ● v${h.version}` : 'hub ○';
    })
    .catch(() => {
      const chip = document.getElementById('deviceChip');
      if (chip) chip.textContent = 'hub ○';
    });
})();
