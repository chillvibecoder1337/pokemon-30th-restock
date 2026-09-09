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

function isPokemon30Name(name) {
  const text = decodeEntities(name || "").replace(/[-_]+/g, " ");
  if (!/pok[eéè]mon/i.test(text)) return false;
  if (/\b25th\b/i.test(text)) return false;
  if (/\bcelebrations\b/i.test(text) && !/\b30th\b/i.test(text)) return false;
  if (/\b30\s*kaarten\b/i.test(text) && !/\b30th\b/i.test(text)) return false;
  return /\b30th\b|\b30[\s-]?jarig|\b30 jaar\b|\b30[\s-]year\b|\bthirtieth\b/i.test(
    text,
  );
}

function absoluteUrl(url, origin) {
  if (!url) return origin || "";
  if (/^https?:\/\//i.test(url)) return url;
  try {
    return new URL(url, origin || "https://example.com/").href;
  } catch {
    return url;
  }
}

function emptyScan(target, note) {
  return [
    item({
      id: target.id,
      shop: target.shop,
      name: target.label,
      url: target.url || "",
      inStock: false,
      stock: 0,
      note,
    }),
  ];
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

function parseCardlandHtmlList(html, origin, target) {
  const rows = [];
  const seen = new Set();
  const blocks = [
    ...html.matchAll(
      /<div class="product [^"]*" data-pid="(\d+)"[^>]*data-s-title="([^"]+)"[\s\S]*?<a class="text-dark productlist-title" href="([^"]+)"/g,
    ),
  ];
  for (const match of blocks) {
    const name = decodeEntities(match[2]);
    if (!isPokemon30Name(name) || seen.has(match[1])) continue;
    seen.add(match[1]);
    const chunk = match[0];
    const inStock = /In stock|Köpbar produkt/i.test(chunk);
    rows.push(
      item({
        id: `cardland-${match[1]}`,
        shop: "cardland",
        name,
        url: absoluteUrl(match[3], origin),
        inStock,
      }),
    );
  }
  return rows;
}

async function checkCardland(target) {
  const origin = "https://www.cardland.se";
  const queries = target.searchQueries || [
    "30th",
    "pokemon 30th",
    "30th celebration",
    "30 year",
  ];
  const seen = new Set();
  const rows = [];

  for (const query of queries) {
    const searchUrl = `${origin}/en/shop/search?s=${encodeURIComponent(query)}&out=json&limit=50`;
    const { text } = await fetchText(searchUrl);
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      rows.push(...parseCardlandHtmlList(text, `${origin}/en/`, target));
      continue;
    }
    for (const entry of data.searchresults || []) {
      const product = entry.product || {};
      if (!product.id || seen.has(String(product.id))) continue;
      if (!isPokemon30Name(product.title)) continue;
      seen.add(String(product.id));
      const stock = Number(product.stock);
      rows.push(
        item({
          id: `cardland-${product.id}`,
          shop: "cardland",
          name: product.title,
          url: absoluteUrl(product.url, `${origin}/en/`),
          inStock: Boolean(product.has_stock) && !product.soldOut,
          stock: Number.isFinite(stock) ? stock : null,
          note: product.price || "",
        }),
      );
    }
    await sleep(400);
  }

  if (target.categoryUrl) {
    const { text, finalUrl } = await fetchText(target.categoryUrl);
    for (const row of parseCardlandHtmlList(text, finalUrl, target)) {
      const pid = row.id.replace(/^cardland-/, "");
      if (seen.has(pid)) continue;
      seen.add(pid);
      rows.push(row);
    }
  }

  if (!rows.length) {
    return emptyScan(
      target,
      "No Pokémon 30th listings on Cardland yet (search + Pokémon category scraped)",
    );
  }
  return rows;
}

function parseBolSearchHtml(html) {
  const rows = [];
  const seen = new Set();
  const re = /\/nl\/nl\/p\/([a-z0-9-]+)\/(\d{10,})\//gi;
  let match;
  while ((match = re.exec(html))) {
    const slug = match[1];
    const id = match[2];
    if (seen.has(id)) continue;
    const name = slug.replace(/-/g, " ");
    if (!isPokemon30Name(name)) continue;
    seen.add(id);
    rows.push(
      item({
        id: `bol-${id}`,
        shop: "bol",
        name,
        url: `https://www.bol.com/nl/nl/p/${slug}/${id}/`,
        inStock: false,
      }),
    );
  }
  return rows;
}

function parseBolProductPage(html, url, fallbackName) {
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const name = titleMatch
    ? decodeEntities(titleMatch[1].replace(/\s*[\|–-]\s*bol\.com.*$/i, ""))
    : fallbackName;
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
  return { name, inStock };
}

function parseDdgBol(html) {
  const rows = [];
  const seen = new Set();
  const titles = new Map();
  for (const block of html.matchAll(
    /<h2 class="result__title">[\s\S]*?<\/h2>[\s\S]*?www\.bol\.com\/nl\/nl\/p\/([a-z0-9-]+)\/(\d{10,})\//gi,
  )) {
    const heading = block[0].match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/i);
    const name = heading
      ? decodeEntities(heading[1].replace(/<[^>]+>/g, ""))
      : block[1].replace(/-/g, " ");
    titles.set(block[2], name);
  }

  const add = (slug, id) => {
    if (!slug || !id || seen.has(id)) return;
    const slugName = slug.replace(/-/g, " ");
    if (!isPokemon30Name(slugName)) return;
    seen.add(id);
    const title = titles.get(id) || "";
    rows.push(
      item({
        id: `bol-${id}`,
        shop: "bol",
        name: isPokemon30Name(title) ? title : slugName,
        url: `https://www.bol.com/nl/nl/p/${slug}/${id}/`,
        inStock: false,
        note: "Found via search — Bol blocks bot stock checks; open the page",
      }),
    );
  };

  let match;
  const plainRe = /www\.bol\.com\/nl\/nl\/p\/([a-z0-9-]+)\/(\d{10,})\//gi;
  while ((match = plainRe.exec(html))) add(match[1], match[2]);

  const uddgRe = /uddg=([^&"']+)/gi;
  while ((match = uddgRe.exec(html))) {
    let decoded = match[1];
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      /* keep raw */
    }
    const product = decoded.match(
      /bol\.com\/nl\/nl\/p\/([a-z0-9-]+)\/(\d{10,})/i,
    );
    if (product) add(product[1], product[2]);
  }
  return rows;
}

async function checkBolViaDdg(target) {
  const queries = target.searchQueries || [
    "pokemon 30th celebration",
    "pokemon 30th",
    "pokemon 30 jaar",
  ];
  const seen = new Set();
  const rows = [];
  for (const query of queries) {
    const ddg = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`site:bol.com/nl ${query}`)}`;
    try {
      const { text } = await fetchText(ddg);
      for (const row of parseDdgBol(text)) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        rows.push(row);
      }
    } catch {
      /* DDG is a fallback index; skip a failed query */
    }
    await sleep(400);
  }
  return rows;
}

async function checkBol(target) {
  const searchUrl =
    target.url ||
    "https://www.bol.com/nl/nl/s/?searchtext=pokemon+30th";
  try {
    const { text } = await fetchText(searchUrl);
    const listed = parseBolSearchHtml(text);
    if (listed.length) {
      return listed.map((row) => {
        const parsed = parseBolProductPage(text, row.url, row.name);
        return item({
          ...row,
          name: isPokemon30Name(parsed.name) ? parsed.name : row.name,
          inStock: parsed.inStock,
          note: parsed.inStock ? "Bol search page" : "Bol search page",
        });
      });
    }
  } catch (err) {
    const viaDdg = await checkBolViaDdg(target);
    if (viaDdg.length) {
      return viaDdg.map((row) =>
        item({
          ...row,
          note: `${row.note} (${err.message})`,
        }),
      );
    }
    return emptyScan(
      target,
      `Bol blocked bots (${err.message}). No 30th product URLs in the search index this round`,
    );
  }

  const viaDdg = await checkBolViaDdg(target);
  if (viaDdg.length) return viaDdg;
  return emptyScan(
    target,
    "No Pokémon 30th listings found on Bol yet (search scraped)",
  );
}

async function checkAw2(target) {
  const { text } = await fetchText(
    target.apiUrl || "https://aw2spzoo.com/api/products",
  );
  const data = JSON.parse(text);
  const matches = (data.products || []).filter((product) =>
    isPokemon30Name(product.name || ""),
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
        note: "No Pokémon 30th listings in AW2 catalog yet",
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
    return emptyScan(target, "Turned off in config/targets.json");
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

  if (target.shop === "cardland") {
    return checkCardland(target);
  }

  if (target.shop === "bol") {
    return checkBol(target);
  }

  throw new Error(`Unknown shop: ${target.shop}`);
}

function restockAlerts(previousItems, currentItems) {
  const before = new Map((previousItems || []).map((row) => [row.id, row]));
  const alerts = [];
  for (const row of currentItems) {
    const prev = before.get(row.id);
    if (!row.inStock) continue;
    if (!prev || prev.inStock === false) {
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
