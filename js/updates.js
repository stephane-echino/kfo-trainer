// Update handling.
//
// iOS standalone PWAs do not reliably pick up a new service worker via
// registration.update(), so the app asks the server directly: version.json is
// never served from cache (the SW skips it entirely), and applying an update
// unregisters every worker, deletes every cache and reloads with a fresh URL.
import { APP_VERSION } from './version.js';

const VERSION_FILE = './version.json';

export async function fetchVersionInfo() {
  const res = await fetch(`${VERSION_FILE}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`version.json: HTTP ${res.status}`);
  return res.json();
}

export function currentVersion() {
  return APP_VERSION.replace(/^v/, '');
}

export function isNewer(remote, local = currentVersion()) {
  const parse = (v) => String(v).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const [a, b] = [parse(remote), parse(local)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

export async function applyUpdate(version) {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch {
    /* clearing is best-effort — the cache-busting reload below still helps */
  }
  const url = `${location.pathname}?v=${encodeURIComponent(version || Date.now())}`;
  location.replace(url);
}
