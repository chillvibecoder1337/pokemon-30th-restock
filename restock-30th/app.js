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
  };
}

function badge(item) {
  if (item.inStock) {
    const stock = item.stock == null ? "In stock" : `${item.stock} in stock`;
    return `<span class="badge in">${escapeHtml(stock)}</span>`;
  }
  return `<span class="badge out">Out of stock</span>`;
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
  list.innerHTML = items
    .map((item) => {
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
            <div class="shop">${escapeHtml(item.shop)}</div>
            <div class="name">${escapeHtml(item.name)}</div>
            ${note}${error}
          </div>
          ${badge(item)}
        </div>
        <div class="actions" style="margin:0.75rem 0 0">${open}</div>
      </article>`;
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
  const re = new RegExp(target.match || "30th|celebration", "i");
  const matches = (data.products || []).filter((product) =>
    re.test(product.name || ""),
  );
  if (!matches.length) {
    return [
      row({
        id: target.id,
        shop: "aw2",
        name: target.label,
        url: target.url,
        note: "No catalog match for 30th/Celebration yet",
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

function parseCardland(html, url, target) {
  const raw = html.match(
    /var qs_store_apps_data = (\{[\s\S]*?\}); var qs_store_apps/,
  );
  if (raw) {
    const data = JSON.parse(raw[1]);
    const product = data.product || {};
    const stock = Number(product.stock);
    return [
      row({
        id: target.id,
        shop: "cardland",
        name: product.title || target.label,
        url,
        inStock: Number.isFinite(stock) ? stock > 0 : false,
        stock: Number.isFinite(stock) ? stock : null,
      }),
    ];
  }
  return [
    row({
      id: target.id,
      shop: "cardland",
      name: target.label,
      url,
      inStock: /in stock|köpbar produkt/i.test(html),
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
  const oos = /niet leverbaar|niet op voorraad|outofstock/i.test(html);
  const buy = /in winkelwagen|toevoegen aan winkelwagen/i.test(html);
  let inStock = availability
    ? /InStock|LimitedAvailability/i.test(availability[1])
    : buy && !oos;
  return [
    row({
      id: target.id,
      shop: "bol",
      name,
      url,
      inStock,
    }),
  ];
}

async function checkTarget(target) {
  if (!target.enabled) {
    return [
      row({
        id: target.id,
        shop: target.shop,
        name: target.label,
        url: target.url || "",
        note: "Disabled — paste a product URL in config/targets.json and set enabled true",
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
  if (!target.url) {
    return [
      row({
        id: target.id,
        shop: target.shop,
        name: target.label,
        note: "No URL yet",
      }),
    ];
  }
  const html = await fetchText(target.url);
  if (target.shop === "cardland") return parseCardland(html, target.url, target);
  if (target.shop === "bol") return parseBol(html, target.url, target);
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
      nextItems.push(...(await checkTarget(target)));
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
