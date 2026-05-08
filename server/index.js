require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const cron = require("node-cron");

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
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

// ── Launch Puppeteer ──────────────────────────────────────────────────────────
async function launchBrowser() {
  const chromium = require("@sparticuz/chromium");
  const puppeteer = require("puppeteer-core");
  return puppeteer.launch({
    args: [...chromium.args, "--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: { width: 1280, height: 800 },
    executablePath: await chromium.executablePath(),
    headless: true,
  });
}

// ── RD Scraper ────────────────────────────────────────────────────────────────
async function scrapeRD() {
  console.log("🟢 RD scrape starting...");
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36");
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

    // Go to RD login
    await page.goto("https://member.restaurantdepot.com/login", { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    // Fill login form
    const emailInput = await page.$('input[type="email"]') || await page.$('input[name="email"]') || await page.$("#email");
    const passInput = await page.$('input[type="password"]') || await page.$('input[name="password"]') || await page.$("#password");
    
    if (!emailInput || !passInput) {
      const html = await page.content();
      console.log("RD login page HTML snippet:", html.substring(0, 500));
      throw new Error("Could not find RD login form fields");
    }

    await emailInput.type(process.env.RD_EMAIL, { delay: 50 });
    await passInput.type(process.env.RD_PASSWORD, { delay: 50 });
    await page.keyboard.press("Enter");
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));

    console.log("RD logged in, going to order guide...");

    // Go directly to the order guide
    await page.goto(
      "https://member.restaurantdepot.com/store/business/order-guide/19933806363004568?tab=items",
      { waitUntil: "networkidle2", timeout: 30000 }
    );
    await new Promise(r => setTimeout(r, 5000));

    // Scroll to load all items
    await page.evaluate(async () => {
      for (let i = 0; i < 20; i++) {
        window.scrollBy(0, 800);
        await new Promise(r => setTimeout(r, 300));
      }
    });
    await new Promise(r => setTimeout(r, 2000));

    // Extract items - try multiple selector strategies
    const items = await page.evaluate(() => {
      const results = [];
      
      // Strategy 1: Look for price + description pairs
      const allText = document.body.innerText;
      const lines = allText.split("\n").map(l => l.trim()).filter(l => l);
      
      let i = 0;
      while (i < lines.length) {
        const line = lines[i];
        // Price pattern: $XX.XX or $XX.XX-$XX.XX or $XX each (est.)
        const priceMatch = line.match(/\$(\d+\.?\d*)\s*(?:[-–]\s*\$(\d+\.?\d*))?(?:\s*each)?/);
        if (priceMatch) {
          // Use higher price (case price) when range
          const price1 = parseFloat(priceMatch[1]);
          const price2 = priceMatch[2] ? parseFloat(priceMatch[2]) : null;
          const casePrice = price2 ? Math.max(price1, price2) : price1;
          
          // Look for item name in nearby lines
          const nameLine = lines[i + 1] || lines[i - 1] || "";
          if (nameLine.length > 3 && !nameLine.match(/^\$/) && casePrice > 0) {
            results.push({ name: nameLine, price: casePrice, raw: line });
          }
        }
        i++;
      }
      return results;
    });

    console.log(`RD: found ${items.length} items`);
    return { success: true, items, timestamp: new Date().toISOString() };
  } catch (err) {
    console.error("RD scrape error:", err.message);
    return { success: false, error: err.message, items: [] };
  } finally {
    if (browser) await browser.close();
  }
}

// ── Sysco Scraper ─────────────────────────────────────────────────────────────
async function scrapeSysco() {
  console.log("🔵 Sysco scrape starting...");
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36");
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

    // Go to Sysco login
    console.log("Going to Sysco login...");
    await page.goto("https://shop.sysco.com/app/login", { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    // Find and fill login fields
    const pageContent = await page.content();
    console.log("Sysco login page loaded, length:", pageContent.length);

    // Try multiple selectors for Sysco login
    const emailSelectors = ['input[type="email"]', 'input[name="username"]', 'input[id*="email"]', 'input[id*="user"]', 'input[placeholder*="email" i]', 'input[placeholder*="user" i]'];
    const passSelectors = ['input[type="password"]', 'input[name="password"]', 'input[id*="pass"]', 'input[placeholder*="pass" i]'];

    let emailInput = null;
    for (const sel of emailSelectors) {
      emailInput = await page.$(sel);
      if (emailInput) { console.log("Found email input:", sel); break; }
    }

    let passInput = null;
    for (const sel of passSelectors) {
      passInput = await page.$(sel);
      if (passInput) { console.log("Found pass input:", sel); break; }
    }

    if (!emailInput || !passInput) {
      console.log("Could not find Sysco login fields, page title:", await page.title());
      throw new Error("Could not find Sysco login form");
    }

    await emailInput.type(process.env.SYSCO_EMAIL, { delay: 50 });
    await passInput.type(process.env.SYSCO_PASSWORD, { delay: 50 });
    
    // Submit
    const submitBtn = await page.$('button[type="submit"]') || await page.$('button:contains("Sign In")') || await page.$('input[type="submit"]');
    if (submitBtn) {
      await submitBtn.click();
    } else {
      await page.keyboard.press("Enter");
    }

    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));
    console.log("Sysco logged in, URL:", page.url());

    // Go to lists page
    console.log("Going to Sysco lists...");
    await page.goto("https://shop.sysco.com/app/lists", { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    console.log("Lists page URL:", page.url());

    // Find Nick's List - look for it by text
    const listUrl = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a"));
      const nickLink = links.find(l => l.textContent.toLowerCase().includes("nick"));
      return nickLink ? nickLink.href : null;
    });

    console.log("Nick's List URL:", listUrl);

    if (listUrl) {
      await page.goto(listUrl, { waitUntil: "networkidle2", timeout: 30000 });
    } else {
      // Try clicking on Nick's List
      const clicked = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll("*"));
        const nickEl = els.find(el =>
          el.children.length === 0 &&
          el.textContent.toLowerCase().includes("nick") &&
          el.textContent.length < 30
        );
        if (nickEl) { nickEl.click(); return true; }
        return false;
      });
      if (clicked) {
        await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 10000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    console.log("On list page:", page.url());

    // Scroll to load all items
    await page.evaluate(async () => {
      for (let i = 0; i < 30; i++) {
        window.scrollBy(0, 800);
        await new Promise(r => setTimeout(r, 400));
      }
    });
    await new Promise(r => setTimeout(r, 2000));

    // Extract items and prices from Sysco list
    const items = await page.evaluate(() => {
      const results = [];
      const allText = document.body.innerText;
      const lines = allText.split("\n").map(l => l.trim()).filter(l => l.length > 0);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Sysco shows prices like "$XX.XX" or "XX.XX / CS" (per case)
        const priceMatch = line.match(/\$\s*([\d,]+\.[\d]{2})/) ||
                          line.match(/([\d,]+\.[\d]{2})\s*\/\s*(?:CS|EA|CA)/i);
        if (priceMatch) {
          const price = parseFloat(priceMatch[1].replace(",", ""));
          if (price > 0 && price < 10000) {
            // Look for product name nearby
            const nearby = [lines[i-2], lines[i-1], lines[i+1], lines[i+2]].filter(Boolean);
            const name = nearby.find(l =>
              l.length > 5 && l.length < 100 &&
              !l.match(/^\$/) &&
              !l.match(/^[\d\s,\.]+$/) &&
              !l.match(/add to cart|add item|remove|qty|quantity/i)
            );
            if (name) {
              results.push({ name, price, raw: line });
            }
          }
        }
      }
      return results;
    });

    console.log(`Sysco: found ${items.length} items`);

    // Take a screenshot for debugging
    await page.screenshot({ path: "/tmp/sysco-debug.png" });

    return { success: true, items, timestamp: new Date().toISOString() };
  } catch (err) {
    console.error("Sysco scrape error:", err.message);
    return { success: false, error: err.message, items: [] };
  } finally {
    if (browser) await browser.close();
  }
}

// ── Item master list ──────────────────────────────────────────────────────────
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

// ── AI matching ───────────────────────────────────────────────────────────────
async function matchItemsWithAI(scrapedItems, source) {
  if (!scrapedItems.length) return [];
  const itemList = RD_ITEMS.map(i => `${i.id}: ${i.description}`).join("\n");
  const scrapedText = scrapedItems.slice(0, 80).map(i => `${i.name}: $${i.price}`).join("\n");

  const prompt = `Match these scraped ${source} grocery items to our product list. Only match if you are confident it's the same product.

SCRAPED ITEMS:
${scrapedText}

OUR PRODUCT LIST (id: name):
${itemList}

Return ONLY a JSON array, no markdown:
[{"id":"ITEM_ID","price":0.00}]

Use exact IDs from the list. Skip if no confident match.`;

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
  try { return match ? JSON.parse(match[0]) : []; } catch { return []; }
}

// ── Price store ───────────────────────────────────────────────────────────────
let priceStore = { rd: {}, sysco: {}, lastUpdated: null, scrapeLog: [] };

async function runScrape(source = "all") {
  const log = (msg) => {
    console.log(msg);
    priceStore.scrapeLog.unshift({ time: new Date().toISOString(), msg });
    if (priceStore.scrapeLog.length > 50) priceStore.scrapeLog.pop();
  };

  if (source === "rd" || source === "all") {
    log("🟢 Starting RD scrape...");
    const result = await scrapeRD();
    if (result.success && result.items.length > 0) {
      const matched = await matchItemsWithAI(result.items, "Restaurant Depot");
      matched.forEach(({ id, price }) => {
        priceStore.rd[id] = { price, date: new Date().toISOString() };
      });
      log(`✅ RD: ${matched.length} prices updated from ${result.items.length} found`);
    } else {
      log(`❌ RD failed: ${result.error}`);
    }
  }

  if (source === "sysco" || source === "all") {
    log("🔵 Starting Sysco scrape...");
    const result = await scrapeSysco();
    if (result.success && result.items.length > 0) {
      const matched = await matchItemsWithAI(result.items, "Sysco");
      matched.forEach(({ id, price }) => {
        priceStore.sysco[id] = { price, date: new Date().toISOString() };
      });
      log(`✅ Sysco: ${matched.length} prices updated from ${result.items.length} found`);
    } else {
      log(`❌ Sysco failed: ${result.error}`);
    }
  }

  priceStore.lastUpdated = new Date().toISOString();
}

// ── API Routes ────────────────────────────────────────────────────────────────
app.get("/api/prices", (req, res) => res.json(priceStore));

app.get("/api/status", (req, res) => res.json({
  lastUpdated: priceStore.lastUpdated,
  rdItems: Object.keys(priceStore.rd).length,
  syscoItems: Object.keys(priceStore.sysco).length,
  log: priceStore.scrapeLog.slice(0, 10),
}));

app.post("/api/scrape", async (req, res) => {
  const { source } = req.body;
  res.json({ message: `Scrape started for ${source || "all"}. Check /api/status for progress.` });
  runScrape(source || "all").catch(console.error);
});

app.post("/api/grocery", async (req, res) => {
  const { list } = req.body;
  if (!list) return res.status(400).json({ error: "No list provided" });

  try {
    const itemsWithPrices = RD_ITEMS.map(item => {
      const rd = priceStore.rd[item.id];
      const sc = priceStore.sysco[item.id];
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
      .filter(i => i.rdPrice || i.syscoPrice)
      .map(i => `${i.description}: RD=$${i.rdPrice || "?"} Sysco=$${i.syscoPrice || "?"} BUY=${i.bestSource?.toUpperCase() || "?"}`)
      .join("\n");

    const prompt = `You are the purchasing assistant for Naan & Curry restaurant in Las Vegas.

Current pricing data:
${context}

Chef's order list:
${list}

Break this list down by vendor. Be practical and concise.

Format your response exactly like this:

🟢 ORDER FROM RESTAURANT DEPOT:
- [item] — $[price]/case
- ...

🔵 ORDER FROM SYSCO:
- [item] — $[price]/case
- ...

⚠️ CHECK MANUALLY (not in our system):
- [item]
- ...

💰 Total estimated order: RD $[amount] + Sysco $[amount] = $[total]`;

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

// ── Daily scrape at 6am Las Vegas time (1pm UTC) ──────────────────────────────
cron.schedule("0 13 * * *", () => {
  console.log("⏰ Daily auto-scrape...");
  runScrape("all").catch(console.error);
});

// ── Catch-all ─────────────────────────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../build/index.html"));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server on port ${PORT}`);
  // Auto-scrape on startup if no prices yet
  if (!priceStore.lastUpdated) {
    console.log("No prices yet — running initial scrape in 30s...");
    setTimeout(() => runScrape("all").catch(console.error), 30000);
  }
});
