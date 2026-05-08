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
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36");

    // Use exact SSO init URL from working app
    await page.goto(
      "https://member.restaurantdepot.com/rest/sso/auth/restaurantdepot/init?return_to=https%3A%2F%2Fwww.restaurantdepot.com%2F",
      { waitUntil: "domcontentloaded", timeout: 30000 }
    );
    await new Promise(r => setTimeout(r, 5000));
    console.log("RD SSO URL:", page.url());

    // Identity provider has #email and input[type="password"]
    await page.waitForSelector("#email", { timeout: 15000 });
    await page.locator("#email").fill(process.env.RD_EMAIL);
    await page.locator('input[type="password"]').fill(process.env.RD_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await new Promise(r => setTimeout(r, 6000));
    console.log("RD after login:", page.url());

    // Go directly to Naan & Curry order guide
    await page.goto(
      "https://member.restaurantdepot.com/store/business/order-guide/19933806363004568",
      { waitUntil: "networkidle2", timeout: 45000 }
    );
    await new Promise(r => setTimeout(r, 5000));
    console.log("RD order guide loaded");

    // Scroll to load all items
    for (let i = 0; i < 30; i++) {
      await page.evaluate(() => window.scrollBy(0, 600));
      await new Promise(r => setTimeout(r, 400));
    }
    await new Promise(r => setTimeout(r, 3000));

    // Extract items using text walker - find price patterns near product names
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
        // Match: "$57.60 each (est.)" or "$7.84-$43.95" (range → use higher = case price)
        const eachMatch = t.match(/\$(\d+\.?\d+)\s+each\s+\(est\.\)/);
        const rangeMatch = t.match(/\$\s*(\d+\.?\d*)\s*[-–]\s*\$\s*(\d+\.?\d*)/);
        const singleMatch = !eachMatch && !rangeMatch && t.match(/^\$(\d{1,4}\.\d{2})$/);

        let price = null;
        if (eachMatch) price = parseFloat(eachMatch[1]);
        else if (rangeMatch) price = Math.max(parseFloat(rangeMatch[1]), parseFloat(rangeMatch[2]));
        else if (singleMatch) price = parseFloat(singleMatch[1]);

        if (price && price > 1 && price < 5000) {
          // Find nearby product name
          for (let j = Math.max(0, i - 4); j <= Math.min(texts.length - 1, i + 4); j++) {
            if (j === i) continue;
            const c = texts[j];
            if (c.length > 8 && c.length < 120 &&
                !c.match(/^\$/) &&
                !c.match(/^[\d\s\.\/\#]+$/) &&
                !c.match(/Bin|stock|Add|Skip|Cart|Login|Search|Buy|more|eligible|Pickup|Delivery/i) &&
                c.split(" ").length >= 2) {
              results.push({ name: c, price, raw: t });
              break;
            }
          }
        }
      }
      return results;
    });

    console.log(`RD: extracted ${items.length} raw items`);
    if (items.length > 0) console.log("RD sample:", JSON.stringify(items.slice(0, 3)));
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
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36");

    // ── Step 1: Enter email at shop.sysco.com ─────────────────────────────
    await page.goto("https://shop.sysco.com/auth/login", { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));
    console.log("Sysco step1:", page.url());

    // Type email
    await page.waitForSelector('input[type="email"]', { timeout: 15000 });
    await page.evaluate((email) => {
      const el = document.querySelector('input[type="email"]');
      if (el) { el.focus(); el.value = email; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }
    }, process.env.SYSCO_EMAIL);
    await new Promise(r => setTimeout(r, 1000));
    console.log("Sysco: email filled");

    // Click Next (first submit button)
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button[type="submit"]'));
      const next = btns.find(b => b.textContent.trim() === "Next");
      if (next) next.click();
      else if (btns[0]) btns[0].click();
    });
    console.log("Sysco: clicked Next");

    // Wait for redirect to secure.sysco.com (Okta)
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 4000));
    console.log("Sysco step2:", page.url());

    // ── Step 2: Enter password at secure.sysco.com (Okta) ────────────────
    // If still on shop.sysco.com, try again
    if (page.url().includes("shop.sysco.com/auth/login")) {
      console.log("Still on login page, trying keyboard submit...");
      await page.focus('input[type="email"]');
      await page.keyboard.press("Enter");
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 3000));
      console.log("After keyboard enter:", page.url());
    }

    // Now on secure.sysco.com - find password field
    await page.waitForSelector('#okta-signin-password, input[type="password"]', { timeout: 20000 });
    await new Promise(r => setTimeout(r, 1000));
    console.log("Sysco: password page ready, URL:", page.url());

    // Fill password using Okta's exact field id
    await page.evaluate((pw) => {
      const el = document.querySelector('#okta-signin-password') || document.querySelector('input[type="password"]');
      if (el) { el.focus(); el.value = pw; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }
    }, process.env.SYSCO_PASSWORD);
    await new Promise(r => setTimeout(r, 500));
    console.log("Sysco: password filled");

    // Click Log In - Okta uses input[type="submit"] with id="okta-signin-submit"
    await page.evaluate(() => {
      const btn = document.querySelector('#okta-signin-submit') ||
                  document.querySelector('input[type="submit"]') ||
                  document.querySelector('button[type="submit"]');
      if (btn) btn.click();
    });

    // Wait for redirect back to shop.sysco.com
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 5000));
    console.log("Sysco logged in:", page.url());

    if (!page.url().includes("shop.sysco.com")) {
      throw new Error("Sysco login failed - still at: " + page.url());
    }

    // ── Step 3: Go to Nick List ───────────────────────────────────────────
    await page.goto("https://shop.sysco.com/app/lists", { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(r => setTimeout(r, 4000));
    console.log("Sysco lists:", page.url());

    // Find Nick List URL from sidebar links
    const nickUrl = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a"));
      const nick = links.find(a => a.textContent.trim().toLowerCase().includes("nick list") ||
                                   a.textContent.trim().toLowerCase() === "nick list");
      return nick ? nick.href : null;
    });
    console.log("Nick List URL:", nickUrl);

    if (nickUrl) {
      await page.goto(nickUrl, { waitUntil: "networkidle2", timeout: 30000 });
    } else {
      // Click on Nick List in the sidebar
      await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll("a, span, div, li"));
        const nick = links.find(el =>
          el.textContent.trim().toLowerCase().includes("nick list") &&
          el.textContent.trim().length < 30
        );
        if (nick) (nick.closest("a") || nick).click();
      });
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 10000 }).catch(() => {});
    }
    await new Promise(r => setTimeout(r, 4000));
    console.log("Nick List page:", page.url());

    // ── Step 4: Scroll and extract items ────────────────────────────────
    for (let i = 0; i < 40; i++) {
      await page.evaluate(() => window.scrollBy(0, 600));
      await new Promise(r => setTimeout(r, 300));
    }
    await new Promise(r => setTimeout(r, 3000));

    // Extract using Sysco's exact CSS classes from dev tools
    const items = await page.evaluate(() => {
      const results = [];

      // Use exact classes: .product-item-row-group, .item-details-col, .price-col
      const rows = document.querySelectorAll(".product-item-row-group, .product-item-row-grouped, [class*='product-item-row']");
      console.log("Sysco rows found:", rows.length);

      rows.forEach(row => {
        const nameEl = row.querySelector("[class*='item-details-col'], [class*='item-desc']");
        const priceEl = row.querySelector("[class*='price-col']");
        if (nameEl && priceEl) {
          const name = nameEl.textContent.trim().split("\n")[0].trim();
          const priceText = priceEl.textContent.trim();
          const m = priceText.match(/\$([\d,]+\.[\d]{2})/);
          if (m && name.length > 3) {
            results.push({ name, price: parseFloat(m[1].replace(",", "")), raw: priceText });
          }
        }
      });

      // Fallback: grab all price-col elements
      if (results.length === 0) {
        document.querySelectorAll("[class*='price-col']").forEach(pc => {
          const m = pc.textContent.match(/\$([\d,]+\.[\d]{2})/);
          if (!m) return;
          const price = parseFloat(m[1].replace(",", ""));
          if (price < 1 || price > 10000) return;
          const row = pc.closest("[class*='row'], tr, li");
          if (row) {
            const nameEl = row.querySelector("[class*='item-details'], [class*='description']");
            const name = nameEl ? nameEl.textContent.trim().split("\n")[0].trim() : "";
            if (name.length > 3) results.push({ name, price, raw: pc.textContent.trim() });
          }
        });
      }

      return results;
    });

    console.log(`Sysco: ${items.length} items extracted`);
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
