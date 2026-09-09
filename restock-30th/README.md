# Pokémon 30th restock watcher

Personal, $0 monitor for Cardland, AW2, TrueCollector, and Bol.com. GitHub Actions checks public stock every 10 minutes. The dashboard shows status and one-tap Open links. ntfy.sh and Telegram ping only when an item flips from out of stock to in stock.

This is a monitor plus open-the-page helper, not a checkout bot.

## Phone setup

### ntfy (Android is snappiest; iOS works)

1. Install [ntfy](https://ntfy.sh/) from Play Store, F-Droid, or App Store.
2. Subscribe to a **long random topic** you invent, for example `cardorca-30th-x7k9qp2m`. Anyone who guesses the topic can read alerts, so do not use `pokemon`.
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

1. Push this repo (public Pages is free; keep the repo public or accept slower checks on a private repo).
2. Add the three secrets above.
3. Actions → **Restock check** → Enable if prompted → **Run workflow**.
4. Settings → Pages → Source: **GitHub Actions**.
5. After the first successful run, open the Pages URL. The dashboard loads `data/status.json`. **Check now** opens the workflow so you can run it by hand.

Cron is every 10 minutes (`*/10 * * * *`). GitHub can delay scheduled jobs.

## Add Cardland / Bol product URLs

Edit `config/targets.json`:

```json
{
  "id": "cardland-30th",
  "shop": "cardland",
  "label": "Cardland ETB",
  "url": "https://www.cardland.se/en/all-sealed/YOUR-30TH-SLUG",
  "enabled": true
}
```

Same for Bol (`shop`: `"bol"`). AW2 scans its public catalog for names matching `30th|celebration` and needs no product URL.

TrueCollector uses the 30th category page (`pokemon-30th-celebration-c-1_77.html`). Buyable listings (`Do koszyka`) count as in stock, including presale. `ProduktBezZakupu` / Aktualnie niedostępny is out of stock. Their shop sometimes shows a wait page; the checker retries once with a browser User-Agent.

Bol.com often returns HTTP 403 to datacenter IPs (including GitHub Actions). The checker retries once with a browser User-Agent and shows the error on the dashboard if it is still blocked.

## Run locally

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
