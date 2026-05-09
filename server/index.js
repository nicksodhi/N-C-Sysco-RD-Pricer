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

// ── EXACT item lists from PDFs ────────────────────────────────────────────────
// RD items: Item ID from order guide PDF
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
  { id: "440039",  name: "Diet Coke Bottles - 24 Pack" },
  { id: "440040",  name: "Sprite Bottles - 4 Pack" },
  { id: "440038",  name: "Coca-Cola Bottles - 24 Pack" },
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
  { id: "490219",  name: "Royal Sela Basmati Rice - 40 lbs" },
  { id: "77595",   name: "Chicken Thigh Meat Frozen" },
  { id: "77597",   name: "Chicken Leg Meat Frozen Marinated" },
];

// Sysco Nick List items: Sysco UPC from Nick List PDF
const SYSCO_ITEMS = [
  { id: "1048222", name: "Onion Yellow Jumbo Bag", pack: "1/25 LB" },
  { id: "8053456", name: "Chicken Cvp Thighs Boneless - Skinless Frozen", pack: "4/10 LB" },
  { id: "4418117", name: "Chicken Legs Quarters Jumbo Controlled Vacuum", pack: "1/40LB" },
  { id: "1803287", name: "Chicken Cvp Leg Quarter Small Halal", pack: "4/10LB" },
  { id: "0868459", name: "Chicken Cvp Leg Meat Boneless Skinless", pack: "4/10 LB" },
  { id: "8379251", name: "Flour All Purpose Hotel & Restaurant Bleached", pack: "1/25LB" },
  { id: "4002325", name: "Tomato Puree 1.06 Fancy California", pack: "6/#10" },
  { id: "6935464", name: "Cream Heavy 40% Extended Shelf Life Stabilized", pack: "12/32OZ" },
  { id: "4676306", name: "Milk Whole Gallon", pack: "4/1 GAL" },
  { id: "4119079", name: "Oil Soybean Vegetable Pure", pack: "1/35LB" },
  { id: "5087572", name: "Sugar Granulated Extra Fine Cane", pack: "1/25LB" },
  { id: "4518403", name: "Shortening Fry Liquid Clear Zero Trans Fat", pack: "1/35LB" },
  { id: "3355757", name: "Butter-it Alternative Liquid Zero Trans Fat", pack: "3/1 GAL" },
  { id: "4063095", name: "Juice Lemon Pasteurized Ultra Premium", pack: "6/.5 GAL" },
  { id: "1543164", name: "Potato Baking Russet 40 Count Fresh", pack: "1/50LB" },
];

// Combined list for grocery matching (both vendors)
const ALL_ITEMS = [
  ...RD_ITEMS.map(i => ({ ...i, vendor: "rd" })),
  ...SYSCO_ITEMS.map(i => ({ ...i, vendor: "sysco" })),
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
async function matchWithAI(scrapedItems, itemList, source) {
  if (!scrapedItems.length) return [];
  const list = itemList.map(i => `${i.id}: ${i.name}`).join("\n");
  const scraped = scrapedItems.slice(0, 100).map(i => `${i.name}: $${i.price}`).join("\n");
  const prompt = `Match these ${source} grocery items to our exact product list. Only match if very confident it is the same product.

SCRAPED ITEMS:\n${scraped}

OUR PRODUCT LIST (id: name):\n${list}

Return ONLY a JSON array, no markdown:
[{"id":"ITEM_ID","price":0.00,"matched":"scraped name"}]`;
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
  } catch(e) { log("AI match error: " + e.message); return []; }
}

// ── Browser launch ────────────────────────────────────────────────────────────
async function launchBrowser() {
  const chromium = require("@sparticuz/chromium");
  const puppeteer = require("puppeteer-core");
  const execPath = await chromium.executablePath();
  log("Browser: " + execPath);
  return puppeteer.launch({
    args: [...chromium.args, "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--single-process"],
    executablePath: execPath,
    headless: chromium.headless,
    timeout: 30000,
  });
}

// ── RD Scraper ────────────────────────────────────────────────────────────────
async function scrapeRD() {
  log("🟢 RD: starting...");
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36");
    page.setDefaultTimeout(30000);

    // Login via SSO
    log("RD: SSO login...");
    await page.goto(
      "https://member.restaurantdepot.com/rest/sso/auth/restaurantdepot/init?return_to=https%3A%2F%2Fwww.restaurantdepot.com%2F",
      { waitUntil: "domcontentloaded", timeout: 45000 }
    ).catch(e => log("RD SSO nav: " + e.message));
    await new Promise(r => setTimeout(r, 5000));
    log("RD: URL=" + page.url());

    await page.waitForSelector('#email, input[type="email"]', { timeout: 20000 });
    await page.click('#email, input[type="email"]');
    await page.keyboard.type(process.env.RD_EMAIL, { delay: 50 });
    await page.click('input[type="password"]');
    await page.keyboard.type(process.env.RD_PASSWORD, { delay: 50 });
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(e => log("RD login nav: " + e.message));
    await new Promise(r => setTimeout(r, 4000));
    log("RD: after login=" + page.url());

    // Go to order guide
    await page.goto(
      "https://member.restaurantdepot.com/store/business/order-guide/19933806363004568",
      { waitUntil: "domcontentloaded", timeout: 60000 }
    ).catch(e => log("RD order guide nav: " + e.message));
    await new Promise(r => setTimeout(r, 8000));
    log("RD: order guide=" + page.url());

    // Scroll to load all items
    for (let i = 0; i < 40; i++) {
      await page.evaluate(() => window.scrollBy(0, 600));
      await new Promise(r => setTimeout(r, 350));
    }
    await new Promise(r => setTimeout(r, 3000));

    // Get all lines and log dollar lines for debugging
    const lines = await page.evaluate(() => document.body.innerText.split("\n").map(l => l.trim()).filter(l => l));
    log("RD: " + lines.length + " lines, $-lines: " + JSON.stringify(
      lines.map((l, i) => ({ i, l })).filter(({ l }) => l.includes("$")).slice(0, 40)
    ));

    // Parse prices: RD shows "$36" on one line, "24" cents on next = $36.24
    // Also "Current price: $36.24 each (estimated)" and "$7.84-$43.95" ranges
    const items = [];
    const seen = new Set();
    const skipSet = new Set([
      "Skip Navigation","Buy It Again","Order Guides","Products","Equipment","Receipts",
      "Monthly Flyer","Back to Home","Many in stock","Add","Skip","Show similar",
      "Back","Las Vegas","Pickup","Delivery","Order history","Account settings",
      "Addresses","Payment methods","Credits and promos","Your saved lists",
      "Notification settings","0","Explore popular searches with arrow keys or begin typing in the search field, and the app will offer suggestions. Use the arrow keys to navigate to a suggestion and then use the Enter key to select it. Once you press Enter, navigate to the search results that appear."
    ]);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let price = null;
      let raw = line;

      // "Current price: $36.24 each (estimated)"
      const eachM = line.match(/\$([\d,]+\.[\d]{2})\s+each/i);
      if (eachM) price = parseFloat(eachM[1].replace(",", ""));

      // "$7.84-$43.95" range → use higher (case price)
      const rangeM = line.match(/\$([\d]+\.[\d]{2})\s*[-–]\s*\$([\d]+\.[\d]{2})/);
      if (rangeM) price = Math.max(parseFloat(rangeM[1]), parseFloat(rangeM[2]));

      // "$36" alone → next line "24" = $36.24
      if (!price) {
        const dolM = line.match(/^\$([\d]{1,4})$/);
        if (dolM) {
          for (let k = i + 1; k <= Math.min(i + 3, lines.length - 1); k++) {
            const cM = lines[k].match(/^(\d{2})$/);
            if (cM) { price = parseFloat(dolM[1] + "." + cM[1]); raw = "$" + dolM[1] + "." + cM[1]; break; }
          }
        }
      }

      if (!price || price < 1 || price > 2000) continue;

      // Find product name in ±15 surrounding lines
      for (let j = i - 15; j <= i + 15; j++) {
        if (j < 0 || j >= lines.length) continue;
        const c = lines[j];
        if (seen.has(c) || skipSet.has(c)) continue;
        if (c.length < 5 || c.length > 150) continue;
        if (/^\$/.test(c)) continue;
        if (/^[\d\s.\-/#x]+$/.test(c)) continue;
        if (/^\d+\s*(oz|lb|gal|ct|#|z|lbs|x\s*\d)\s*$/i.test(c)) continue;
        if (/^(Bin|Bin -|Many|About|See eligible|Show similar|Current price|Buy \d|Pickup ready|Order history|Account)/.test(c)) continue;
        if (/arrow keys|search field|suggestions|navigate|Enter key|Once you|app will/i.test(c)) continue;
        if (!/[a-zA-Z]{3,}/.test(c)) continue;
        if (c.split(" ").length < 2) continue;
        items.push({ name: c, price, raw });
        seen.add(c);
        break;
      }
    }

    log("RD: found " + items.length + " items: " + JSON.stringify(items.slice(0, 8)));
    return { success: true, items };
  } catch(e) {
    log("RD FATAL: " + e.message);
    return { success: false, error: e.message, items: [] };
  } finally {
    if (browser) { try { await browser.close(); } catch(e) {} }
  }
}

// ── Sysco Scraper ─────────────────────────────────────────────────────────────
async function scrapeSysco() {
  log("🔵 Sysco: starting...");
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36");
    page.setDefaultTimeout(30000);

    // Step 1: Email
    await page.goto("https://shop.sysco.com/auth/login", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(e => log("Sysco login nav: " + e.message));
    await new Promise(r => setTimeout(r, 3000));
    log("Sysco: login=" + page.url());

    await page.waitForSelector('input[type="email"]', { timeout: 15000 });
    await page.click('input[type="email"]');
    await page.keyboard.type(process.env.SYSCO_EMAIL, { delay: 50 });

    // Click Next button by text
    const nextClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, [role=button]"));
      const next = btns.find(b => b.textContent.trim().toLowerCase() === "next");
      if (next) { next.click(); return true; }
      return false;
    });
    if (!nextClicked) await page.keyboard.press("Enter");
    log("Sysco: Next clicked=" + nextClicked);

    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(e => log("Sysco Next nav: " + e.message));
    await new Promise(r => setTimeout(r, 3000));
    log("Sysco: after Next=" + page.url());

    // Step 2: Password (Okta at secure.sysco.com)
    await page.waitForSelector('#okta-signin-password, input[type="password"]', { timeout: 20000 });
    await page.click('#okta-signin-password, input[type="password"]');
    await page.keyboard.type(process.env.SYSCO_PASSWORD, { delay: 50 });

    const loginBtn = await page.$("#okta-signin-submit") || await page.$('input[type="submit"]') || await page.$('button[type="submit"]');
    if (loginBtn) await loginBtn.click();
    else await page.keyboard.press("Enter");

    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(e => log("Sysco login nav2: " + e.message));
    await new Promise(r => setTimeout(r, 5000));
    log("Sysco: logged in=" + page.url());

    if (!page.url().includes("shop.sysco.com")) throw new Error("Login failed at: " + page.url());

    // Step 3: Navigate to lists and click Nick List
    await page.goto("https://shop.sysco.com/app/lists", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(e => log("Sysco lists nav: " + e.message));
    await new Promise(r => setTimeout(r, 5000));
    log("Sysco: lists=" + page.url());

    // Click Nick List LI
    const nickClicked = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll("*"));
      for (const el of all) {
        if (el.children.length > 5) continue;
        const t = el.textContent.trim();
        if (t.toLowerCase().includes("nick list") && t.length < 30) {
          el.click();
          return `${el.tagName}: ${t}`;
        }
      }
      return null;
    });
    log("Sysco: Nick List click=" + nickClicked);

    // Wait for SPA to load Nick List content
    let rows = 0;
    for (let w = 0; w < 20; w++) {
      await new Promise(r => setTimeout(r, 1000));
      rows = await page.evaluate(() => document.querySelectorAll("[class*='product-item-row']").length);
      log("Sysco: wait " + w + "s, rows=" + rows + ", url=" + page.url());
      if (rows >= 5) break;
    }

    // Scroll to bottom to load all items (infinite scroll)
    let prevRows = 0;
    for (let s = 0; s < 20; s++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise(r => setTimeout(r, 1500));
      rows = await page.evaluate(() => document.querySelectorAll("[class*='product-item-row']").length);
      log("Sysco: scroll " + s + ", rows=" + rows);
      if (rows === prevRows && s > 3) break;
      prevRows = rows;
    }
    log("Sysco: final rows=" + rows);

    // Extract items using exact CSS classes
    const items = await page.evaluate(() => {
      const results = [];
      const seen = new Set();
      document.querySelectorAll("[class*='product-item-row']").forEach(row => {
        const nameEl = row.querySelector("[class*='item-details-col'], [class*='item-desc'], [class*='product-name']");
        const priceEl = row.querySelector("[class*='price-col']");
        if (!nameEl || !priceEl) return;
        const name = nameEl.innerText.trim().split("\n")[0].trim();
        const priceText = priceEl.innerText.trim();
        const m = priceText.match(/\$([\d,]+\.[\d]{2})/);
        if (!m || name.length < 3 || seen.has(name)) return;
        const price = parseFloat(m[1].replace(",", ""));
        if (price > 0 && price < 10000) { results.push({ name, price, raw: priceText }); seen.add(name); }
      });
      return results;
    });

    log("Sysco: " + items.length + " items: " + JSON.stringify(items.slice(0, 5)));
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
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(name + " timed out after " + ms/1000 + "s")), ms))]);
}

async function runScrape(source = "all") {
  if (source === "rd" || source === "all") {
    try {
      const result = await withTimeout(scrapeRD(), 180000, "RD");
      if (result.success && result.items.length > 0) {
        const matched = await matchWithAI(result.items, RD_ITEMS, "Restaurant Depot");
        matched.forEach(({ id, price }) => { if (id && price > 0) priceStore.rd[id] = { price, date: new Date().toISOString() }; });
        log("✅ RD: " + matched.length + " prices saved (" + result.items.length + " raw items)");
      } else { log("❌ RD: " + (result.error || "no items found")); }
    } catch(e) { log("❌ RD failed: " + e.message); }
  }

  if (source === "sysco" || source === "all") {
    try {
      const result = await withTimeout(scrapeSysco(), 180000, "Sysco");
      if (result.success && result.items.length > 0) {
        const matched = await matchWithAI(result.items, SYSCO_ITEMS, "Sysco Nick List");
        matched.forEach(({ id, price }) => { if (id && price > 0) priceStore.sysco[id] = { price, date: new Date().toISOString() }; });
        log("✅ Sysco: " + matched.length + " prices saved (" + result.items.length + " raw items)");
      } else { log("❌ Sysco: " + (result.error || "no items found")); }
    } catch(e) { log("❌ Sysco failed: " + e.message); }
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
  res.json({ message: "Scraping " + src + "..." });
  runScrape(src).catch(e => log("Trigger error: " + e.message));
});
app.post("/api/scrape", (req, res) => {
  const src = req.body?.source || "all";
  res.json({ message: "Scraping " + src + "..." });
  runScrape(src).catch(e => log("Scrape error: " + e.message));
});
app.post("/api/prices/manual", (req, res) => {
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
    const rdContext = RD_ITEMS.map(i => {
      const p = priceStore.rd[i.id];
      return p ? `${i.name}: $${p.price} (RD)` : null;
    }).filter(Boolean).join("\n");

    const syscoContext = SYSCO_ITEMS.map(i => {
      const p = priceStore.sysco[i.id];
      return p ? `${i.name} ${i.pack}: $${p.price} (Sysco)` : null;
    }).filter(Boolean).join("\n");

    const prompt = `You are the purchasing assistant for Naan & Curry restaurant Las Vegas.

RESTAURANT DEPOT PRICES:\n${rdContext || "No RD prices loaded"}\n
SYSCO NICK LIST PRICES:\n${syscoContext || "No Sysco prices loaded"}\n
Chef order list:\n${list}\n
Break this down by vendor. Be concise and practical.\n
🟢 ORDER FROM RESTAURANT DEPOT:\n- [item] — $[price]\n\n🔵 ORDER FROM SYSCO:\n- [item] — $[price]\n\n⚠️ CHECK MANUALLY (not in our system):\n- [item]\n\n💰 Estimated: RD $[X] + Sysco $[Y] = $[total]`;

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

// Daily scrape 6am Las Vegas (1pm UTC)
cron.schedule("0 13 * * *", () => { log("⏰ Daily scrape"); runScrape("all").catch(console.error); });

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "../build/index.html")));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  log("🚀 Server on port " + PORT);
  setTimeout(() => runScrape("all").catch(console.error), 15000);
});
