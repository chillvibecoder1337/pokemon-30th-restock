# restock30pkmn checker

Personal, $0 monitor for Pokémon 30th and FIFA World Cup 2026. Shops: Cardland, AW2, TrueCollector, Bol.com, Amazon Nederland, Amazon België, and Panini België. GitHub Actions checks public stock every **10 minutes** on a **public** repo. GitHub Pages hosts the dashboard. ntfy.sh and Telegram ping only when an item flips from out of stock to in stock.

This is a monitor plus open-the-page helper, not a checkout bot.

## Phone setup

### ntfy (Android is snappiest; iOS works)

1. Install [ntfy](https://ntfy.sh/) from Play Store, F-Droid, or App Store.
2. Subscribe: [ntfy.sh/cardorca-30th-8lwo57sz9g1ikd0b](https://ntfy.sh/cardorca-30th-8lwo57sz9g1ikd0b). Anyone with that topic can read alerts.
3. Enable notifications for that topic.
4. In the GitHub repo: Settings → Secrets and variables → Actions → New repository secret:
   - `NTFY_TOPIC` = that same topic name (no `https://ntfy.sh/` prefix)

### Telegram (best on iOS)

1. In Telegram, talk to [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token.
2. Start a chat with your bot and send any message.
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `chat.id` (your user id, a number).
4. Add GitHub secrets:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`

You can set one or both. Missing secrets are skipped.

## GitHub

1. This repo is **public** so GitHub Pages works for free.
2. Add the secrets above (`NTFY_TOPIC` and/or Telegram).
3. Actions → **restock30pkmn checker** → Enable if prompted → **Run workflow**.
4. Settings → Pages → Source: **GitHub Actions**.
5. After the first successful run, open the Pages URL: `https://chillvibecoder1337.github.io/pokemon-30th-restock/`. The dashboard loads `data/status.json`. **Check now** re-runs the shop checks on the page.

Cron is every 10 minutes (`*/10 * * * *`). GitHub can delay scheduled jobs.

## Shops

The dashboard has two sections: **Pokémon 30th** and **FIFA / World Cup**, each with shops underneath.

Every enabled Pokémon shop is scraped for **Pokémon 30th** names (`30th`, `30 jaar`, `30-year`). Panini Belgium is scraped for **FIFA World Cup 2026**. No product URL paste needed.

- **AW2** — public catalog API, names matching Pokémon 30th.
- **Cardland** — Quickbutik JSON search (`/en/shop/search?s=…&out=json`) plus the Pokémon category page.
- **TrueCollector** — 30th category page. Buyable listings (`Do koszyka`) count as in stock, including presale. `ProduktBezZakupu` is out of stock. Their shop sometimes shows a wait page; the checker retries once with a browser User-Agent.
- **Bol.com** — search page when the IP is allowed; otherwise DuckDuckGo `site:bol.com` as a listing fallback. Bol often returns HTTP 403 to datacenter IPs (including GitHub Actions), so stock on Bol can be “open the page” until Bol unblocks.
- **Amazon NL** (`amazon.nl`) and **Amazon BE** (`amazon.com.be`) — search results named Pokémon 30th / 30e verjaardag. Amazon often serves a robot check from GitHub; then DuckDuckGo `site:amazon.nl` / `site:amazon.com.be` is the listing fallback. Stock is only marked in stock when the search card says so; otherwise open the product page.
- **Panini België** — official shop category [FIFA World Cup](https://www.paninibelgium.com/shp_bel_nl/panini-stickers/sport/fifa-world-cup.html). Lists 2026 sticker/Adrenalyn products. A disabled “In winkelwagen” button counts as out of stock. Missing-sticker order pages are skipped.

If a shop has no 30th products yet, the dashboard shows that scrape result instead of a disabled row.

## Run locally

```bash
node restock-30th/scripts/server.mjs
```

Open http://127.0.0.1:4173/ — **Check now** re-runs the shop checks on the page (no GitHub redirect).

One-off check without the dashboard:

```bash
node restock-30th/scripts/check.mjs
```

Optional local notify:

```bash
set NTFY_TOPIC=your-topic
set TELEGRAM_BOT_TOKEN=...
set TELEGRAM_CHAT_ID=...
node restock-30th/scripts/check.mjs
```

Open `restock-30th/index.html` in a browser (or use GitHub Pages) to see the last `data/status.json`.
