/* Shared by every page on the site: PEEN accounts, sticker sign-in, and
   calls to the Supabase backend. Pages work without it (offline = guest).

   Signing in:
   - A sticker opens tap.samdw.ca/?t=<tag>. If the sticker is linked to an
     account, the tag-login Edge Function returns a one-time token and this
     file turns it into a session. If it isn't linked yet, the tag is kept as
     "pending" and claimed for whoever signs in next with an email code.
   - The session lives in cookies shared across *.samdw.ca, so Robotomy and
     the games see the same login. Same format as Robotomy's
     src/lib/peenStorage.js; keep the two in step. */
(function () {
  'use strict';
  const script = document.currentScript;
  const root = new URL('.', script ? script.src : location.href).href; // site root URL
  const PENDING_KEY = 'peen.pendingTag';
  const TAG_RE = /^[a-z0-9]{4,32}$/;
  const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/dist/umd/supabase.js';

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } },
  };

  // ---------- Session storage shared across *.samdw.ca ----------
  const PARENT = 'samdw.ca';
  const onPeenDomain = location.hostname === PARENT || location.hostname.endsWith('.' + PARENT);
  const CHUNK = 3000, MAX_CHUNKS = 10, YEAR = 60 * 60 * 24 * 365;
  const readCookie = (name) => {
    const hit = document.cookie.split('; ').find((c) => c.startsWith(name + '='));
    return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
  };
  const writeCookie = (name, value, maxAge) => {
    document.cookie = `${name}=${encodeURIComponent(value)}; Domain=.${PARENT}; Path=/; Max-Age=${maxAge}; SameSite=Lax; Secure`;
  };
  const cookieStorage = {
    getItem(key) {
      const n = Number(readCookie(`${key}.n`) || 0);
      if (!n) return null;
      let out = '';
      for (let i = 0; i < n; i++) { const p = readCookie(`${key}.${i}`); if (p == null) return null; out += p; }
      return out;
    },
    setItem(key, value) {
      const parts = [];
      for (let i = 0; i < value.length; i += CHUNK) parts.push(value.slice(i, i + CHUNK));
      parts.forEach((p, i) => writeCookie(`${key}.${i}`, p, YEAR));
      for (let i = parts.length; i < MAX_CHUNKS; i++) if (readCookie(`${key}.${i}`) != null) writeCookie(`${key}.${i}`, '', 0);
      writeCookie(`${key}.n`, String(parts.length), YEAR);
    },
    removeItem(key) {
      for (let i = 0; i < MAX_CHUNKS; i++) writeCookie(`${key}.${i}`, '', 0);
      writeCookie(`${key}.n`, '', 0);
    },
  };
  const authStorage = onPeenDomain
    ? { storage: cookieStorage, storageKey: 'peen-auth' }
    : { storage: { getItem: store.get, setItem: store.set, removeItem: (k) => store.set(k, null) }, storageKey: 'peen-auth' };

  // ---------- Sticker in the URL ----------
  // Picked up, then stripped from the address bar so a shared link never
  // carries someone's sticker.
  const params = new URLSearchParams(location.search);
  const fromUrl = (params.get('t') || '').toLowerCase();
  const tapped = TAG_RE.test(fromUrl) ? fromUrl : null;
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

  const loadLib = () => new Promise((resolve, reject) => {
    if (window.supabase && window.supabase.createClient) return resolve(window.supabase);
    const s = document.createElement('script');
    s.src = SUPABASE_JS; s.async = true;
    s.onload = () => resolve(window.supabase);
    s.onerror = () => reject(new Error('offline'));
    document.head.appendChild(s);
  });

  const client = backend.then(async (sb) => {
    if (!sb) return null;
    try {
      const lib = await loadLib();
      return lib.createClient(sb.url, sb.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, ...authStorage },
      });
    } catch { return null; }
  });

  // What the tap did: 'signed-in', 'unlinked' (needs an email code to claim),
  // 'off' (turned off), or null (no tap / offline).
  let tapResult = null;

  async function claimPending(c) {
    const tag = store.get(PENDING_KEY);
    if (!tag) return;
    try {
      const { data } = await c.rpc('claim_tag', { p_tag: tag });
      if (data && (data.ok || data.error)) store.set(PENDING_KEY, null);
    } catch { /* try again next load */ }
  }

  // Settles once any sticker in the URL has been handled.
  const ready = client.then(async (c) => {
    if (!c) return null;
    const sb = await backend;
    if (tapped) {
      try {
        const res = await fetch(`${sb.url.replace(/\/$/, '')}/functions/v1/tag-login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: sb.key, Authorization: 'Bearer ' + sb.key },
          body: JSON.stringify({ tag: tapped }),
        });
        const r = await res.json();
        if (r.token_hash) {
          const { error } = await c.auth.verifyOtp({ token_hash: r.token_hash, type: 'email' });
          tapResult = error ? null : 'signed-in';
        } else if (r.unlinked) {
          store.set(PENDING_KEY, tapped);
          tapResult = 'unlinked';
        } else if (/turned off/.test(r.error || '')) {
          tapResult = 'off';
        }
      } catch { /* offline: carry on as whoever is signed in */ }
    }
    const { data } = await c.auth.getSession();
    if (data.session) await claimPending(c);
    return c;
  });

  async function rpc(fn, args, timeoutMs = 8000) {
    const c = await ready;
    if (!c) throw new Error('offline');
    const timer = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs));
    const { data, error } = await Promise.race([c.rpc(fn, args || {}), timer]);
    if (error) throw new Error(error.code === 'PGRST202' ? 'HTTP 404' : error.message);
    return data;
  }

  async function session() {
    const c = await ready;
    if (!c) return null;
    const { data } = await c.auth.getSession();
    return data.session;
  }

  // Email code sign-in (same flow as Robotomy).
  async function sendCode(email) {
    const c = await ready; if (!c) return 'Offline. Try again in a moment.';
    const { error } = await c.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    return error ? error.message : null;
  }
  async function verifyCode(email, code) {
    const c = await ready; if (!c) return 'Offline. Try again in a moment.';
    const { error } = await c.auth.verifyOtp({ email: email.trim(), token: code.replace(/\D/g, ''), type: 'email' });
    if (error) return error.message;
    await claimPending(c);
    return null;
  }
  async function signOut() {
    const c = await ready; if (c) await c.auth.signOut();
  }

  // Attachment for Request / submit: goes to the private peen-submissions
  // bucket under a random folder. Uploads only; nobody can read it back
  // except Sam's inbox.
  async function upload(file) {
    const c = await ready; if (!c) throw new Error('offline');
    const safe = (file.name || 'file').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-100) || 'file';
    const path = `${crypto.randomUUID()}/${safe}`;
    const { error } = await c.storage.from('peen-submissions').upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (error) throw new Error(error.message);
    return { path, name: file.name || safe, type: file.type || '', size: file.size };
  }

  // "powered by PEEN-IS" on every page: any element with data-peen-footer.
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-peen-footer]').forEach((el) => { el.innerHTML = 'powered by PEEN-<em>IS</em>'; });
  });

  window.Samdw = {
    root,
    config,
    online: ready.then(Boolean),
    ready,
    get tapResult() { return tapResult; },
    get pendingTag() { return store.get(PENDING_KEY); },
    session,
    sendCode,
    verifyCode,
    signOut,
    rpc,
    upload,
  };
})();
