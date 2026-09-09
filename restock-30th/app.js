const list = document.getElementById("list");
const checked = document.getElementById("checked");
const openAll = document.getElementById("open-all");
const checkNow = document.getElementById("check-now");
let items = [];

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  if (/\b25th\b|\b25e\b|\b25ste\b/i.test(text)) return false;
  if (/\bcelebrations\b/i.test(text) && !/\b30th\b|\b30e\b/i.test(text)) {
    return false;
  }
  if (/\b30\s*kaarten\b/i.test(text) && !/\b30th\b|\b30e\b/i.test(text)) {
    return false;
  }
  return /\b30th\b|\b30e\b|\b30ème\b|\b30eme\b|\b30ste\b|\b30[\s-]?jarig|\b30 jaar\b|\b30[\s-]year\b|\bthirtieth\b/i.test(
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

function row(partial) {
  return {
    id: partial.id,
    shop: partial.shop,
    name: partial.name,
    url: partial.url || "",
    inStock: Boolean(partial.inStock),
    stock: partial.stock ?? null,
    note: partial.note || "",
    error: partial.error || null,
    section: partial.section || "pokemon-30th",
  };
}

function badge(item) {
  if (item.inStock) {
    const stock = item.stock == null ? "In stock" : `${item.stock} in stock`;
    return `<span class="badge in">${escapeHtml(stock)}</span>`;
  }
  return `<span class="badge out">Out of stock</span>`;
}

const SHOP_LABELS = {
  aw2: "AW2",
  cardland: "Cardland",
  truecollector: "TrueCollector",
  bol: "Bol.com",
  "amazon-nl": "Amazon Nederland",
  "amazon-be": "Amazon België",
  "panini-be": "Panini België",
};

const SECTION_LABELS = {
  "pokemon-30th": "Pokémon 30th",
  "fifa-wc": "FIFA / World Cup",
};

function shopLabel(shop) {
  return SHOP_LABELS[shop] || String(shop || "Shop");
}

function sectionLabel(section) {
  return SECTION_LABELS[section] || shopLabel(section);
}

function groupBySectionThenShop(listItems) {
  const sections = [];
  const sectionIndex = new Map();
  for (const item of listItems) {
    const section = item.section || "pokemon-30th";
    if (!sectionIndex.has(section)) {
      sectionIndex.set(section, sections.length);
      sections.push({ section, shops: [] });
    }
    const group = sections[sectionIndex.get(section)];
    let shopGroup = group.shops.find((entry) => entry.shop === item.shop);
    if (!shopGroup) {
      shopGroup = { shop: item.shop, items: [] };
      group.shops.push(shopGroup);
    }
    shopGroup.items.push(item);
  }
  return sections;
}

function itemCard(item) {
  const open = item.url
    ? `<a class="btn secondary" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">Open</a>`
    : "";
  const note = item.note
    ? `<div class="note">${escapeHtml(item.note)}</div>`
    : "";
  const error = item.error
    ? `<div class="error">${escapeHtml(item.error)}</div>`
    : "";
  return `<article class="card">
        <div class="row">
          <div>
            <div class="name">${escapeHtml(item.name)}</div>
            ${note}${error}
          </div>
          ${badge(item)}
        </div>
        <div class="actions">${open}</div>
      </article>`;
}

function render(status) {
  items = status.items || [];
  const when = status.checkedAt
    ? new Date(status.checkedAt).toLocaleString()
    : "never";
  const inCount = items.filter((item) => item.inStock).length;
  checked.textContent = `Last check ${when} · ${inCount}/${items.length} in stock`;
  if (!items.length) {
    list.innerHTML = '<p class="note">No items yet. Press Check now.</p>';
    return;
  }
  list.innerHTML = groupBySectionThenShop(items)
    .map((theme) => {
      const themeItems = theme.shops.flatMap((group) => group.items);
      const inTheme = themeItems.filter((item) => item.inStock).length;
      const shopsHtml = theme.shops
        .map((group) => {
          const inShop = group.items.filter((item) => item.inStock).length;
          return `<section class="shop-section">
        <div class="shop-heading">
          <h3>${escapeHtml(shopLabel(group.shop))}</h3>
          <span class="count">${inShop}/${group.items.length} in stock</span>
        </div>
        ${group.items.map(itemCard).join("")}
      </section>`;
        })
        .join("");
      return `<section class="theme-section">
        <div class="theme-heading">
          <h2>${escapeHtml(sectionLabel(theme.section))}</h2>
          <span class="count">${inTheme}/${themeItems.length} in stock</span>
        </div>
        ${shopsHtml}
      </section>`;
    })
    .join("");
}

async function loadSavedStatus() {
  const res = await fetch(`./data/status.json?t=${Date.now()}`);
  if (!res.ok) throw new Error("status.json missing");
  return res.json();
}

async function fetchText(url) {
  try {
    const direct = await fetch(url, { mode: "cors" });
    if (direct.ok) return await direct.text();
  } catch {
    /* shops block browser CORS; try a public GET proxy next */
  }
  const proxied = await fetch(
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  );
  if (!proxied.ok) {
    throw new Error(`HTTP ${proxied.status} for ${url}`);
  }
  return proxied.text();
}

function parseAw2(text, target) {
  const data = JSON.parse(text);
  const matches = (data.products || []).filter((product) =>
    isPokemon30Name(product.name || ""),
  );
  if (!matches.length) {
    return [
      row({
        id: target.id,
        shop: "aw2",
        name: target.label,
        url: target.url,
        note: "No Pokémon 30th listings in AW2 catalog yet",
      }),
    ];
  }
  return matches.map((product) =>
    row({
      id: `aw2-${product.id}`,
      shop: "aw2",
      name: product.name,
      url: target.url,
      inStock: Number(product.stock) > 0,
      stock: Number(product.stock) || 0,
      note: product.price_eur != null ? `€${product.price_eur} net` : "",
    }),
  );
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
      row({
        id: `truecollector-${match[1]}`,
        shop: "truecollector",
        name,
        url: match[4],
        inStock,
        note: inStock ? "Dostępny (presale buyable)" : "Aktualnie niedostępny",
      }),
    );
  }
  if (!rows.length) {
    return [
      row({
        id: target.id,
        shop: "truecollector",
        name: target.label,
        url: target.url,
        note: "No 30th listings parsed from category page",
      }),
    ];
  }
  return rows;
}

function parseCardlandJson(text, origin) {
  const data = JSON.parse(text);
  const rows = [];
  const seen = new Set();
  for (const entry of data.searchresults || []) {
    const product = entry.product || {};
    if (!product.id || seen.has(String(product.id))) continue;
    if (!isPokemon30Name(product.title)) continue;
    seen.add(String(product.id));
    const stock = Number(product.stock);
    rows.push(
      row({
        id: `cardland-${product.id}`,
        shop: "cardland",
        name: product.title,
        url: absoluteUrl(product.url, origin),
        inStock: Boolean(product.has_stock) && !product.soldOut,
        stock: Number.isFinite(stock) ? stock : null,
        note: product.price || "",
      }),
    );
  }
  return rows;
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
      row({
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
      row({
        id: `bol-${id}`,
        shop: "bol",
        name,
        url: `https://www.bol.com/nl/nl/p/${slug}/${id}/`,
      }),
    );
  }
  return rows;
}

function amazonHost(target) {
  return (
    target.host ||
    (target.shop === "amazon-be" ? "www.amazon.com.be" : "www.amazon.nl")
  );
}

function parseAmazonSearchHtml(html, target) {
  const host = amazonHost(target);
  const shop = target.shop;
  const rows = [];
  const seen = new Set();
  const starts = [
    ...html.matchAll(
      /<div role="listitem" data-asin="([A-Z0-9]{10})"[^>]*data-component-type="s-search-result"/gi,
    ),
  ];
  for (let i = 0; i < starts.length; i++) {
    const asin = starts[i][1];
    if (seen.has(asin)) continue;
    const from = starts[i].index;
    const next = i + 1 < starts.length ? starts[i + 1].index : from + 16000;
    const chunk = html.slice(from, Math.min(next, from + 16000));
    const heading = chunk.match(/<h2[^>]*>[\s\S]*?<\/h2>/i);
    const name = heading
      ? decodeEntities(heading[0].replace(/<[^>]+>/g, " ")).replace(
          /\s+/g,
          " ",
        )
      : "";
    if (!isPokemon30Name(name)) continue;
    seen.add(asin);
    const oos =
      /Momenteel niet verkrijgbaar|Tijdelijk niet beschikbaar|Currently unavailable|Temporarily out of stock|Niet op voorraad/i.test(
        chunk,
      );
    const inStock =
      !oos &&
      /Op voorraad|In stock|Nog slechts \d+|In winkelwagen|Add to cart/i.test(
        chunk,
      );
    rows.push(
      row({
        id: `${shop}-${asin}`,
        shop,
        name,
        url: `https://${host}/dp/${asin}`,
        inStock,
        note: inStock
          ? "Amazon search: op voorraad"
          : "Amazon listing — open for live stock",
      }),
    );
  }
  return rows;
}

function parseDdgAmazon(html, target) {
  const host = amazonHost(target);
  const shop = target.shop;
  const hostRe = host.replace(/\./g, "\\.");
  const rows = [];
  const seen = new Set();
  const titles = new Map();
  const titleRe = new RegExp(
    `<h2 class="result__title">[\\s\\S]*?</h2>[\\s\\S]*?${hostRe}[^\\s"']*/dp/([A-Z0-9]{10})`,
    "gi",
  );
  for (const block of html.matchAll(titleRe)) {
    const heading = block[0].match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/i);
    const name = heading
      ? decodeEntities(heading[1].replace(/<[^>]+>/g, ""))
      : "";
    if (name) titles.set(block[1], name);
  }
  const add = (asin) => {
    if (!asin || seen.has(asin)) return;
    const title = titles.get(asin) || "";
    if (!isPokemon30Name(title)) return;
    seen.add(asin);
    rows.push(
      row({
        id: `${shop}-${asin}`,
        shop,
        name: title,
        url: `https://${host}/dp/${asin}`,
        inStock: false,
        note: "Found via search — Amazon blocks bot stock checks; open the page",
      }),
    );
  };
  const plainRe = new RegExp(`${hostRe}[^\\s"']*/dp/([A-Z0-9]{10})`, "gi");
  let match;
  while ((match = plainRe.exec(html))) add(match[1]);
  const uddgRe = /uddg=([^&"']+)/gi;
  while ((match = uddgRe.exec(html))) {
    let decoded = match[1];
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      /* keep raw */
    }
    const product = decoded.match(/\/dp\/([A-Z0-9]{10})/i);
    if (product) add(product[1]);
  }
  return rows;
}

function isFifaWorldCupName(name) {
  const text = decodeEntities(name || "").replace(/[-_]+/g, " ");
  if (/ontbrekende/i.test(text)) return false;
  if (!/2026/.test(text)) return false;
  if (/fifa\s*365/i.test(text) && !/world\s*cup|wk\s*2026/i.test(text)) {
    return false;
  }
  return /world\s*cup|wereldbeker|\bwk\s*2026\b|fifa\s*world/i.test(text);
}

function paniniProductIds(html) {
  const ids = new Set();
  for (const match of html.matchAll(/id="product-item-info_(\d+)"/g)) {
    ids.add(match[1]);
  }
  return ids;
}

function paniniAnchorCartIds(html) {
  const ids = new Set();
  const re =
    /id="product-item-info_(\d+)"([\s\S]*?)(?=id="product-item-info_|<\/ol>)/g;
  let match;
  while ((match = re.exec(html))) {
    if (/<a\b[^>]*class="[^"]*action tocart primary/i.test(match[2])) {
      ids.add(match[1]);
    }
  }
  return ids;
}

function paniniProductPageInStock(html) {
  if (/schema\.org\/OutOfStock/i.test(html)) return false;
  if (/"is_available"\s*:\s*false\b/.test(html)) return false;
  if (/"is_salable"\s*:\s*"0"/.test(html)) return false;
  if (/schema\.org\/InStock/i.test(html)) return true;
  if (/"is_available"\s*:\s*true\b/.test(html)) return true;
  if (/"is_salable"\s*:\s*"1"/.test(html)) return true;
  if (/"product_availability"\s*:\s*"available"/i.test(html)) return true;
  return false;
}

function paniniSaleableUrl(base, page) {
  const join = base.includes("?") ? "&" : "?";
  return `${base}${join}pnn_is_saleable=1&p=${page}`;
}

function parsePaniniBelgiumHtml(html, target, saleableIds) {
  const rows = [];
  const seen = new Set();
  const re =
    /id="product-item-info_(\d+)"([\s\S]*?)(?=id="product-item-info_|<\/ol>)/g;
  let match;
  while ((match = re.exec(html))) {
    const id = match[1];
    const chunk = match[2];
    if (seen.has(id)) continue;
    const named = chunk.match(
      /<a class="product-item-link"\s+href="([^"]+)">\s*([\s\S]*?)<\/a>/i,
    );
    if (!named) continue;
    const name = decodeEntities(named[2].replace(/<[^>]+>/g, " ")).replace(
      /\s+/g,
      " ",
    );
    if (!isFifaWorldCupName(name)) continue;
    seen.add(id);
    const inStock = Boolean(saleableIds && saleableIds.has(id));
    rows.push(
      row({
        id: `panini-be-${id}`,
        shop: "panini-be",
        name,
        url: named[1],
        inStock,
        note: inStock ? "Panini.be: te koop" : "Niet op voorraad",
        section: target.section || "fifa-wc",
      }),
    );
  }
  return rows;
}

async function checkTarget(target) {
  if (!target.enabled) {
    return [
      row({
        id: target.id,
        shop: target.shop,
        name: target.label,
        url: target.url || "",
        note: "Turned off in config/targets.json",
      }),
    ];
  }
  if (target.shop === "aw2") {
    return parseAw2(
      await fetchText(target.apiUrl || "https://aw2spzoo.com/api/products"),
      target,
    );
  }
  if (target.shop === "truecollector") {
    let html = await fetchText(target.url);
    if (/Proszę czekać|just a moment, please/i.test(html)) {
      await new Promise((resolve) => setTimeout(resolve, 5500));
      html = await fetchText(target.url);
    }
    return parseTrueCollector(html, target);
  }
  if (target.shop === "cardland") {
    const queries = target.searchQueries || ["30th", "pokemon 30th"];
    const seen = new Set();
    const rows = [];
    for (const query of queries) {
      const searchUrl = `https://www.cardland.se/en/shop/search?s=${encodeURIComponent(query)}&out=json&limit=50`;
      const parsed = parseCardlandJson(
        await fetchText(searchUrl),
        "https://www.cardland.se/en/",
      );
      for (const item of parsed) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        rows.push(item);
      }
    }
    if (!rows.length) {
      return [
        row({
          id: target.id,
          shop: "cardland",
          name: target.label,
          url: target.url || "",
          note: "No Pokémon 30th listings on Cardland yet (search scraped)",
        }),
      ];
    }
    return rows;
  }
  if (target.shop === "bol") {
    try {
      const html = await fetchText(
        target.url ||
          "https://www.bol.com/nl/nl/s/?searchtext=pokemon+30th",
      );
      const listed = parseBolSearchHtml(html);
      if (listed.length) return listed;
    } catch {
      /* Bol often 403s; fall through to DuckDuckGo */
    }
    const queries = target.searchQueries || ["pokemon 30th celebration"];
    const seen = new Set();
    const rows = [];
    for (const query of queries) {
      const ddg = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`site:bol.com/nl ${query}`)}`;
      for (const item of parseDdgBol(await fetchText(ddg))) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        rows.push(item);
      }
    }
    if (!rows.length) {
      return [
        row({
          id: target.id,
          shop: "bol",
          name: target.label,
          url: target.url || "",
          note: "No Pokémon 30th listings found on Bol yet (search scraped)",
        }),
      ];
    }
    return rows;
  }
  if (target.shop === "amazon-nl" || target.shop === "amazon-be") {
    const host = amazonHost(target);
    const shopLabel = target.shop === "amazon-be" ? "Amazon BE" : "Amazon NL";
    try {
      const html = await fetchText(
        target.url || `https://${host}/s?k=pokemon+30th+celebration`,
      );
      const listed = parseAmazonSearchHtml(html, target);
      if (listed.length) return listed;
    } catch {
      /* Amazon robot-check; fall through to DuckDuckGo */
    }
    const queries = target.searchQueries || ["pokemon 30th celebration"];
    const seen = new Set();
    const rows = [];
    for (const query of queries) {
      const ddg = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`site:${host} ${query}`)}`;
      for (const item of parseDdgAmazon(await fetchText(ddg), target)) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        rows.push(item);
      }
    }
    if (!rows.length) {
      return [
        row({
          id: target.id,
          shop: target.shop,
          name: target.label,
          url: target.url || "",
          note: `No Pokémon 30th listings found on ${shopLabel} yet (search scraped)`,
        }),
      ];
    }
    return rows;
  }
  if (target.shop === "panini-be") {
    const base =
      target.url ||
      "https://www.paninibelgium.com/shp_bel_nl/panini-stickers/sport/fifa-world-cup.html";
    const saleableIds = new Set();
    for (let page = 1; page <= 6; page += 1) {
      const html = await fetchText(paniniSaleableUrl(base, page));
      const before = saleableIds.size;
      for (const id of paniniProductIds(html)) saleableIds.add(id);
      for (const id of paniniAnchorCartIds(html)) saleableIds.add(id);
      if (saleableIds.size === before) break;
    }
    const seen = new Set();
    const rows = [];
    for (let page = 1; page <= 6; page += 1) {
      const url = `${base}${base.includes("?") ? "&" : "?"}p=${page}`;
      const html = await fetchText(url);
      for (const id of paniniAnchorCartIds(html)) saleableIds.add(id);
      const listed = parsePaniniBelgiumHtml(html, target, saleableIds);
      let added = 0;
      for (const item of listed) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        rows.push(item);
        added += 1;
      }
      if (added === 0) break;
    }
    if (!rows.length) {
      return [
        row({
          id: target.id,
          shop: "panini-be",
          name: target.label,
          url: target.url || "",
          note: "No FIFA World Cup 2026 listings on Panini Belgium yet",
          section: target.section || "fifa-wc",
        }),
      ];
    }
    for (const item of rows) {
      const magentoId = String(item.id).replace(/^panini-be-/, "");
      try {
        item.inStock = paniniProductPageInStock(await fetchText(item.url));
      } catch {
        item.inStock = saleableIds.has(magentoId);
      }
      item.note = item.inStock ? "Panini.be: te koop" : "Niet op voorraad";
    }
    return rows;
  }
  throw new Error(`Unknown shop: ${target.shop}`);
}

async function runBrowserCheck() {
  const configRes = await fetch(`./config/targets.json?t=${Date.now()}`);
  if (!configRes.ok) throw new Error("targets.json missing");
  const config = await configRes.json();
  const nextItems = [];
  const errors = [];
  for (const target of config.targets || []) {
    try {
      nextItems.push(
        ...(await checkTarget(target)).map((item) => ({
          ...item,
          section:
            item.section ||
            target.section ||
            (target.shop === "panini-be" ? "fifa-wc" : "pokemon-30th"),
        })),
      );
    } catch (err) {
      errors.push(`${target.id}: ${err.message}`);
      nextItems.push(
        row({
          id: target.id,
          shop: target.shop,
          name: target.label || target.id,
          url: target.url || "",
          error: err.message,
          note: "Check failed",
        }),
      );
    }
  }
  return {
    checkedAt: new Date().toISOString(),
    ok: errors.length === 0,
    errors,
    items: nextItems,
    alerts: [],
    github: { actionsUrl: "" },
  };
}

async function checkNowClick() {
  checkNow.disabled = true;
  checked.textContent = "Checking shops…";
  try {
    try {
      const api = await fetch("/api/check", { method: "POST" });
      if (api.ok) {
        render(await api.json());
        return;
      }
    } catch {
      /* GitHub Pages has no /api/check; run in the browser */
    }
    try {
      render(await runBrowserCheck());
    } catch (err) {
      const saved = await loadSavedStatus();
      render(saved);
      checked.textContent = `${checked.textContent} · live check failed (${err.message})`;
    }
  } finally {
    checkNow.disabled = false;
  }
}

openAll.addEventListener("click", () => {
  const urls = items.filter((item) => item.inStock && item.url).map((item) => item.url);
  if (!urls.length) {
    alert("Nothing in stock right now.");
    return;
  }
  for (const url of urls) window.open(url, "_blank", "noopener");
});

checkNow.addEventListener("click", () => {
  checkNowClick();
});

loadSavedStatus()
  .then(render)
  .catch((err) => {
    checked.textContent = err.message;
  });
