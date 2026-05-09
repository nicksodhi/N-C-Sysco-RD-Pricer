require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const cron = require("node-cron");

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "../build")));

// ── Price store ───────────────────────────────────────────────────────────────
let priceStore = { rd: {}, sysco: {}, lastUpdated: null, log: [] };
const log = (msg) => {
  console.log(msg);
  priceStore.log.unshift({ time: new Date().toISOString(), msg });
  if (priceStore.log.length > 500) priceStore.log.pop();
};

// ── RD Items: exact Item IDs from order guide PDF ─────────────────────────────
const RD_ITEMS = [
  { id: "860135",  name: "Isabella - Petite Diced Tomatoes -#10 cans" },
  { id: "860043",  name: "Chef's Quality - Tomato Puree - 6 lb Can" },
  { id: "860044",  name: "Chef's Quality - Tomato Sauce - #10 cans" },
  { id: "45900",   name: "Chef's Quality - White Vinegar - gallon" },
  { id: "12728",   name: "Chef's Quality - All Purpose Pan Spray - 17 oz" },
  { id: "1020152", name: "Chef's Quality - Liquid Butter Alternative - gallon" },
  { id: "1020079", name: "Chef's Quality - 100% Canola Salad Oil - 35 lbs" },
  { id: "1020077", name: "Chef's Quality - Clear Liquid Fry Oil - 35 lbs" },
  { id: "25267",   name: "Athena - Fire Roasted Grilled Eggplant Pulp - 2 kg" },
  { id: "16200",   name: "Chef's Quality - Garbanzo Beans - #10 can" },
  { id: "69810",   name: "Chef's Quality - Dark Red Kidney Beans - #10 cans" },
  { id: "1070125", name: "Dry Chile Japones - 5 lb" },
  { id: "490266",  name: "Royal Chef's Secret - Extra Long Grain Basmati Rice - 40 lbs" },
  { id: "2620442", name: "A ROY-D - COCONUT MILK REGULAR - 400ML" },
  { id: "13417",   name: "Huy Fong - Sambal Olek - 3/136 oz" },
  { id: "2550014", name: "Felbro - Red Food Coloring - gallon" },
  { id: "2550012", name: "Felbro - Egg Yellow Food Coloring - gallon" },
  { id: "1070496", name: "Morton - Purex Salt - 50lb" },
  { id: "21051",   name: "C&H - Granulated Sugar - 25 lbs" },
  { id: "2910159", name: "Clabber Girl Cornstarch - 3 lbs" },
  { id: "29268",   name: "Clabber Girl - Baking Powder - 5 lbs" },
  { id: "2061212", name: "Chef's Quality - All Purpose Flour - 25 lb Bag" },
  { id: "53556",   name: "Golden Temple - Durum Atta Flour - 2/20 lb Bag" },
  { id: "69778",   name: "Rice Flour - 50 lbs" },
  { id: "440039",  name: "Diet Coke Bottles 16.9 fl oz 24 Pack" },
  { id: "440040",  name: "Sprite Bottles 16.9 fl oz 4 Pack" },
  { id: "440038",  name: "Coca-Cola Bottles 16.9 fl oz 24 Pack" },
  { id: "55523",   name: "Chef's Quality - Lemon Juice - gallon" },
  { id: "1440528", name: "Royal Mahout - Paneer Loaf - 5 lbs" },
  { id: "1440203", name: "James Farm - Fancy Shredded Cheddar Jack Cheese - 5 lbs" },
  { id: "370496",  name: "MILK WHL GAL GS/AN" },
  { id: "1530438", name: "James Farm - Heavy Cream 40% - 64 oz" },
  { id: "14785",   name: "James Farm - Plain Yogurt - 32 lbs" },
  { id: "40212",   name: "SHRP P&D TF 16-20 FROZEN SEAFOOD" },
  { id: "51457",   name: "Frozen Tilapia Fillets - 3-5 oz - 10 lbs" },
  { id: "64120",   name: "Frozen James Farm - IQF Broccoli Florets - 2 lbs" },
  { id: "64046",   name: "Frozen James Farm - Frozen Chopped Spinach - 3 lbs" },
  { id: "86525",   name: "Frozen James Farm - IQF Peas - 2.5 lbs" },
  { id: "86527",   name: "Frozen James Farm - IQF Mixed Vegetables - 2.5 lbs" },
  { id: "44211",   name: "Cleaned Spinach - 2.5 lbs" },
  { id: "44137",   name: "Serrano Peppers" },
  { id: "42570",   name: "Lemons 71-115 ct" },
  { id: "42513",   name: "Fresh Ginger - 30 lbs" },
  { id: "44146",   name: "Peeled Garlic" },
  { id: "42504",   name: "Cucumbers - 6 ct" },
  { id: "42606",   name: "White Cauliflower" },
  { id: "43431",   name: "Green Bell Peppers - 9 ct" },
  { id: "42566",   name: "Taylor Farms - Bagged Cilantro" },
  { id: "42647",   name: "Herb - Mint - 1 lb" },
  { id: "55519",   name: "Micro Orchid Flowers - 4 oz" },
  { id: "42725",   name: "Russet Potato - 50 lb" },
  { id: "42545",   name: "Jumbo Spanish Onions - 50 lbs" },
  { id: "42658",   name: "Jumbo Red Onions - 25 lbs" },
  { id: "77200",   name: "Jumbo Chicken Party Wings 6-8 ct" },
  { id: "77670",   name: "Fresh Chicken Leg Quarters - 40 lbs" },
  { id: "77658",   name: "Fresh Boneless Skinless Chicken Leg Meat" },
  { id: "77232",   name: "Boneless Skinless Chicken Breasts" },
  { id: "79152",   name: "Carrots - 10 lb" },
  { id: "1810019", name: "Thomas Farms - Bone in Goat Cube - #15" },
  { id: "79042",   name: "Frozen Halal Boneless Lamb Leg Australia" },
  { id: "21039",   name: "Evian - Natural Spring Water 24 Ct" },
];

// ── Sysco Nick List: exact Sysco UPCs from Nick List PDF ─────────────────────
// Prices from Sysco PDF: CS = case price
const SYSCO_ITEMS = [
  { id: "1048222", name: "Onion Yellow Jumbo Bag",                        pack: "1/25 LB" },
  { id: "8053456", name: "Chicken Cvp Thighs Boneless Skinless Frozen",   pack: "4/10 LB" },
  { id: "4418117", name: "Chicken Legs Quarters Jumbo Controlled Vacuum", pack: "1/40LB"  },
  { id: "1803287", name: "Chicken Cvp Leg Quarter Small Halal",           pack: "4/10LB"  },
  { id: "0868459", name: "Chicken Cvp Leg Meat Boneless Skinless",        pack: "4/10 LB" },
  { id: "8379251", name: "Flour All Purpose Hotel Restaurant Bleached",   pack: "1/25LB"  },
  { id: "4002325", name: "Tomato Puree 1.06 Fancy California",            pack: "6/#10"   },
  { id: "6935464", name: "Cream Heavy 40% Extended Shelf Life",           pack: "12/32OZ" },
  { id: "4676306", name: "Milk Whole Gallon",                             pack: "4/1 GAL" },
  { id: "4119079", name: "Oil Soybean Vegetable Pure",                    pack: "1/35LB"  },
  { id: "5087572", name: "Sugar Granulated Extra Fine Cane",              pack: "1/25LB"  },
  { id: "4518403", name: "Shortening Fry Liquid Clear Zero Trans Fat",    pack: "1/35LB"  },
  { id: "3355757", name: "Butter-it Alternative Liquid Zero Trans Fat",   pack: "3/1 GAL" },
  { id: "4063095", name: "Juice Lemon Pasteurized Ultra Premium",         pack: "6/.5 GAL"},
  { id: "1543164", name: "Potato Baking Russet 40 Count Fresh",          pack: "1/50LB"  },
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
    return res.status(r.status).json(await r.json());
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// ── AI price matching ─────────────────────────────────────────────────────────
async function matchWithAI(scrapedItems, itemList, source) {
  if (!scrapedItems.length) return [];
  const list = itemList.map(i => i.id + ": " + i.name).join("\n");
  const scraped = scrapedItems.slice(0, 100).map(i => i.name + ": $" + i.price).join("\n");
  const prompt = "Match these " + source + " grocery items to our product list.\n\nSCRAPED:\n" + scraped + "\n\nOUR LIST:\n" + list + "\n\nReturn ONLY JSON array:\n[{\"id\":\"ITEM_ID\",\"price\":0.00}]\nOnly confident matches. Exact IDs from list.";
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
  } catch(e) { log("AI error: " + e.message); return []; }
}

// ── Browser launch ────────────────────────────────────────────────────────────
async function launchBrowser() {
  const chromium = require("@sparticuz/chromium");
  const puppeteer = require("puppeteer-core");
  const execPath = await chromium.executablePath();
  return puppeteer.launch({
    args: [...chromium.args, "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--single-process"],
    executablePath: execPath,
    headless: chromium.headless,
    timeout: 30000,
  });
}

// ── RD Scraper ────────────────────────────────────────────────────────────────
// Key insight from logs: RD renders prices as "$3806" (no decimal) on the line AFTER
// "Current price: $38.06". The CORRECT price is always in "Current price: $XX.XX" format.
// These are the actual order guide prices — use them directly.
async function scrapeRD() {
  log("🟢 RD: starting...");
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36");
    page.setDefaultTimeout(30000);

    // Login via SSO
    await page.goto(
      "https://member.restaurantdepot.com/rest/sso/auth/restaurantdepot/init?return_to=https%3A%2F%2Fwww.restaurantdepot.com%2F",
      { waitUntil: "domcontentloaded", timeout: 45000 }
    ).catch(e => log("RD SSO: " + e.message));
    await new Promise(r => setTimeout(r, 5000));

    await page.waitForSelector('#email, input[type="email"]', { timeout: 20000 });
    await page.click('#email, input[type="email"]');
    await page.keyboard.type(process.env.RD_EMAIL, { delay: 50 });
    await page.click('input[type="password"]');
    await page.keyboard.type(process.env.RD_PASSWORD, { delay: 50 });
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));
    log("RD: logged in, URL=" + page.url());

    // Go to order guide
    await page.goto(
      "https://member.restaurantdepot.com/store/business/order-guide/19933806363004568",
      { waitUntil: "domcontentloaded", timeout: 60000 }
    ).catch(e => log("RD order guide: " + e.message));
    await new Promise(r => setTimeout(r, 8000));
    log("RD: order guide loaded, URL=" + page.url());

    // Scroll top-to-bottom to load all items
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(r => setTimeout(r, 1000));
    for (let i = 0; i < 50; i++) {
      await page.evaluate(() => window.scrollBy(0, 500));
      await new Promise(r => setTimeout(r, 300));
    }
    await new Promise(r => setTimeout(r, 3000));

    // Extract all lines
    const lines = await page.evaluate(() =>
      document.body.innerText.split("\n").map(l => l.trim()).filter(l => l.length > 0)
    );
    log("RD: " + lines.length + " lines total");

    // Parse: "Current price: $38.06" → price=38.06
    // "Current price: $286.24 each (estimated)" → price=286.24
    // Find product name in surrounding lines by matching to our known item list
    const priceLines = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = line.match(/Current price:\s*\$([\d,]+\.[\d]{2})/i);
      if (!m) continue;
      const price = parseFloat(m[1].replace(",", ""));
      if (price < 0.5 || price > 5000) continue;
      // Collect context: 15 lines before and after
      const ctx = lines.slice(Math.max(0, i - 15), Math.min(lines.length, i + 15));
      priceLines.push({ price, raw: line, ctx: ctx.join(" | ") });
    }
    log("RD: found " + priceLines.length + " price lines");
    log("RD: contexts: " + JSON.stringify(priceLines.slice(0, 5)));

    // Build items: match each price to nearest product name from context
    // Skip navigation noise
    const noiseWords = new Set(["Skip Navigation","Buy It Again","Order Guides","Products","Equipment",
      "Receipts","Monthly Flyer","Back to Home","Many in stock","Add","Skip","Show similar","Back",
      "Las Vegas","Pickup","Delivery","Order history","Account settings","Addresses","Payment methods",
      "Credits and promos","Your saved lists","Notification settings","Out of stock","Buy It Again",
      "See eligible items","Explore popular"]);

    const items = [];
    const seen = new Set();

    for (const pl of priceLines) {
      const ctxLines = pl.ctx.split(" | ").map(l => l.trim()).filter(l => l);
      // Find the best candidate name: longest line that looks like a product
      let bestName = null;
      for (const c of ctxLines) {
        if (noiseWords.has(c)) continue;
        if (c.length < 8 || c.length > 120) continue;
        if (/^\$/.test(c)) continue;
        if (/^[\d\s.\-/#x]+$/.test(c)) continue;
        if (/^\d+\s*(oz|lb|gal|ct|#|z|lbs)\s*$/i.test(c)) continue;
        if (/^(Current price|Buy \d|Pickup ready|Out of stock|Show similar|See eligible|Buy It Again)/.test(c)) continue;
        if (/arrow keys|search field|Once you press|navigate to|Enter key/i.test(c)) continue;
        if (!/[a-zA-Z]{3,}/.test(c)) continue;
        if (c.split(" ").length < 2) continue;
        if (!seen.has(c)) { bestName = c; break; }
      }
      if (bestName && pl.price > 0) {
        items.push({ name: bestName, price: pl.price, raw: pl.raw });
        seen.add(bestName);
      }
    }

    log("RD: " + items.length + " items extracted: " + JSON.stringify(items.slice(0, 10)));
    return { success: true, items };
  } catch(e) {
    log("RD FATAL: " + e.message);
    return { success: false, error: e.message, items: [] };
  } finally {
    if (browser) { try { await browser.close(); } catch(e) {} }
  }
}

// ── Sysco Scraper ─────────────────────────────────────────────────────────────
// Key insight from PDF: Nick List has 15 items, prices show as "$29.99 CS"
// The scraper lands on items 13-15 because the list is already scrolled to bottom.
// Fix: scroll to TOP after clicking Nick List, then extract from top.
async function scrapeSysco() {
  log("🔵 Sysco: starting...");
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36");
    page.setDefaultTimeout(30000);

    // Step 1: Email
    await page.goto("https://shop.sysco.com/auth/login", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));
    await page.waitForSelector('input[type="email"]', { timeout: 15000 });
    await page.click('input[type="email"]');
    await page.keyboard.type(process.env.SYSCO_EMAIL, { delay: 50 });
    const nextOk = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, [role=button]"));
      const next = btns.find(b => b.textContent.trim().toLowerCase() === "next");
      if (next) { next.click(); return true; }
      return false;
    });
    if (!nextOk) await page.keyboard.press("Enter");
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));
    log("Sysco: after Next=" + page.url());

    // Step 2: Password (Okta)
    await page.waitForSelector('#okta-signin-password, input[type="password"]', { timeout: 20000 });
    await page.click('#okta-signin-password, input[type="password"]');
    await page.keyboard.type(process.env.SYSCO_PASSWORD, { delay: 50 });
    const loginBtn = await page.$("#okta-signin-submit") || await page.$('input[type="submit"]') || await page.$('button[type="submit"]');
    if (loginBtn) await loginBtn.click();
    else await page.keyboard.press("Enter");
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 4000));
    log("Sysco: logged in=" + page.url());
    if (!page.url().includes("shop.sysco.com")) throw new Error("Login failed: " + page.url());

    // Step 3: Go to lists
    await page.goto("https://shop.sysco.com/app/lists", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 5000));
    log("Sysco: lists page=" + page.url());

    // Click Nick List
    const nickClicked = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll("*"));
      for (const el of all) {
        if (el.children.length > 5) continue;
        const t = el.textContent.trim();
        if (t.toLowerCase().includes("nick list") && t.length < 30) {
          el.click();
          return el.tagName + ": " + t;
        }
      }
      return null;
    });
    log("Sysco: Nick List click=" + nickClicked);

    // Wait for content to load — watch row count
    let rows = 0;
    for (let w = 0; w < 20; w++) {
      await new Promise(r => setTimeout(r, 1000));
      rows = await page.evaluate(() => document.querySelectorAll("[class*='product-item-row']").length);
      if (rows > 0) { log("Sysco: rows loaded=" + rows + " after " + w + "s"); break; }
    }

    // CRITICAL: Scroll to TOP first (list may be pre-scrolled to bottom)
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(r => setTimeout(r, 2000));

    // Now scroll down slowly to load all items via infinite scroll
    let prevRows = 0;
    for (let s = 0; s < 30; s++) {
      rows = await page.evaluate(() => document.querySelectorAll("[class*='product-item-row']").length);
      log("Sysco: scroll " + s + " rows=" + rows);
      if (rows === prevRows && s > 5) break;
      prevRows = rows;
      await page.evaluate(() => window.scrollBy(0, 800));
      await new Promise(r => setTimeout(r, 800));
    }
    log("Sysco: final rows=" + rows + " url=" + page.url());

    // Extract using exact Sysco CSS classes: item-details-col + price-col
    const items = await page.evaluate(() => {
      const results = [];
      const seen = new Set();
      document.querySelectorAll("[class*='product-item-row']").forEach(row => {
        // Get name from item-details-col (first line only)
        const nameEl = row.querySelector("[class*='item-details-col']");
        // Get price from price-col — format is "$29.99 CS" or "$34.27 CS"
        const priceEl = row.querySelector("[class*='price-col']");
        if (!nameEl || !priceEl) return;
        const name = nameEl.innerText.trim().split("\n")[0].trim();
        const priceText = priceEl.innerText.trim();
        // Match "$29.99 CS" — take the CS (case) price, not EA price
        const csMatch = priceText.match(/\$([\d,]+\.[\d]{2})\s*CS/i);
        // If no CS price, take first price
        const anyMatch = priceText.match(/\$([\d,]+\.[\d]{2})/);
        const m = csMatch || anyMatch;
        if (!m || name.length < 3 || seen.has(name)) return;
        const price = parseFloat(m[1].replace(",", ""));
        if (price > 0 && price < 10000) {
          results.push({ name, price, raw: priceText });
          seen.add(name);
        }
      });
      return results;
    });

    log("Sysco: " + items.length + " items: " + JSON.stringify(items));
    return { success: true, items };
  } catch(e) {
    log("Sysco FATAL: " + e.message);
    return { success: false, error: e.message, items: [] };
  } finally {
    if (browser) { try { await browser.close(); } catch(e) {} }
  }
}

// ── Run scrape ────────────────────────────────────────────────────────────────
function withTimeout(p, ms, name) {
  return Promise.race([p, new Promise((_, rej) =>
    setTimeout(() => rej(new Error(name + " timed out")), ms))]);
}

async function runScrape(source = "all") {
  if (source === "rd" || source === "all") {
    try {
      const result = await withTimeout(scrapeRD(), 180000, "RD");
      if (result.success && result.items.length > 0) {
        const matched = await matchWithAI(result.items, RD_ITEMS, "Restaurant Depot");
        matched.forEach(({ id, price }) => {
          if (id && price > 0) priceStore.rd[id] = { price, date: new Date().toISOString() };
        });
        log("✅ RD: " + matched.length + " prices saved (" + result.items.length + " raw)");
      } else { log("❌ RD: " + (result.error || "no items")); }
    } catch(e) { log("❌ RD: " + e.message); }
  }

  if (source === "sysco" || source === "all") {
    try {
      const result = await withTimeout(scrapeSysco(), 180000, "Sysco");
      if (result.success && result.items.length > 0) {
        const matched = await matchWithAI(result.items, SYSCO_ITEMS, "Sysco Nick List");
        matched.forEach(({ id, price }) => {
          if (id && price > 0) priceStore.sysco[id] = { price, date: new Date().toISOString() };
        });
        log("✅ Sysco: " + matched.length + " prices saved (" + result.items.length + " raw)");
      } else { log("❌ Sysco: " + (result.error || "no items")); }
    } catch(e) { log("❌ Sysco: " + e.message); }
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
  log: priceStore.log.slice(0, 200),
}));
app.get("/api/trigger", (req, res) => {
  const src = req.query.source || "all";
  res.json({ message: "Scraping " + src });
  runScrape(src).catch(e => log("Trigger: " + e.message));
});
app.post("/api/scrape", (req, res) => {
  const src = req.body?.source || "all";
  res.json({ message: "Scraping " + src });
  runScrape(src).catch(e => log("Scrape: " + e.message));
});

// Grocery breakdown
app.post("/api/grocery", async (req, res) => {
  const { list } = req.body;
  if (!list) return res.status(400).json({ error: "No list" });
  try {
    const rdCtx = RD_ITEMS.map(i => {
      const p = priceStore.rd[i.id];
      return p ? i.name + ": $" + p.price + " (RD)" : null;
    }).filter(Boolean).join("\n");
    const scCtx = SYSCO_ITEMS.map(i => {
      const p = priceStore.sysco[i.id];
      return p ? i.name + " " + i.pack + ": $" + p.price + " (Sysco)" : null;
    }).filter(Boolean).join("\n");
    const prompt = "Purchasing assistant for Naan & Curry Las Vegas.\n\nRD PRICES:\n" + (rdCtx || "none") + "\n\nSYSCO PRICES:\n" + (scCtx || "none") + "\n\nOrder list:\n" + list + "\n\nBreak down by vendor:\n🟢 ORDER FROM RESTAURANT DEPOT:\n- item — $price\n\n🔵 ORDER FROM SYSCO:\n- item — $price\n\n⚠️ CHECK MANUALLY:\n- item\n\n💰 RD $X + Sysco $Y = $total";
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
    const browser = await launchBrowser();
    const page = await browser.newPage();
    await page.goto("https://example.com", { waitUntil: "domcontentloaded", timeout: 15000 });
    const title = await page.title();
    await browser.close();
    res.json({ success: true, title });
  } catch(e) { res.json({ success: false, error: e.message }); }
});

// Daily 6am Las Vegas = 1pm UTC
cron.schedule("0 13 * * *", () => { log("⏰ Daily"); runScrape("all").catch(console.error); });

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "../build/index.html")));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  log("🚀 Server port " + PORT);
  setTimeout(() => runScrape("all").catch(console.error), 15000);
});
