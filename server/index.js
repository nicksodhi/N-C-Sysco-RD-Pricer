require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const cron = require("node-cron");

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "../build")));

// ── Price store (in-memory, persists while server runs) ───────────────────────
let priceStore = { rd: {}, sysco: {}, lastUpdated: null, log: [] };
const log = (msg) => {
  console.log(msg);
  priceStore.log.unshift({ time: new Date().toISOString(), msg });
  if (priceStore.log.length > 200) priceStore.log.pop();
};

// ── Item master list ──────────────────────────────────────────────────────────
const ITEMS = [
  { id: "42599",    name: "Russet Potatoes" },
  { id: "44146",    name: "Peeled Garlic" },
  { id: "42513",    name: "Fresh Ginger" },
  { id: "1440528",  name: "Paneer" },
  { id: "42566",    name: "Cilantro" },
  { id: "44137",    name: "Serrano Peppers" },
  { id: "42658",    name: "Red Onions" },
  { id: "42545",    name: "Yellow Onions" },
  { id: "42504",    name: "Cucumbers" },
  { id: "1530438",  name: "Heavy Cream" },
  { id: "370496",   name: "Whole Milk" },
  { id: "14785",    name: "Plain Yogurt" },
  { id: "1440204",  name: "Cheddar Jack Cheese" },
  { id: "77200",    name: "Chicken Wings" },
  { id: "77670",    name: "Chicken Leg Quarters" },
  { id: "77682",    name: "Chicken Thighs Boneless" },
  { id: "1810019",  name: "Goat Bone-in Cubed" },
  { id: "79042",    name: "Lamb Leg Boneless Halal" },
  { id: "77595",    name: "Chicken Thigh Meat Frozen" },
  { id: "77597",    name: "Chicken Leg Meat Frozen Marinated" },
  { id: "51457",    name: "Tilapia Fillets Frozen" },
  { id: "64046",    name: "Chopped Spinach Frozen" },
  { id: "64120",    name: "Broccoli Florets Frozen" },
  { id: "86527",    name: "Mixed Vegetables Frozen" },
  { id: "86525",    name: "Green Peas Frozen" },
  { id: "2910159",  name: "Cornstarch" },
  { id: "16200",    name: "Garbanzo Beans" },
  { id: "69810",    name: "Red Kidney Beans" },
  { id: "860044",   name: "Tomato Sauce" },
  { id: "860135",   name: "Petite Diced Tomatoes" },
  { id: "490266",   name: "Basmati Rice Extra Long Grain" },
  { id: "490219",   name: "Sela Basmati Rice" },
  { id: "21051",    name: "Granulated Sugar" },
  { id: "1070496",  name: "Salt" },
  { id: "29268",    name: "Baking Powder" },
  { id: "53556",    name: "Atta Flour Durum Wheat" },
  { id: "1020152",  name: "Liquid Butter Alt" },
  { id: "13417",    name: "Sambal Oelek Chili Paste" },
  { id: "1020079",  name: "Canola Oil" },
  { id: "1020075",  name: "Soybean Oil" },
  { id: "1020077",  name: "Fry Oil" },
  { id: "2550014",  name: "Red Food Coloring" },
  { id: "25267",    name: "Roasted Eggplant Pulp" },
  { id: "12728",    name: "Pan Spray" },
  { id: "21039",    name: "Spring Water Evian" },
  { id: "440040",   name: "Sprite" },
  { id: "440039",   name: "Diet Coke" },
  { id: "55519",    name: "Micro Orchid Flowers" },
];

// ── Claude API proxy ──────────────────────────────────────────────────────────
app.post("/api/claude", async (req, res) => {
  try {
    const body = { ...req.body, model: "claude-haiku-4-5-20251001" };
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ── AI price matching ─────────────────────────────────────────────────────────
async function matchWithAI(scrapedItems, source) {
  if (!scrapedItems.length) return [];
  const list = ITEMS.map(i => `${i.id}: ${i.name}`).join("\n");
  const scraped = scrapedItems.slice(0, 100).map(i => `${i.name}: $${i.price}`).join("\n");
  const prompt = `Match these ${source} items to our product list. Only match if confident.
SCRAPED:\n${scraped}\nOUR LIST:\n${list}
Return ONLY JSON array: [{"id":"ITEM_ID","price":0.00}]`;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 2000, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await r.json();
    const txt = data.content?.find(b => b.type === "text")?.text || "[]";
    const m = txt.match(/\[[\s\S]*\]/);
    return m ? JSON.parse(m[0]) : [];
  } catch(e) { return []; }
}

// ── RD Scraper using Puppeteer with full diagnostic logging ───────────────────
async function scrapeRD() {
  log("🟢 RD: launching browser...");
  const chromium = require("@sparticuz/chromium");
  const puppeteer = require("puppeteer-core");
  let browser;
  try {
    const execPath = await chromium.executablePath();
    log(`RD: chromium at ${execPath}`);
    browser = await puppeteer.launch({
      args: [...chromium.args, "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--single-process"],
      executablePath: execPath,
      headless: chromium.headless,
      timeout: 30000,
    });
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36");
    page.setDefaultTimeout(30000);

    // Step 1: SSO login
    log("RD: going to SSO init URL...");
    try {
      await page.goto(
        "https://member.restaurantdepot.com/rest/sso/auth/restaurantdepot/init?return_to=https%3A%2F%2Fwww.restaurantdepot.com%2F",
        { waitUntil: "domcontentloaded", timeout: 45000 }
      );
    } catch(e) { log(`RD: SSO nav error: ${e.message}`); }
    await new Promise(r => setTimeout(r, 5000));
    log(`RD: after SSO goto, URL=${page.url()}`);

    // Step 2: Find and fill login form
    const inputs = await page.evaluate(() =>
      Array.from(document.querySelectorAll("input")).map(i => ({ type: i.type, name: i.name, id: i.id, placeholder: i.placeholder }))
    );
    log(`RD: inputs on page: ${JSON.stringify(inputs)}`);
    log(`RD: page title: ${await page.title()}`);

    const hasEmail = inputs.find(i => i.type === "email" || i.id === "email" || i.name === "email");
    const hasPass = inputs.find(i => i.type === "password");

    if (!hasEmail && !hasPass) {
      log("RD: no login form found, trying login page button...");
      try {
        await page.goto("https://member.restaurantdepot.com/login", { waitUntil: "domcontentloaded", timeout: 30000 });
      } catch(e) { log(`RD: login page nav error: ${e.message}`); }
      await new Promise(r => setTimeout(r, 4000));
      log(`RD: login page URL=${page.url()}`);

      // Click the SSO button (only button on page)
      await page.evaluate(() => { const b = document.querySelector("button"); if (b) b.click(); });
      log("RD: clicked SSO button");
      await new Promise(r => setTimeout(r, 6000));
      log(`RD: after button click URL=${page.url()}`);

      // Re-check inputs
      const inputs2 = await page.evaluate(() =>
        Array.from(document.querySelectorAll("input")).map(i => ({ type: i.type, name: i.name, id: i.id }))
      );
      log(`RD: inputs after button click: ${JSON.stringify(inputs2)}`);
    }

    // Step 3: Fill credentials wherever the form is
    try {
      await page.waitForSelector('#email, input[type="email"]', { timeout: 15000 });
      await page.click('#email, input[type="email"]');
      await page.keyboard.type(process.env.RD_EMAIL, { delay: 60 });
      log("RD: email typed");
      await page.click('input[type="password"]');
      await page.keyboard.type(process.env.RD_PASSWORD, { delay: 60 });
      log("RD: password typed");
      await page.click('button[type="submit"]');
      log("RD: submit clicked");
    } catch(e) { log(`RD: form fill error: ${e.message}`); }

    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(e => log(`RD: post-login nav: ${e.message}`));
    await new Promise(r => setTimeout(r, 5000));
    log(`RD: after login URL=${page.url()}`);

    // Step 4: Go to order guide
    log("RD: going to order guide...");
    try {
      await page.goto(
        "https://member.restaurantdepot.com/store/business/order-guide/19933806363004568",
        { waitUntil: "domcontentloaded", timeout: 60000 }
      );
    } catch(e) { log(`RD: order guide nav error: ${e.message}`); }
    await new Promise(r => setTimeout(r, 8000));
    log(`RD: order guide URL=${page.url()}, title=${await page.title()}`);

    // Step 5: Wait for items to load, then scroll
    await page.waitForSelector('[class*="product"], [class*="item-card"], [class*="order-guide"]', { timeout: 15000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));

    // Log what's on the page before scrolling
    const rdPageInfo = await page.evaluate(() => ({
      bodyLen: document.body.innerText.length,
      dollarSigns: (document.body.innerText.match(/\$/g) || []).length,
      sample: document.body.innerText.slice(0, 1000),
    }));
    log(`RD: page info before scroll: len=${rdPageInfo.bodyLen} $signs=${rdPageInfo.dollarSigns}`);
    log(`RD: page sample: ${rdPageInfo.sample.slice(0, 300)}`);

    for (let i = 0; i < 40; i++) {
      await page.evaluate(() => window.scrollBy(0, 600));
      await new Promise(r => setTimeout(r, 350));
    }
    await new Promise(r => setTimeout(r, 3000));

    // Step 6: Use innerText line by line - RD prices show as "$36\n24" = $36.24
    const rdLines = await page.evaluate(() => document.body.innerText.split("\n").map(l => l.trim()).filter(l => l));
    log(`RD: ${rdLines.length} lines, sample: ${JSON.stringify(rdLines.slice(0, 20))}`);

    // Find all dollar-sign lines and reconstruct prices
    const items = [];
    const seen = new Set();
    for (let i = 0; i < rdLines.length; i++) {
      const line = rdLines[i];
      let price = null;
      let raw = line;

      // "$31.60 each (est.)" — direct price
      const eachM = line.match(/\$([\d.]+)\s+each/i);
      if (eachM) { price = parseFloat(eachM[1]); }

      // "$7.84-$43.95" — range, use higher (case price)
      const rangeM = line.match(/\$([\d.]+)\s*[-–]\s*\$([\d.]+)/);
      if (rangeM) { price = Math.max(parseFloat(rangeM[1]), parseFloat(rangeM[2])); }

      // "$36" on one line + "24" on next = $36.24
      // OR "$36" alone
      const dollarM = line.match(/^\$([\d]{1,4})$/);
      if (dollarM && i + 1 < rdLines.length) {
        const nextLine = rdLines[i + 1];
        const centsM = nextLine.match(/^(\d{2})\s*$/);
        if (centsM) {
          price = parseFloat(dollarM[1] + "." + centsM[1]);
          raw = line + "." + nextLine;
        }
      }

      // "$  36  24" combined (superscript format)
      const superM = line.match(/\$\s*(\d+)\s+(\d{2})$/);
      if (superM) { price = parseFloat(superM[1] + "." + superM[2]); }

      if (!price || price < 2 || price > 5000) continue;

      // Find product name in surrounding lines
      for (let j = i - 8; j <= i + 8; j++) {
        if (j < 0 || j === i || j >= rdLines.length) continue;
        const c = rdLines[j];
        if (c.length > 8 && c.length < 130 && !seen.has(c) &&
            !/^\$/.test(c) && !/^[\d\s.\-/#x]+$/.test(c) &&
            !/^(Bin|stock|Add|Skip Navigation|Cart|Login|Search|Buy|eligible|Pickup|Delivery|Many|About|See|Back|Order Guides|Products|Equipment|Receipts|Monthly Flyer|Buy It Again|Skip)$/i.test(c) &&
            !/^\d+\s*(oz|lb|gal|ct|#|z)$/i.test(c) &&
            c.split(" ").length >= 2) {
          items.push({ name: c, price, raw });
          seen.add(c);
          break;
        }
      }
    }
    log(`RD: found ${items.length} items. Sample: ${JSON.stringify(items.slice(0, 5))}`);
    return { success: true, items };
  } catch(e) {
    log(`RD: FATAL error: ${e.message}\n${e.stack?.slice(0, 300)}`);
    return { success: false, error: e.message, items: [] };
  } finally {
    if (browser) { try { await browser.close(); } catch(e) {} }
  }
}

// ── Sysco Scraper ─────────────────────────────────────────────────────────────
async function scrapeSysco() {
  log("🔵 Sysco: launching browser...");
  const chromium = require("@sparticuz/chromium");
  const puppeteer = require("puppeteer-core");
  let browser;
  try {
    const execPath = await chromium.executablePath();
    browser = await puppeteer.launch({
      args: [...chromium.args, "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--single-process"],
      executablePath: execPath,
      headless: chromium.headless,
      timeout: 30000,
    });
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36");
    page.setDefaultTimeout(30000);

    // Step 1: Email
    log("Sysco: step 1 - email page...");
    try {
      await page.goto("https://shop.sysco.com/auth/login", { waitUntil: "domcontentloaded", timeout: 30000 });
    } catch(e) { log(`Sysco: login goto error: ${e.message}`); }
    await new Promise(r => setTimeout(r, 3000));
    log(`Sysco: login page URL=${page.url()}`);

    await page.waitForSelector('input[type="email"]', { timeout: 15000 });
    await page.click('input[type="email"]');
    await page.keyboard.type(process.env.SYSCO_EMAIL, { delay: 60 });
    log("Sysco: email typed");

    // Click Next — find by text since it's not type="submit" 
    const clicked = await page.evaluate(() => {
      // Try all buttons, find the one that says "Next"
      const allBtns = Array.from(document.querySelectorAll("button, input[type=submit], [role=button]"));
      const next = allBtns.find(b => (b.textContent || b.value || "").trim().toLowerCase() === "next");
      if (next) { next.click(); return "clicked: " + (next.textContent || next.value); }
      // Fallback: click first button that's not "Become a Customer" or "Continue as Guest"
      const filtered = allBtns.filter(b => {
        const t = (b.textContent || b.value || "").trim().toLowerCase();
        return t && t !== "become a customer" && t !== "continue as guest" && !t.includes("cookie");
      });
      if (filtered[0]) { filtered[0].click(); return "clicked fallback: " + filtered[0].textContent; }
      return null;
    });
    log(`Sysco: Next button click result: ${clicked}`);
    if (!clicked) await page.keyboard.press("Enter");

    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(e => log(`Sysco: next nav: ${e.message}`));
    await new Promise(r => setTimeout(r, 4000));
    log(`Sysco: after Next URL=${page.url()}`);

    // Step 2: Password (Okta at secure.sysco.com)
    log("Sysco: step 2 - password...");
    await page.waitForSelector('#okta-signin-password, input[type="password"]', { timeout: 20000 });
    log(`Sysco: password page URL=${page.url()}`);

    await page.click('#okta-signin-password, input[type="password"]');
    await page.keyboard.type(process.env.SYSCO_PASSWORD, { delay: 60 });
    log("Sysco: password typed");

    const loginBtn = await page.$("#okta-signin-submit") || await page.$('input[type="submit"]') || await page.$('button[type="submit"]');
    if (loginBtn) await loginBtn.click();
    else await page.keyboard.press("Enter");

    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(e => log(`Sysco: login nav: ${e.message}`));
    await new Promise(r => setTimeout(r, 5000));
    log(`Sysco: logged in URL=${page.url()}`);

    if (!page.url().includes("shop.sysco.com")) {
      throw new Error(`Sysco login failed, at: ${page.url()}`);
    }

    // Step 3: Use Sysco's GraphQL API directly to get Nick List items
    // The browser SPA uses # anchors - intercept the API instead
    log("Sysco: fetching lists via API...");

    const syscoLists = await page.evaluate(async () => {
      try {
        // Sysco uses GraphQL at /graphql
        const r = await fetch("/graphql", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            operationName: "GetOrderLists",
            query: `query GetOrderLists { orderLists { id name items { id product { id name brand price { netPrice } } quantity } } }`
          })
        });
        const data = await r.json();
        return JSON.stringify(data);
      } catch(e) { return "error: " + e.message; }
    });
    log(`Sysco: GraphQL lists response: ${syscoLists.slice(0, 500)}`);

    // Also try REST API
    const syscoListsRest = await page.evaluate(async () => {
      try {
        const r = await fetch("/api/v3/orderlists?limit=50", {
          credentials: "include",
          headers: { "Accept": "application/json" }
        });
        const data = await r.json();
        return JSON.stringify(data).slice(0, 1000);
      } catch(e) { return "error: " + e.message; }
    });
    log(`Sysco: REST lists response: ${syscoListsRest}`);

    // Navigate to the lists page and intercept network requests for the list data
    const listDataPromise = new Promise((resolve) => {
      const handler = async (response) => {
        const url = response.url();
        if ((url.includes('/graphql') || url.includes('/api/')) && response.status() === 200) {
          try {
            const txt = await response.text();
            if (txt.includes('orderList') || txt.includes('OrderList') || txt.includes('nick') || txt.includes('Nick')) {
              page.off('response', handler);
              resolve(txt);
            }
          } catch(e) {}
        }
      };
      page.on('response', handler);
      setTimeout(() => { page.off('response', handler); resolve(null); }, 20000);
    });

    // Navigate to lists - the SPA will make API calls we can intercept
    await page.goto("https://shop.sysco.com/app/lists", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(e => log(e.message));
    await new Promise(r => setTimeout(r, 6000));
    log(`Sysco: lists page URL=${page.url()}`);

    // Check for Nick List in sidebar text content (not links)
    const sidebarText = await page.evaluate(() => {
      const sidebar = document.querySelector('[class*="sidebar"], [class*="nav"], [class*="list-nav"], nav, aside');
      return sidebar ? sidebar.innerText : document.body.innerText.slice(0, 2000);
    });
    log(`Sysco: sidebar text: ${sidebarText.slice(0, 400)}`);

    // Click Nick List by finding any element containing "Nick List" text
    const nickClicked = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll("*"));
      for (const el of all) {
        if (el.children.length > 5) continue;
        const t = el.textContent.trim();
        if (t.toLowerCase().includes("nick list") && t.length < 30) {
          el.click();
          return `clicked: ${t} (tag: ${el.tagName})`;
        }
      }
      return null;
    });
    log(`Sysco: Nick List click: ${nickClicked}`);
    await new Promise(r => setTimeout(r, 6000));
    log(`Sysco: after Nick click URL=${page.url()}`);

    // Check intercepted data
    const intercepted = await Promise.race([listDataPromise, new Promise(r => setTimeout(() => r(null), 1000))]);
    if (intercepted) log(`Sysco: intercepted list data: ${intercepted.slice(0, 300)}`);

    // Scroll to load all items
    for (let i = 0; i < 60; i++) {
      await page.evaluate(() => window.scrollBy(0, 500));
      await new Promise(r => setTimeout(r, 200));
    }
    await new Promise(r => setTimeout(r, 3000));

    // Log page state
    const pageState = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      bodyLen: document.body.innerText.length,
      rowCount: document.querySelectorAll("[class*='product-item-row']").length,
      priceCount: document.querySelectorAll("[class*='price-col']").length,
      sample: document.body.innerText.slice(0, 800),
    }));
    log(`Sysco: page state: ${JSON.stringify(pageState)}`);

    // Extract items using ALL strategies
    const items = await page.evaluate(() => {
      const results = [];
      const seen = new Set();

      // Strategy 1: product-item-row with item-details-col and price-col
      document.querySelectorAll("[class*='product-item-row']").forEach(row => {
        const nameEl = row.querySelector("[class*='item-details-col'], [class*='item-desc'], [class*='product-name'], [class*='description']");
        const priceEl = row.querySelector("[class*='price-col'], [class*='price']");
        if (!nameEl || !priceEl) return;
        const name = nameEl.innerText.trim().split("\n")[0].trim();
        const m = priceEl.innerText.match(/\$([\d,]+\.[\d]{2})/);
        if (!m || name.length < 3 || seen.has(name)) return;
        const price = parseFloat(m[1].replace(",", ""));
        if (price > 0 && price < 10000) { results.push({ name, price, src: "strategy1" }); seen.add(name); }
      });

      // Strategy 2: Any CS/Case price in text
      if (results.length < 5) {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const texts = [];
        while (walker.nextNode()) { const t = walker.currentNode.textContent.trim(); if (t) texts.push(t); }
        for (let i = 0; i < texts.length; i++) {
          const t = texts[i];
          // "$76.30 CS" or "$11.31 CS" or "$26.05 CS"
          const m = t.match(/\$([\d,]+\.[\d]{2})\s*CS\b/) || t.match(/\$([\d,]+\.[\d]{2})\s*Case\b/i);
          if (!m) continue;
          const price = parseFloat(m[1].replace(",", ""));
          if (price < 1 || price > 10000) continue;
          for (let j = i - 8; j <= i + 3; j++) {
            if (j < 0 || j === i || j >= texts.length) continue;
            const c = texts[j];
            if (c.length > 5 && c.length < 150 && !seen.has(c) &&
                !/^\$/.test(c) && !/^[\d\s.,]+$/.test(c) &&
                !/^(N\/A|CS|Case|Add|Remove|Out of stock|Find similar|Order Qty|Last Order|Item Details|Price|Total|Share|Settings|Delete|#|\d+)$/.test(c) &&
                c.split(" ").length >= 2) {
              results.push({ name: c, price, src: "strategy2" });
              seen.add(c);
              break;
            }
          }
        }
      }
      return results;
    });

    log(`Sysco: extracted ${items.length} items. Sample: ${JSON.stringify(items.slice(0, 5))}`);
    return { success: true, items };
  } catch(e) {
    log(`Sysco: FATAL error: ${e.message}\n${e.stack?.slice(0, 300)}`);
    return { success: false, error: e.message, items: [] };
  } finally {
    if (browser) { try { await browser.close(); } catch(e) {} }
  }
}

// ── Run scrape ────────────────────────────────────────────────────────────────
function withTimeout(p, ms, name) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${name} timed out after ${ms/1000}s`)), ms))]);
}

async function runScrape(source = "all") {
  if (source === "rd" || source === "all") {
    try {
      const result = await withTimeout(scrapeRD(), 180000, "RD");
      if (result.success && result.items.length > 0) {
        const matched = await matchWithAI(result.items, "Restaurant Depot");
        matched.forEach(({ id, price }) => { priceStore.rd[id] = { price, date: new Date().toISOString() }; });
        log(`✅ RD: ${matched.length} prices saved (${result.items.length} raw items)`);
      } else { log(`❌ RD: no items found`); }
    } catch(e) { log(`❌ RD failed: ${e.message}`); }
  }

  if (source === "sysco" || source === "all") {
    try {
      const result = await withTimeout(scrapeSysco(), 180000, "Sysco");
      if (result.success && result.items.length > 0) {
        const matched = await matchWithAI(result.items, "Sysco");
        matched.forEach(({ id, price }) => { priceStore.sysco[id] = { price, date: new Date().toISOString() }; });
        log(`✅ Sysco: ${matched.length} prices saved (${result.items.length} raw items)`);
      } else { log(`❌ Sysco: no items found. Error: ${result.error || "unknown"}`); }
    } catch(e) { log(`❌ Sysco failed: ${e.message}`); }
  }

  priceStore.lastUpdated = new Date().toISOString();
}

// ── API routes ────────────────────────────────────────────────────────────────
app.get("/api/prices", (req, res) => res.json(priceStore));
app.get("/api/status", (req, res) => res.json({
  status: "running",
  lastUpdated: priceStore.lastUpdated,
  rdItems: Object.keys(priceStore.rd).length,
  syscoItems: Object.keys(priceStore.sysco).length,
  log: priceStore.log.slice(0, 30),
}));
app.get("/api/trigger", (req, res) => {
  const src = req.query.source || "all";
  res.json({ message: `Scraping ${src}...` });
  runScrape(src).catch(e => log(`Trigger error: ${e.message}`));
});
app.post("/api/scrape", (req, res) => {
  const src = req.body?.source || "all";
  res.json({ message: `Scraping ${src}...` });
  runScrape(src).catch(e => log(`Scrape error: ${e.message}`));
});

// Manual price update from app
app.post("/api/prices", (req, res) => {
  const { source, id, price } = req.body;
  if (!source || !id || !price) return res.status(400).json({ error: "Missing source/id/price" });
  priceStore[source][id] = { price, date: new Date().toISOString() };
  res.json({ ok: true });
});

// Grocery list breakdown
app.post("/api/grocery", async (req, res) => {
  const { list } = req.body;
  if (!list) return res.status(400).json({ error: "No list provided" });
  try {
    const context = ITEMS.map(item => {
      const rd = priceStore.rd[item.id];
      const sc = priceStore.sysco[item.id];
      const best = !rd && !sc ? "?" : !rd ? "SYSCO" : !sc ? "RD" : rd.price <= sc.price ? "RD" : "SYSCO";
      return `${item.name}: RD=$${rd?.price || "?"} Sysco=$${sc?.price || "?"} → ${best}`;
    }).filter(l => !l.includes("RD=$?") || !l.includes("Sysco=$?")).join("\n");

    const prompt = `You are the purchasing assistant for Naan & Curry restaurant Las Vegas.
Current pricing:\n${context || "No prices loaded yet"}\n
Chef order list:\n${list}\n
Break this down by vendor. Be concise.\n
🟢 ORDER FROM RESTAURANT DEPOT:\n- [item] — $[price]/case\n
🔵 ORDER FROM SYSCO:\n- [item] — $[price]/case\n
⚠️ CHECK MANUALLY:\n- [item]\n
💰 Estimated: RD $[X] + Sysco $[Y] = $[total]`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await r.json();
    res.json({ result: data.content?.find(b => b.type === "text")?.text || "Error" });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/browser-test", async (req, res) => {
  try {
    const chromium = require("@sparticuz/chromium");
    const puppeteer = require("puppeteer-core");
    const execPath = await chromium.executablePath();
    const browser = await puppeteer.launch({
      args: [...chromium.args, "--no-sandbox", "--disable-setuid-sandbox", "--single-process"],
      executablePath: execPath, headless: chromium.headless,
    });
    const page = await browser.newPage();
    await page.goto("https://example.com", { waitUntil: "domcontentloaded", timeout: 15000 });
    const title = await page.title();
    await browser.close();
    res.json({ success: true, title, execPath });
  } catch(e) { res.json({ success: false, error: e.message }); }
});

// Daily scrape 6am Las Vegas (1pm UTC)
cron.schedule("0 13 * * *", () => { log("⏰ Daily scrape..."); runScrape("all").catch(console.error); });

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "../build/index.html")));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  log(`🚀 Server on port ${PORT}`);
  setTimeout(() => runScrape("all").catch(console.error), 15000);
});
