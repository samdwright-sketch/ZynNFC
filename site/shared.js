/* Shared by every page on the site: remembers which NFC tag this phone tapped,
   loads config.json, and calls the Supabase backend. Pages work without it. */
(function () {
  'use strict';
  const script = document.currentScript;
  const root = new URL('.', script ? script.src : location.href).href; // site root URL
  const TAG_KEY = 'samdw.tag';
  const TAG_RE = /^[a-z0-9]{4,16}$/;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } },
  };

  // Pick up ?t=<tag> from the URL, remember it, and strip it from the address
  // bar so a shared link never carries someone's tag.
  let tag = null;
  const params = new URLSearchParams(location.search);
  const fromUrl = (params.get('t') || '').toLowerCase();
  if (TAG_RE.test(fromUrl)) {
    tag = fromUrl; store.set(TAG_KEY, tag);
  } else {
    const saved = store.get(TAG_KEY);
    tag = saved && TAG_RE.test(saved) ? saved : null;
  }
  if (params.has('t')) {
    params.delete('t');
    const qs = params.toString();
    try { history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash); } catch { /* ignore */ }
  }

  const config = fetch(root + 'config.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));

  const backend = config.then((c) => {
    const sb = c && c.supabase;
    return sb && sb.url && sb.key ? sb : null;
  });

  async function rpc(fn, args, timeoutMs = 8000) {
    const sb = await backend;
    if (!sb) throw new Error('offline');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${sb.url.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: sb.key, Authorization: 'Bearer ' + sb.key },
        body: JSON.stringify(args || {}),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  window.Samdw = {
    root,
    config,
    get tag() { return tag; },
    forgetTag() { tag = null; store.set(TAG_KEY, null); },
    online: backend.then(Boolean),
    rpc,
  };
})();
