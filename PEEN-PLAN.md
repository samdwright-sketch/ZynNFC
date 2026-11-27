# PEEN plan

Friends app hub. Hosts Snuske and Robotomy, plus the features below.

Status key: `idea` (logged only, not scoped), `scoped`, `building`, `shipped`.

Repo note: this repo (currently ZynNFC) will probably be renamed PEEN.

## Hosted apps
- Snuske (`site/snuske/`, this repo)
- Robotomy (https://robotomy.vercel.app, separate repo)

## Feature backlog

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1 | "Dick Pics" page | idea | Page titled "dick pics" that is pictures of people named Richard. Needs a photo source and a way to add/curate entries. |
| 2 | User module for Quiz on Friends | idea | Accounts/profiles for the Quiz on Friends app. Decide whether to reuse the Supabase auth from Robotomy so one login works across the hub. |
| 3 | Friend submissions for Quiz on Friends | idea | Place for friends to submit questions/content. Likely needs a moderation or approval step before items go live. Depends on #2. |
| 4 | "Add to homescreen" guide | idea | Step-by-step guide for installing the hub as a PWA on iOS and Android. Pairs with NFC sticker flow. |
| 5 | "Open invitation" plans notice board | idea | Board where anyone can post an open plan others can join. Notifications for new posts and joins, if feasible (web push needs PWA install, see #4; iOS requires homescreen install for push). |

## Dependencies and open questions
- #3 depends on #2.
- #5 notifications depend on #4 (PWA install) and a push provider.
- Shared login across Snuske, Robotomy, and new modules: not decided.
- #1: consent. Photos of real people named Richard should come from friends who opted in, or be clearly public figures.
