import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGETS_PATH = join(ROOT, "config", "targets.json");
const STATUS_PATH = join(ROOT, "data", "status.json");
const USER_AGENT =
  "Restock30pkmnChecker/1.0 (personal monitor; polite 10min interval)";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const FETCH_GAP_MS = 1500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

function requestHeaders(userAgent) {
  return {
    "User-Agent": userAgent,
    Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "nl-NL,nl;q=0.9,en;q=0.8",
  };
}

async function fetchText(url) {
  const first = await fetch(url, {
    headers: requestHeaders(USER_AGENT),
    redirect: "follow",
  });
  let res = first;
  if (!first.ok && /bol\.com/i.test(url)) {
    res = await fetch(url, {
      headers: requestHeaders(BROWSER_UA),
      redirect: "follow",
    });
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return { text, finalUrl: res.url };
}

function cookieHeader(setCookie) {
  return (setCookie || [])
    .map((raw) => raw.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

function isWaitWall(html) {
  return /Proszę czekać|just a moment, please/i.test(html);
}

async function fetchTrueCollector(url) {
  const headers = {
    "User-Agent": BROWSER_UA,
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.8",
  };
  let res = await fetch(url, { headers, redirect: "follow" });
  let text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  if (isWaitWall(text)) {
    const cookies = cookieHeader(res.headers.getSetCookie?.() || []);
    await sleep(5500);
    res = await fetch(url, {
      headers: {
        ...headers,
        Cookie: cookies,
        Referer: url,
      },
      redirect: "follow",
    });
    text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    if (isWaitWall(text)) {
      throw new Error("TrueCollector anti-bot wait page; try again later");
    }
  }
  return { text, finalUrl: res.url };
}

function parseTrueCollector(html, target) {
  const re = new RegExp(target.match || "30th|celebration", "i");
  const blocks = [
    ...html.matchAll(
      /<div id="prd-\d+-(\d+)" class="([^"]*)"[\s\S]*?<meta itemprop="name" content="([^"]+)"[\s\S]*?<link itemprop="url" href="([^"]+)"/g,
    ),
  ];
  const rows = [];
  for (const match of blocks) {
    const name = decodeEntities(match[3]);
    if (!re.test(name)) continue;
    const inStock = !/ProduktBezZakupu/i.test(match[2]);
    rows.push(
      item({
        id: `truecollector-${match[1]}`,
        shop: "truecollector",
        name,
        url: match[4],
        inStock,
        note: inStock ? "Dostępny (presale buyable)" : "Aktualnie niedostępny",
      }),
    );
  }
  if (rows.length === 0) {
    return [
      item({
        id: target.id,
        shop: "truecollector",
        name: target.label,
        url: target.url,
        inStock: false,
        stock: 0,
        note: "No 30th listings parsed from category page",
      }),
    ];
  }
  return rows;
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function item({
  id,
  shop,
  name,
  url,
  inStock,
  stock = null,
  note = "",
  error = null,
}) {
  return {
    id,
    shop,
    name,
    url,
    inStock: Boolean(inStock),
    stock,
    note,
    error,
  };
}

function parseCardland(html, url, target) {
  const raw = html.match(
    /var qs_store_apps_data = (\{[\s\S]*?\}); var qs_store_apps/,
  );
  if (raw) {
    const data = JSON.parse(raw[1]);
    const product = data.product || {};
    const stock = Number(product.stock);
    const inStock = Number.isFinite(stock)
      ? stock > 0
      : /in stock|köpbar produkt/i.test(html) &&
        !/out of stock|sold out|tillfälligt slutsåld/i.test(html);
    return [
      item({
        id: target.id,
        shop: "cardland",
        name: product.title || target.label,
        url,
        inStock,
        stock: Number.isFinite(stock) ? stock : null,
      }),
    ];
  }

  const inStock =
    /in stock|köpbar produkt/i.test(html) &&
    !/out of stock|sold out|unavailable/i.test(html);
  const title = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return [
    item({
      id: target.id,
      shop: "cardland",
      name: title ? decodeEntities(title[1].replace(/<[^>]+>/g, "")) : target.label,
      url,
      inStock,
      note: "Parsed without Quickbutik JSON",
    }),
  ];
}

function parseBol(html, url, target) {
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const name = titleMatch
    ? decodeEntities(titleMatch[1].replace(/\s*[\|–-]\s*bol\.com.*$/i, ""))
    : target.label;

  const availability = html.match(
    /"availability"\s*:\s*"(?:https?:\/\/schema\.org\/)?([^"]+)"/i,
  );
  const oos =
    /niet leverbaar|niet op voorraad|tijdelijk uitverkocht|outofstock|soldout/i.test(
      html,
    );
  const buy =
    /in winkelwagen|in winkelmand|toevoegen aan winkelwagen|data-test="add-to-cart"/i.test(
      html,
    );

  let inStock = false;
  if (availability) {
    inStock = /InStock|LimitedAvailability/i.test(availability[1]);
  } else {
    inStock = buy && !oos;
  }

  return [
    item({
      id: target.id,
      shop: "bol",
      name,
      url,
      inStock,
      note: availability
        ? `schema.org ${availability[1]}`
        : "HTML heuristic (Bol is JS-heavy; false negatives possible)",
    }),
  ];
}

async function checkAw2(target) {
  const { text } = await fetchText(
    target.apiUrl || "https://aw2spzoo.com/api/products",
  );
  const data = JSON.parse(text);
  const re = new RegExp(target.match || "30th|celebration", "i");
  const matches = (data.products || []).filter((product) =>
    re.test(product.name || ""),
  );

  if (matches.length === 0) {
    return [
      item({
        id: target.id,
        shop: "aw2",
        name: target.label,
        url: target.url || "https://aw2spzoo.com/",
        inStock: false,
        stock: 0,
        note: "No catalog match for 30th/Celebration yet",
      }),
    ];
  }

  return matches.map((product) =>
    item({
      id: `aw2-${product.id}`,
      shop: "aw2",
      name: product.name,
      url: target.url || "https://aw2spzoo.com/",
      inStock: Number(product.stock) > 0,
      stock: Number(product.stock) || 0,
      note:
        product.price_eur != null ? `€${product.price_eur} net` : "",
    }),
  );
}

async function checkTarget(target) {
  if (!target.enabled) {
    return [
      item({
        id: target.id,
        shop: target.shop,
        name: target.label,
        url: target.url || "",
        inStock: false,
        note: "Disabled — paste a product URL in config/targets.json and set enabled true",
      }),
    ];
  }

  if (target.shop === "aw2") {
    return checkAw2(target);
  }

  if (target.shop === "truecollector") {
    const { text } = await fetchTrueCollector(
      target.url ||
        "https://www.truecollector.pl/pokemon-30th-celebration-c-1_77.html",
    );
    return parseTrueCollector(text, target);
  }

  if (!target.url) {
    return [
      item({
        id: target.id,
        shop: target.shop,
        name: target.label,
        url: "",
        inStock: false,
        note: "No URL yet",
      }),
    ];
  }

  const { text, finalUrl } = await fetchText(target.url);
  if (target.shop === "cardland") {
    return parseCardland(text, finalUrl || target.url, target);
  }
  if (target.shop === "bol") {
    return parseBol(text, finalUrl || target.url, target);
  }

  throw new Error(`Unknown shop: ${target.shop}`);
}

function restockAlerts(previousItems, currentItems) {
  const before = new Map((previousItems || []).map((row) => [row.id, row]));
  const alerts = [];
  for (const row of currentItems) {
    const prev = before.get(row.id);
    if (!prev) continue;
    if (prev.inStock === false && row.inStock === true) {
      alerts.push(row);
    }
  }
  return alerts;
}

function alertBody(row) {
  const stock =
    row.stock == null ? "in stock" : `${row.stock} in stock`;
  return `${row.shop.toUpperCase()} — ${row.name}\n${stock}\n${row.url}`;
}

async function notifyNtfy(row) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return false;
  const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
    method: "POST",
    headers: {
      Title: `Restock: ${row.name}`.slice(0, 120),
      Priority: "high",
      Tags: "bell,shopping",
      Click: row.url || "",
    },
    body: alertBody(row),
  });
  if (!res.ok) {
    throw new Error(`ntfy HTTP ${res.status}`);
  }
  return true;
}

async function notifyTelegram(row) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;
  const res = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: `Restock\n${alertBody(row)}`,
        disable_web_page_preview: false,
      }),
    },
  );
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Telegram HTTP ${res.status}: ${detail.slice(0, 200)}`);
  }
  return true;
}

async function sendAlerts(alerts) {
  const results = [];
  for (const row of alerts) {
    const sent = { id: row.id, ntfy: false, telegram: false, errors: [] };
    try {
      sent.ntfy = await notifyNtfy(row);
    } catch (err) {
      sent.errors.push(`ntfy: ${err.message}`);
    }
    try {
      sent.telegram = await notifyTelegram(row);
    } catch (err) {
      sent.errors.push(`telegram: ${err.message}`);
    }
    results.push(sent);
    await sleep(400);
  }
  return results;
}

async function main() {
  const config = await loadJson(TARGETS_PATH, { targets: [] });
  const previous = await loadJson(STATUS_PATH, { items: [] });
  const targets = config.targets || [];
  const items = [];
  const errors = [];

  for (const [index, target] of targets.entries()) {
    try {
      const rows = await checkTarget(target);
      items.push(...rows);
    } catch (err) {
      errors.push(`${target.id}: ${err.message}`);
      items.push(
        item({
          id: target.id,
          shop: target.shop,
          name: target.label || target.id,
          url: target.url || "",
          inStock: false,
          error: err.message,
          note: "Check failed",
        }),
      );
    }
    if (index < targets.length - 1) {
      await sleep(FETCH_GAP_MS);
    }
  }

  const alerts = restockAlerts(previous.items, items);
  const notifyResults = await sendAlerts(alerts);

  const repo = process.env.GITHUB_REPOSITORY || "";
  const status = {
    checkedAt: new Date().toISOString(),
    ok: errors.length === 0,
    errors,
    items,
    alerts: alerts.map((row) => ({
      id: row.id,
      name: row.name,
      url: row.url,
    })),
    notify: notifyResults,
    github: {
      actionsUrl: repo
        ? `https://github.com/${repo}/actions/workflows/restock-check.yml`
        : "",
    },
  };

  await writeFile(STATUS_PATH, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        checkedAt: status.checkedAt,
        items: items.length,
        inStock: items.filter((row) => row.inStock).length,
        alerts: alerts.length,
        errors,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
