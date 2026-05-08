require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const cron = require("node-cron");

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

// ── Serve React build ─────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "../build")));

// ── Claude API proxy ──────────────────────────────────────────────────────────
app.post("/api/claude", async (req, res) => {
  try {
    const body = { ...req.body, model: "claude-haiku-4-5-20251001" };
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── RD Scraper ────────────────────────────────────────────────────────────────
async function scrapeRD() {
  console.log("🟢 Starting RD scrape...");
  let browser;
  try {
    const chromium = require("@sparticuz/chromium");
    const puppeteer = require("puppeteer-core");

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: true,
    });

    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36");

    // Login
    console.log("Logging into RD...");
    await page.goto("https://member.restaurantdepot.com/login", { waitUntil: "networkidle2", timeout: 30000 });
    await page.type('input[type="email"], input[name="email"], #email', process.env.RD_EMAIL);
    await page.type('input[type="password"], input[name="password"], #password', process.env.RD_PASSWORD);
    await page.click('button[type="submit"], .login-btn, button:contains("Sign In")');
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 });
    console.log("RD login done, going to order guide...");

    // Go to order guide
    await page.goto(
      "https://member.restaurantdepot.com/store/business/order-guide/19933806363004568?tab=items",
      { waitUntil: "networkidle2", timeout: 30000 }
    );
    await new Promise(r => setTimeout(r, 3000));

    // Extract all items and prices
    const items = await page.evaluate(() => {
      const results = [];
      const cards = document.querySelectorAll('[class*="product"], [class*="item"], [class*="card"]');
      cards.forEach(card => {
        const nameEl = card.querySelector('[class*="name"], [class*="title"], h3, h4');
        const priceEl = card.querySelector('[class*="price"]');
        if (nameEl && priceEl) {
          const name = nameEl.textContent.trim();
          const priceText = priceEl.textContent.trim();
          // Extract case price (higher of range if shown)
          const prices = priceText.match(/\$?([\d,]+\.[\d]{2})/g);
          if (prices && prices.length > 0) {
            const nums = prices.map(p => parseFloat(p.replace(/[$,]/g, "")));
            const casePrice = Math.max(...nums);
            results.push({ name, price: casePrice, raw: priceText });
          }
        }
      });
      return results;
    });

    console.log(`RD scrape found ${items.length} items`);
    return { success: true, items, timestamp: new Date().toISOString() };
  } catch (err) {
    console.error("RD scrape error:", err.message);
    return { success: false, error: err.message };
  } finally {
    if (browser) await browser.close();
  }
}

// ── Sysco Scraper ─────────────────────────────────────────────────────────────
async function scrapeSysco() {
  console.log("🔵 Starting Sysco scrape...");
  let browser;
  try {
    const chromium = require("@sparticuz/chromium");
    const puppeteer = require("puppeteer-core");

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: true,
    });

    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36");

    // Login to Sysco
    console.log("Logging into Sysco...");
    await page.goto("https://shop.sysco.com/app/login", { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));
    await page.type('input[type="email"], input[name="username"], #username', process.env.SYSCO_EMAIL);
    await page.type('input[type="password"], input[name="password"], #password', process.env.SYSCO_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 });
    console.log("Sysco login done, finding Nick's List...");

    // Go to order guides and find Nick's List
    await page.goto("https://shop.sysco.com/app/orderlists", { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    // Click on Nick's List
    const listLinks = await page.$$eval("a, button", els =>
      els.filter(el => el.textContent.includes("Nick")).map(el => ({
        text: el.textContent.trim(),
        href: el.href || null
      }))
    );
    console.log("Found lists:", listLinks);

    if (listLinks.length > 0 && listLinks[0].href) {
      await page.goto(listLinks[0].href, { waitUntil: "networkidle2", timeout: 30000 });
    } else {
      // Try clicking
      await page.evaluate(() => {
        const el = Array.from(document.querySelectorAll("*")).find(e => e.textContent.trim() === "Nick's List");
        if (el) el.click();
      });
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 10000 }).catch(() => {});
    }

    await new Promise(r => setTimeout(r, 3000));

    // Extract items and prices
    const items = await page.evaluate(() => {
      const results = [];
      const rows = document.querySelectorAll('[class*="product"], [class*="item"], tr, [class*="row"]');
      rows.forEach(row => {
        const nameEl = row.querySelector('[class*="name"], [class*="description"], td:first-child');
        const priceEl = row.querySelector('[class*="price"], [class*="cost"], td:nth-child(3)');
        if (nameEl && priceEl) {
          const name = nameEl.textContent.trim();
          const priceText = priceEl.textContent.trim();
          const match = priceText.match(/\$?([\d,]+\.[\d]{2})/);
          if (match) {
            results.push({ name, price: parseFloat(match[1].replace(",", "")), raw: priceText });
          }
        }
      });
      return results;
    });

    console.log(`Sysco scrape found ${items.length} items`);
    return { success: true, items, timestamp: new Date().toISOString() };
  } catch (err) {
    console.error("Sysco scrape error:", err.message);
    return { success: false, error: err.message };
  } finally {
    if (browser) await browser.close();
  }
}

// ── Match scraped items to our item list ──────────────────────────────────────
const RD_ITEMS = [
  { id: "42599", description: "Russet Potatoes" },
  { id: "44146", description: "Peeled Garlic" },
  { id: "42513", description: "Fresh Ginger" },
  { id: "1440528", description: "Paneer" },
  { id: "P-CAULIF", description: "Cauliflower" },
  { id: "P-GRNON", description: "Green Onion" },
  { id: "P-FSPN", description: "Fresh Spinach" },
  { id: "P-GBELL", description: "Green Bell Pepper" },
  { id: "P-LEMON", description: "Lemons" },
  { id: "42566", description: "Cilantro" },
  { id: "P-MINT", description: "Mint" },
  { id: "44137", description: "Serrano Peppers" },
  { id: "42658", description: "Red Onions" },
  { id: "42545", description: "Yellow Onions" },
  { id: "42504", description: "Cucumbers" },
  { id: "1530438", description: "Heavy Cream" },
  { id: "370496", description: "Whole Milk" },
  { id: "14785", description: "Plain Yogurt" },
  { id: "1440204", description: "Cheddar Jack Cheese Blend" },
  { id: "77200", description: "Chicken Wings" },
  { id: "77670", description: "Chicken Leg Quarters" },
  { id: "77682", description: "Chicken Thighs Boneless" },
  { id: "1810019", description: "Goat Bone-in Cubed" },
  { id: "79042", description: "Lamb Leg Boneless Halal" },
  { id: "77595", description: "Chicken Thigh Meat Frozen" },
  { id: "77597", description: "Chicken Leg Meat Frozen Marinated" },
  { id: "51457", description: "Tilapia Fillets Frozen" },
  { id: "64046", description: "Chopped Spinach Frozen" },
  { id: "64120", description: "Broccoli Florets Frozen" },
  { id: "86527", description: "Mixed Vegetables Frozen" },
  { id: "86525", description: "Green Peas Frozen" },
  { id: "2910159", description: "Cornstarch" },
  { id: "16200", description: "Garbanzo Beans" },
  { id: "69810", description: "Red Kidney Beans" },
  { id: "F-TOMPURE", description: "Tomato Puree" },
  { id: "860044", description: "Tomato Sauce" },
  { id: "860135", description: "Petite Diced Tomatoes" },
  { id: "490266", description: "Basmati Rice Extra Long Grain" },
  { id: "490219", description: "Sela Basmati Rice" },
  { id: "21051", description: "Granulated Sugar" },
  { id: "1070496", description: "Salt" },
  { id: "29268", description: "Baking Powder" },
  { id: "53556", description: "Atta Flour Durum Wheat" },
  { id: "L-WHTVIN", description: "White Vinegar" },
  { id: "1020152", description: "Liquid Butter Alt" },
  { id: "L-LEMJC", description: "Lemon Juice" },
  { id: "13417", description: "Sambal Oelek Chili Paste" },
  { id: "1020079", description: "Canola Oil" },
  { id: "1020075", description: "Soybean Oil" },
  { id: "1020077", description: "Fry Oil" },
  { id: "2550014", description: "Red Food Coloring" },
  { id: "S-YELCOL", description: "Egg Yellow Food Coloring" },
  { id: "25267", description: "Roasted Eggplant Pulp" },
  { id: "NF-PAPER", description: "Printer Paper Roll" },
  { id: "12728", description: "Pan Spray" },
];

async function matchItemsWithAI(scrapedItems, source) {
  const itemList = RD_ITEMS.map(i => `${i.id}: ${i.description}`).join("\n");
  const scrapedText = scrapedItems.map(i => `${i.name}: $${i.price}`).join("\n");

  const prompt = `Match these scraped ${source} items to our product list.

SCRAPED ITEMS:
${scrapedText}

OUR PRODUCT LIST:
${itemList}

Return ONLY a JSON array:
[{"id":"ITEM_ID","price":0.00}]

Only include items where you're confident of the match. Use exact IDs from the list.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }]
    }),
  });
  const data = await response.json();
  const txt = data.content?.find(b => b.type === "text")?.text || "[]";
  const match = txt.match(/\[[\s\S]*\]/);
  return match ? JSON.parse(match[0]) : [];
}

// ── In-memory price store (persists while server runs) ────────────────────────
let priceStore = {
  rd: {},
  sysco: {},
  lastUpdated: null,
};

// ── API Routes ────────────────────────────────────────────────────────────────

// Get current prices
app.get("/api/prices", (req, res) => {
  res.json(priceStore);
});

// Manual trigger scrape
app.post("/api/scrape", async (req, res) => {
  const { source } = req.body; // "rd", "sysco", or "all"
  res.json({ message: `Scrape started for ${source || "all"}. Check /api/prices in ~2 minutes.` });

  // Run in background
  (async () => {
    if (!source || source === "rd" || source === "all") {
      const rdResult = await scrapeRD();
      if (rdResult.success && rdResult.items.length > 0) {
        const matched = await matchItemsWithAI(rdResult.items, "Restaurant Depot");
        matched.forEach(({ id, price }) => {
          priceStore.rd[id] = { price, date: new Date().toISOString() };
        });
        console.log(`✅ RD: ${matched.length} prices updated`);
      }
    }

    if (!source || source === "sysco" || source === "all") {
      const syscoResult = await scrapeSysco();
      if (syscoResult.success && syscoResult.items.length > 0) {
        const matched = await matchItemsWithAI(syscoResult.items, "Sysco");
        matched.forEach(({ id, price }) => {
          priceStore.sysco[id] = { price, date: new Date().toISOString() };
        });
        console.log(`✅ Sysco: ${matched.length} prices updated`);
      }
    }

    priceStore.lastUpdated = new Date().toISOString();
  })();
});

// ── Grocery List Breakdown ────────────────────────────────────────────────────
app.post("/api/grocery", async (req, res) => {
  const { list } = req.body;
  if (!list) return res.status(400).json({ error: "No list provided" });

  try {
    const rdPrices = priceStore.rd;
    const syscoPrices = priceStore.sysco;

    const itemsWithPrices = RD_ITEMS.map(item => {
      const rd = rdPrices[item.id];
      const sc = syscoPrices[item.id];
      return {
        ...item,
        rdPrice: rd?.price || null,
        syscoPrice: sc?.price || null,
        bestSource: !rd && !sc ? null :
          !rd ? "sysco" : !sc ? "rd" :
          rd.price <= sc.price ? "rd" : "sysco"
      };
    });

    const context = itemsWithPrices
      .map(i => `${i.description}: RD=$${i.rdPrice || "?"} Sysco=$${i.syscoPrice || "?"} BUY_FROM=${i.bestSource?.toUpperCase() || "?"}`)
      .join("\n");

    const prompt = `You are a restaurant purchasing assistant for Naan & Curry restaurant in Las Vegas.

Here is our product database with current pricing:
${context}

The chef has submitted this grocery/ordering list:
${list}

Break down this list by vendor. For each item:
1. Match it to our product database
2. Tell them where to order it (RD or Sysco) based on best price
3. If it's not in our database, note it as "Not in system - check manually"

Respond with a clean, practical breakdown in this format:

🟢 ORDER FROM RESTAURANT DEPOT:
- [item name] — $[price]
- ...

🔵 ORDER FROM SYSCO:
- [item name] — $[price]
- ...

⚠️ CHECK MANUALLY (not in system):
- [item name]
- ...

💰 ESTIMATED SAVINGS vs buying everything from one vendor: $[amount]

Keep it concise and practical.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }]
      }),
    });
    const data = await response.json();
    const result = data.content?.find(b => b.type === "text")?.text || "Could not process list";
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Auto scrape every day at 6am ──────────────────────────────────────────────
cron.schedule("0 6 * * *", async () => {
  console.log("⏰ Daily auto-scrape starting...");
  const rdResult = await scrapeRD();
  if (rdResult.success && rdResult.items.length > 0) {
    const matched = await matchItemsWithAI(rdResult.items, "Restaurant Depot");
    matched.forEach(({ id, price }) => {
      priceStore.rd[id] = { price, date: new Date().toISOString() };
    });
  }
  const syscoResult = await scrapeSysco();
  if (syscoResult.success && syscoResult.items.length > 0) {
    const matched = await matchItemsWithAI(syscoResult.items, "Sysco");
    matched.forEach(({ id, price }) => {
      priceStore.sysco[id] = { price, date: new Date().toISOString() };
    });
  }
  priceStore.lastUpdated = new Date().toISOString();
  console.log("✅ Daily auto-scrape complete");
});

// ── Catch-all: serve React app ────────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../build/index.html"));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Naan & Curry server running on port ${PORT}`);
  console.log(`📊 Prices endpoint: /api/prices`);
  console.log(`🔄 Trigger scrape: POST /api/scrape`);
  console.log(`🛒 Grocery list: POST /api/grocery`);
});
