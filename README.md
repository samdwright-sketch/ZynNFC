# tap.samdw.ca

NFC stickers point here. Each sticker has its own ID, so scores are logged under the name you gave that sticker. Today every tap opens **Snuske**; later you can send taps anywhere by editing one line.

## How it works

```
NFC sticker ──▶ https://tap.samdw.ca/?t=k3f9x2
                      │
                      ▼
        site/index.html (router) reads site/config.json → "go"
                      │
                      ▼
        site/snuske/  (game) remembers tag k3f9x2 on the phone,
                      shows "Playing as Sam", logs scores
                      │
                      ▼
        Supabase database: players (tag → name) + scores
```

- **Tag IDs** are 6 random characters with no look-alike letters (no 0/o/1/l/i).
- The tag is saved on the phone after the first tap and removed from the address bar, so shared links never carry it.
- Phones without a tag can still play as guests; they just aren't on the leaderboard.
- If the database is down or not set up, the game still works offline.

## Files

| Path | What it is |
| --- | --- |
| `site/index.html` | Router: stickers land here, it forwards to wherever `config.json` says |
| `site/config.json` | `go` (where taps land), `tapUrl` (base URL for stickers), Supabase URL and public key |
| `site/shared.js` | Remembers the tag, talks to the database (used by every page) |
| `site/snuske/` | The game |
| `site/admin/` | Tag admin: create, rename, delete tags; copy sticker URLs |
| `supabase/schema.sql` | Database tables and functions (run once in Supabase) |
| `.github/workflows/pages.yml` | Publishes `site/` to GitHub Pages on every push |
| `.github/workflows/keepalive.yml` | Pings the database 4 times a day so the free plan never pauses it |

## Changing where taps go

Edit `site/config.json` and push:

```json
{ "go": "snuske/" }                         // the game (default)
{ "go": "news/" }                           // another page in this repo
{ "go": "https://example.com/daily-game" }  // any external site
```

The tag is passed along only to pages on this site, never to external sites.

## Programming a sticker

1. Open **https://tap.samdw.ca/admin/** on your phone and unlock with your PIN.
2. Type the person's name, then tap **Create**. Tap **Copy URL**.
3. In **NFC Tools**: Write → Add a record → **URL/URI** → paste → Write, then hold the phone to the sticker.
4. Tap the sticker to test it. The game should say "Playing as (name)".
5. Optional: NFC Tools → Other → **Lock tag** so nobody can overwrite it. This is permanent.

The first time you open the admin page, it asks you to choose the PIN. 10 wrong PINs locks the admin page for 15 minutes.

## One-time setup

### 1. Database (Supabase, free)
1. Create a Supabase project (free plan).
2. SQL Editor → paste all of `supabase/schema.sql` → Run.
3. Project Settings → API Keys: copy the **Project URL** and the **publishable** key into `site/config.json` under `supabase`. Both are safe to be public; the database only allows the actions defined in `schema.sql`.

### 2. Domain (`samdw.ca` at Cloudflare)
1. Buy `samdw.ca` at dash.cloudflare.com → Domain Registration, and turn on auto-renew.
2. Cloudflare → `samdw.ca` → DNS → Add record:
   - Type **CNAME**, Name **tap**, Target **samdwright-sketch.github.io**, Proxy status **DNS only** (grey cloud).
3. GitHub repo → Settings → Pages → Custom domain → `tap.samdw.ca` → Save. When it's offered, tick **Enforce HTTPS**.
4. Recommended: GitHub account Settings → Pages → **Add a domain** → verify `samdw.ca` (stops anyone else from using it on GitHub).

`samdw.ca` itself stays free for anything else later.

### 3. GitHub Pages
Settings → Pages → Source: **GitHub Actions**. Every push to `main` (or the current dev branch) redeploys.

## Honest limits

- Anyone who reads a sticker with an NFC app can copy its URL and post scores as that person. This setup is fine for friends, but it isn't tamper-proof.
- Scores come from the phone, so a determined person could submit a fake one. The database rejects impossible values (over 5000) and spam (one score per 3 seconds per tag).

## Run locally

```bash
cd site && python3 -m http.server 8000   # then open http://localhost:8000
```
