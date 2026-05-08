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

// ── Launch browser ────────────────────────────────────────────────────────────
async function launchBrowser() {
  const chromium = require("@sparticuz/chromium");
  const puppeteer = require("puppeteer-core");
  return puppeteer.launch({
    args: [...chromium.args, "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    defaultViewport: { width: 1280, height: 900 },
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

    // Login
    await page.goto("https://member.restaurantdepot.com/login", { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    const emailInput = await page.$('input[type="email"]') || await page.$('#email') || await page.$('input[name="email"]');
    const passInput = await page.$('input[type="password"]') || await page.$('#password');

    if (!emailInput || !passInput) throw new Error("RD login form not found");

    await emailInput.type(process.env.RD_EMAIL, { delay: 50 });
    await passInput.type(process.env.RD_PASSWORD, { delay: 50 });
    await page.keyboard.press("Enter");
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    console.log("RD logged in, URL:", page.url());

    // Go directly to Naan & Curry order guide
    await page.goto(
      "https://member.restaurantdepot.com/store/business/order-guide/19933806363004568",
      { waitUntil: "networkidle2", timeout: 30000 }
    );
    await new Promise(r => setTimeout(r, 4000));

    // Scroll to load all items
    for (let i = 0; i < 25; i++) {
      await page.evaluate(() => window.scrollBy(0, 600));
      await new Promise(r => setTimeout(r, 400));
    }
    await new Promise(r => setTimeout(r, 2000));

    // Extract all text and find price patterns
    const items = await page.evaluate(() => {
      const results = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const texts = [];
      while (walker.nextNode()) {
        const t = walker.currentNode.textContent.trim();
        if (t.length > 0) texts.push(t);
      }

      for (let i = 0; i < texts.length; i++) {
        const t = texts[i];
        // Match price range like "$7.84-$43.95" or "$36.24" or "$31.60 each (est.)"
        const rangeMatch = t.match(/\$\s*(\d+\.?\d*)\s*[-–]\s*\$\s*(\d+\.?\d*)/);
        const singleMatch = t.match(/^\$\s*(\d+\.?\d+)\s*(?:each)?/);
        const eachMatch = t.match(/\$(\d+\.?\d+)\s+each\s+\(est\.\)/);

        let price = null;
        if (eachMatch) price = parseFloat(eachMatch[1]);
        else if (rangeMatch) price = Math.max(parseFloat(rangeMatch[1]), parseFloat(rangeMatch[2]));
        else if (singleMatch) price = parseFloat(singleMatch[1]);

        if (price && price > 1 && price < 5000) {
          // Find nearby product name
          for (let j = Math.max(0, i - 3); j <= Math.min(texts.length - 1, i + 3); j++) {
            const candidate = texts[j];
            if (candidate !== t &&
                candidate.length > 5 &&
                candidate.length < 120 &&
                !candidate.match(/^\$/) &&
                !candidate.match(/^[\d\s]+$/) &&
                !candidate.match(/Bin|stock|Add|Skip|Cart|Login|Search/i)) {
              results.push({ name: candidate, price, raw: t });
              break;
            }
          }
        }
      }
      return results;
    });

    console.log(`RD: extracted ${items.length} items`);
    return { success: true, items, timestamp: new Date().toISOString() };
  } catch (err) {
    console.error("RD error:", err.message);
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

    // Sysco login: shop.sysco.com/auth/login → secure.sysco.com (Okta)
    // Step 1: Enter email at shop.sysco.com
    await page.goto("https://shop.sysco.com/auth/login", { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(r => setTimeout(r, 4000));
    console.log("Sysco step1:", page.url());

    await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 15000 });
    await page.click('input[type="email"], input[name="email"]');
    await page.type('input[type="email"], input[name="email"]', process.env.SYSCO_EMAIL, { delay: 80 });
    console.log("Sysco: email typed");
    await new Promise(r => setTimeout(r, 500));

    // Click "Next" - first submit button
    const nextBtns = await page.$$('button[type="submit"]');
    if (nextBtns.length > 0) await nextBtns[0].click();
    else await page.keyboard.press("Enter");

    // Wait for redirect to secure.sysco.com (Okta)
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 4000));
    console.log("Sysco step2:", page.url());

    // Step 2: Now on secure.sysco.com - Okta login
    // Password field ID is "okta-signin-password" from dev tools
    await page.waitForSelector('#okta-signin-password, input[type="password"]', { timeout: 15000 });
    await new Promise(r => setTimeout(r, 1000));

    const pwField = await page.$('#okta-signin-password') || await page.$('input[type="password"]');
    if (!pwField) throw new Error("Sysco: Okta password field not found. URL: " + page.url());

    await pwField.click();
    await pwField.type(process.env.SYSCO_PASSWORD, { delay: 80 });
    console.log("Sysco: password typed");
    await new Promise(r => setTimeout(r, 500));

    // Click Log In button
    const loginBtn = await page.$('input[type="submit"]') ||
                     await page.$('button[type="submit"]') ||
                     await page.$('#okta-signin-submit');
    if (loginBtn) await loginBtn.click();
    else await page.keyboard.press("Enter");

    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 25000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 4000));
    console.log("Sysco logged in:", page.url());

    // Should be on shop.sysco.com/app/discover now
    if (!page.url().includes("shop.sysco.com")) {
      throw new Error("Sysco login failed, stuck at: " + page.url());
    }

    // Go to lists page
    await page.goto("https://shop.sysco.com/app/lists", { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(r => setTimeout(r, 4000));
    console.log("Sysco lists URL:", page.url());

    // Log what lists are available
    const listsText = await page.evaluate(() => document.body.innerText.slice(0, 1000));
    console.log("Sysco lists page text:", listsText);

    // Find and click Nick List (shown as "Nick List" in Sysco)
    const nickClicked = await page.evaluate(() => {
      // Try to find by text content containing "nick"
      const all = Array.from(document.querySelectorAll("a, button, li, div, span, td, h2, h3, h4, p, [class*='list-name'], [class*='list-title']"));
      const nick = all.find(el =>
        el.textContent.trim().toLowerCase().includes("nick") &&
        el.textContent.trim().length < 60 &&
        el.children.length <= 3
      );
      if (nick) {
        // Try to find the closest anchor or clickable
        const link = nick.tagName === "A" ? nick : nick.closest("a") || nick.querySelector("a");
        if (link) {
          link.click();
          return { clicked: link.textContent.trim(), href: link.href };
        }
        nick.click();
        return { clicked: nick.textContent.trim(), href: null };
      }
      return null;
    });
    console.log("Nick List clicked:", JSON.stringify(nickClicked));

    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 10000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));
    console.log("Nick List URL:", page.url());

    // Scroll to load all items
    for (let i = 0; i < 40; i++) {
      await page.evaluate(() => window.scrollBy(0, 600));
      await new Promise(r => setTimeout(r, 300));
    }
    await new Promise(r => setTimeout(r, 3000));

    // Extract using exact Sysco CSS classes from dev tools
    // Row: div.row.product-item-row-group
    // Name: div.col.item-details-col
    // Price: div.col.price-col
    const items = await page.evaluate(() => {
      const results = [];

      // Strategy 1: Use exact Sysco classes seen in dev tools
      const rows = document.querySelectorAll(".product-item-row-group, .product-item-row-grouped, [class*='product-item-row']");
      console.log("Found rows:", rows.length);
      rows.forEach(row => {
        const nameEl = row.querySelector("[class*='item-details-col'], [class*='item-desc'], [class*='product-name']");
        const priceEl = row.querySelector("[class*='price-col'], [class*='price']");
        if (nameEl && priceEl) {
          const name = nameEl.textContent.trim().split("\n")[0].trim();
          const priceText = priceEl.textContent.trim();
          const m = priceText.match(/\$([\d,]+\.[\d]{2})/);
          if (m && name.length > 3 && name.length < 150) {
            results.push({ name, price: parseFloat(m[1].replace(",", "")), raw: priceText });
          }
        }
      });

      // Strategy 2: Look for data-grid rows (Sysco uses .fd.lists-product-grid)
      if (results.length === 0) {
        const gridRows = document.querySelectorAll(".data-grid .row, [class*='lists-product-grid'] .row, .fd .row");
        gridRows.forEach(row => {
          const cols = row.querySelectorAll("[class*='col']");
          if (cols.length >= 2) {
            const name = cols[0].textContent.trim().split("\n")[0].trim();
            const lastCol = cols[cols.length - 1].textContent.trim();
            const priceCol = Array.from(cols).find(c => c.textContent.match(/\$[\d,]+\.\d{2}/));
            if (priceCol) {
              const m = priceCol.textContent.match(/\$([\d,]+\.[\d]{2})/);
              if (m && name.length > 3 && !name.match(/^\$|\d+\/\d+/)) {
                results.push({ name, price: parseFloat(m[1].replace(",", "")), raw: priceCol.textContent.trim() });
              }
            }
          }
        });
      }

      // Strategy 3: Any element with price-col class
      if (results.length === 0) {
        const priceCols = document.querySelectorAll("[class*='price-col']");
        priceCols.forEach(pc => {
          const m = pc.textContent.match(/\$([\d,]+\.[\d]{2})/);
          if (!m) return;
          const price = parseFloat(m[1].replace(",", ""));
          if (price < 1 || price > 10000) return;
          // Walk up to find the row, then find the name
          const row = pc.closest("[class*='row'], tr, li");
          if (row) {
            const nameEl = row.querySelector("[class*='item-details'], [class*='description'], [class*='name'], td:first-child, div:first-child");
            const name = nameEl ? nameEl.textContent.trim().split("\n")[0].trim() : "";
            if (name.length > 3 && name.length < 150) {
              results.push({ name, price, raw: pc.textContent.trim() });
            }
          }
        });
      }

      return results;
    });

    console.log("Sysco extracted:", items.length, "items");
    if (items.length > 0) console.log("Sample:", JSON.stringify(items.slice(0, 3)));
    return { success: true, items, timestamp: new Date().toISOString() };
  } catch (err) {
    console.error("Sysco error:", err.message);
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

  const prompt = `Match these ${source} grocery items to our product list. Only match if confident it's the same product.

SCRAPED:
${scrapedText}

OUR LIST:
${itemList}

Return ONLY JSON array, no markdown:
[{"id":"ITEM_ID","price":0.00}]`;

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
    if (priceStore.scrapeLog.length > 100) priceStore.scrapeLog.pop();
  };

  if (source === "rd" || source === "all") {
    log("🟢 Scraping Restaurant Depot...");
    const result = await scrapeRD();
    if (result.success && result.items.length > 0) {
      const matched = await matchItemsWithAI(result.items, "Restaurant Depot");
      matched.forEach(({ id, price }) => {
        priceStore.rd[id] = { price, date: new Date().toISOString() };
      });
      log(`✅ RD: ${matched.length} prices updated (${result.items.length} raw items found)`);
    } else {
      log(`❌ RD failed: ${result.error}`);
    }
  }

  if (source === "sysco" || source === "all") {
    log("🔵 Scraping Sysco...");
    const result = await scrapeSysco();
    if (result.success && result.items.length > 0) {
      const matched = await matchItemsWithAI(result.items, "Sysco");
      matched.forEach(({ id, price }) => {
        priceStore.sysco[id] = { price, date: new Date().toISOString() };
      });
      log(`✅ Sysco: ${matched.length} prices updated (${result.items.length} raw items found)`);
    } else {
      log(`❌ Sysco failed: ${result.error}`);
    }
  }

  priceStore.lastUpdated = new Date().toISOString();
}

// ── API routes ────────────────────────────────────────────────────────────────
app.get("/api/prices", (req, res) => res.json(priceStore));

app.get("/api/diagnose", async (req, res) => {
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36");
    
    const site = req.query.site || "rd";
    const url = site === "sysco" ? "https://shop.sysco.com/app/login" : "https://member.restaurantdepot.com/login";
    
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(r => setTimeout(r, 5000));
    
    const info = await page.evaluate(() => ({
      title: document.title,
      url: window.location.href,
      inputs: Array.from(document.querySelectorAll("input")).map(i => ({
        type: i.type, name: i.name, id: i.id, 
        placeholder: i.placeholder, className: i.className.slice(0, 50),
        autocomplete: i.autocomplete, visible: i.offsetParent !== null
      })),
      buttons: Array.from(document.querySelectorAll("button")).map(b => ({
        type: b.type, text: b.textContent.trim().slice(0, 30), id: b.id
      })).slice(0, 10),
      bodyText: document.body.innerText.slice(0, 500)
    }));
    
    res.json(info);
  } catch (err) {
    res.json({ error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

app.get("/api/trigger", (req, res) => {
  res.json({ message: "Scrape triggered — check /api/status in 2-3 minutes" });
  runScrape(req.query.source || "all").catch(console.error);
});

app.get("/api/status", (req, res) => res.json({
  status: "running",
  lastUpdated: priceStore.lastUpdated,
  rdItems: Object.keys(priceStore.rd).length,
  syscoItems: Object.keys(priceStore.sysco).length,
  log: priceStore.scrapeLog.slice(0, 20),
}));

app.post("/api/scrape", async (req, res) => {
  const { source } = req.body;
  const src = source || "all";
  res.json({ message: `Started scraping ${src}. Check /api/status for progress.` });
  runScrape(src).catch(err => console.error("Scrape error:", err));
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

Current pricing:
${context || "No prices loaded yet — using best guess based on typical pricing"}

Chef's order list:
${list}

Break this down by vendor. Be concise and practical.

🟢 ORDER FROM RESTAURANT DEPOT:
- [item] — $[price]/case

🔵 ORDER FROM SYSCO:
- [item] — $[price]/case

⚠️ NOT IN OUR SYSTEM (check manually):
- [item]

💰 Estimated totals: RD $[X] + Sysco $[Y] = $[total]`;

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

// ── Daily scrape 6am Las Vegas time (UTC-7 = 13:00 UTC) ──────────────────────
cron.schedule("0 13 * * *", () => {
  console.log("⏰ Daily scrape starting...");
  runScrape("all").catch(console.error);
});

// ── Serve React app ───────────────────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../build/index.html"));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Naan & Curry server on port ${PORT}`);
  console.log(`🔗 RD order guide: https://member.restaurantdepot.com/store/business/order-guide/19933806363004568`);
  console.log(`🔗 Sysco lists: https://shop.sysco.com/app/lists`);
  // Initial scrape 60s after startup
  setTimeout(() => {
    console.log("⏳ Running initial scrape...");
    runScrape("all").catch(console.error);
  }, 60000);
});
