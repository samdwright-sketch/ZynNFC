# Snuske

A tiny mobile browser game: steer a dude around with a touch joystick, eat snus pouches, get longer, and don't bite yourself or hit the walls. Built to load fast from an NFC tag tap.

## How it plays

- **Steer:** drag anywhere on the screen (floating joystick). Arrow keys or WASD work on desktop.
- **Pouches:** +1 point and a bit longer each. He speeds up slightly as you go.
- **Gold pouch:** shows up every 7 pouches, worth +5, disappears after ~6 seconds.
- **Game over:** hitting a wall or your own body.
- Best score is saved on the device. Sound toggle and pause are in the top bar; the game auto-pauses if you switch apps.

## Files

| File | What it is |
| --- | --- |
| `index.html` | Page, menus, and styles |
| `game.js` | All game logic and drawing (no libraries, no build step) |
| `manifest.webmanifest`, `icon*.png`, `icon.svg` | Home-screen icon and "Add to Home Screen" support |

Total size is under 100 KB, so it opens almost instantly after an NFC tap.

## Run locally

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Hosting (GitHub Pages)

Live URL: **https://samdwright-sketch.github.io/ZynNFC/**

`.github/workflows/pages.yml` publishes the game on every push to `main` (and the current dev branch). One-time setup:

1. **Settings → General → Danger Zone → Change visibility → Public** (Pages on a free plan needs a public repo).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. **Actions tab → "Deploy Snuske to GitHub Pages" → Run workflow** (or just push a commit).

After that, every push redeploys automatically. It's a plain static site, so any other static host also works with no build command.

## NFC tags

1. Get NTAG213 or NTAG215 stickers (NTAG213 holds ~130 characters, plenty for a URL).
2. Install **NFC Tools** (iOS or Android).
3. Write → Add a record → **URL/URI** → paste the game URL → Write, then hold the phone to the sticker.
4. Optional: in NFC Tools, use **Other → Lock tag** so nobody can overwrite it. Locking is permanent, so test first.

Tips:

- Use the shortest URL you can (a custom domain or short link) so it fits easily and you can change where it points later.
- Point the tag at a URL you control. If you ever move hosting, you update the redirect instead of re-writing every sticker.
- Metal surfaces block NFC. On a metal lid, use **on-metal (anti-metal) NFC stickers**. Plastic lids are fine with normal ones.
