require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const cron = require("node-cron");

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "../build")));

// ── Price store — persisted to disk so Railway restarts keep data ─────────────
const fs = require("fs");
const PRICES_FILE = "/data/nc_prices.json";

// Max reasonable price per RD item — if scraper returns higher, it grabbed wrong item
const RD_SINGLE_UNIT = new Set(["42647","55519","42504"]); // sold per-unit not per-case (Mint, Flowers, Cucumbers)
const RD_PRICE_MAX = {
  "42647":  15,   // Mint 1 lb (~$5-8)
  "55519":  25,   // Orchid Flowers (~$5-15)
  "1070496": 20,  // Morton Salt 50lb (~$8-12)
  "77658":  150,  // Chicken Leg Meat 40lb (~$50-120)
  "77670":  150,  // Chicken Leg Quarters 40lb (~$30-100)
  "77232":  200,  // Chicken Breast 40lb (~$60-150)
  "77682":  200,  // Chicken Thighs 40lb (~$60-150)
  "77200":  200,  // Chicken Wings 40lb (~$60-150)
  "79042":  500,  // Lamb Leg (~$150-400)
  "1810019": 200, // Goat Bone-in 15lb (~$50-150)
  // NOTE: 86525 Frozen Peas removed — $38.20 IS the correct Case-of-12 price (12×2.5lb=30lb)
};

// Minimum acceptable RD case price — rejects per-lb prices stored without ×weight multiplication
const RD_PRICE_MIN = {
  "77658":  25,  // Chicken Leg Meat 40lb — per-lb would be ~$3-5, case must be $25+
  "77670":  25,  // Chicken Leg Quarters 40lb
  "77232":  30,  // Chicken Breast 40lb
  "77682":  30,  // Chicken Thighs 40lb
  "77200":  30,  // Chicken Wings 40lb
  "79042":  50,  // Lamb Leg 40lb
  "1810019": 20, // Goat Bone-in 15lb
};

// Minimum acceptable Sysco case price — rejects search fallback unit/per-pack prices
// Keyed by Sysco UPC AND by RD ID (both forms get checked since prices stored under both)
const SYSCO_PRICE_MIN = {
  // Chicken items — 40lb cases, minimum floor prevents per-10lb-pack price storage
  "4418117": 20,  // Chicken Leg Quarters Jumbo 1/40LB — $29.59 confirmed
  "77670":   20,  // same item stored under RD ID
  "0868459": 20,  // Chicken Leg Meat 4×10lb = 40lb case
  "77658":   20,  // same item stored under RD ID
  "5231238": 25,  // Chicken Breast 40lb
  "77232":   25,  // same under RD ID
  "6344790": 25,  // Chicken Wings 40lb
  "77200":   25,  // same under RD ID
  // Peeled Garlic — large case, min prevents single-bag price
  "1821537": 15,  // Peeled Garlic 20lb
  "44146":   15,  // same under RD ID
  // NOTE: Serrano Peppers 7007376/44137 removed — $2.98 CS for 1-pack 40LB IS the real case price
};

// Maximum acceptable Sysco case price — rejects wrong search results (different product found)
const SYSCO_PRICE_MAX = {
  "2037125": 15,   // Mint 1lb — $6.10 confirmed; >$15 is wrong product
  "42647":   15,   // same under RD ID
  "1053826": 55,   // Frozen Peas 12/2.5LB — $35.92 confirmed; $63.95 was wrong (old 6409940 bleed)
  "86525":   55,   // same item stored under RD ID
};


function loadPrices() {
  try {
    if (fs.existsSync(PRICES_FILE)) {
      const data = JSON.parse(fs.readFileSync(PRICES_FILE, "utf8"));
      console.log("✅ Loaded prices from disk: RD=" + Object.keys(data.rd || {}).length + " Sysco=" + Object.keys(data.sysco || {}).length);
      return data;
    }
  } catch(e) { console.log("Could not load prices:", e.message); }
  return { rd: {}, sysco: {}, lastUpdated: null, oos: { rd: [], sysco: [] } };
}

function savePrices() {
  try {
    fs.writeFileSync(PRICES_FILE, JSON.stringify({
      rd: priceStore.rd,
      sysco: priceStore.sysco,
      lastUpdated: priceStore.lastUpdated,
      oos: priceStore.oos
    }));
  } catch(e) { console.log("Could not save prices:", e.message); }
}

// ── GitHub backup ─────────────────────────────────────────────────────────────
async function githubCommit(token, repo, filePath, content, message) {
  const apiBase = "https://api.github.com/repos/" + repo + "/contents/" + filePath;
  const headers = {
    "Authorization": "token " + token,
    "Content-Type": "application/json",
    "User-Agent": "naan-curry-price-tracker",
  };
  let sha = null;
  try {
    const get = await fetch(apiBase, { headers });
    if (get.ok) { const j = await get.json(); sha = j.sha; }
  } catch {}
  const body = { message, content, ...(sha ? { sha } : {}) };
  const put = await fetch(apiBase, { method: "PUT", headers, body: JSON.stringify(body) });
  if (put.ok) return true;
  const err = await put.json().catch(() => ({}));
  throw new Error(err.message || put.status);
}

async function backupToGitHub() {
  const token = process.env.GITHUB_TOKEN;
  const repo  = process.env.GITHUB_REPO;
  if (!token || !repo) { log("GitHub backup: skipped (no GITHUB_TOKEN or GITHUB_REPO)"); return; }
  try {
    const data = {
      rd: priceStore.rd, sysco: priceStore.sysco,
      lastUpdated: priceStore.lastUpdated, oos: priceStore.oos || { rd: [], sysco: [] },
      matchCache, crossVendor: SYSCO_TO_RD,
    };
    const encoded = Buffer.from(JSON.stringify(data, null, 2)).toString("base64");
    const date = new Date().toISOString().slice(0, 10);
    await githubCommit(token, repo, "backup/prices.json", encoded, "Price backup " + date);
    log("✅ GitHub backup: prices.json committed to " + repo);
    const hEncoded = Buffer.from(JSON.stringify(priceHistory)).toString("base64");
    await githubCommit(token, repo, "backup/history.json", hEncoded, "History backup " + date);
    log("✅ GitHub backup: history.json committed");
  } catch(e) { log("❌ GitHub backup error: " + e.message); }
}

async function restoreFromGitHub() {
  const token = process.env.GITHUB_TOKEN;
  const repo  = process.env.GITHUB_REPO;
  if (!token || !repo) return;
  const hasLocal = Object.keys(priceStore.rd).length > 0;
  if (hasLocal) { log("Restore: local prices exist, skipping GitHub restore"); return; }
  try {
    log("Restore: no local prices, fetching from GitHub backup...");
    const apiBase = "https://api.github.com/repos/" + repo + "/contents/backup/prices.json";
    const r = await fetch(apiBase, {
      headers: { "Authorization": "token " + token, "User-Agent": "naan-curry-price-tracker" }
    });
    if (!r.ok) { log("Restore: no backup found on GitHub (" + r.status + ")"); return; }
    const j = await r.json();
    const data = JSON.parse(Buffer.from(j.content, "base64").toString("utf8"));
    if (data.rd) {
      priceStore.rd = Object.fromEntries(Object.entries(data.rd).map(([id, entry]) => [
        id, { ...entry, confidence: entry.confidence === "high" ? "medium" : "low", source: entry.source || "restored" }
      ]));
    }
    if (data.sysco) {
      priceStore.sysco = Object.fromEntries(Object.entries(data.sysco).map(([id, entry]) => [
        id, { ...entry, confidence: entry.confidence === "high" ? "medium" : "low", source: entry.source || "restored" }
      ]));
    }
    if (data.lastUpdated) { priceStore.lastUpdated = data.lastUpdated; }
    if (data.oos) { priceStore.oos = data.oos; }
    if (data.matchCache) { matchCache = data.matchCache; }
    if (data.crossVendor) {
      Object.assign(SYSCO_TO_RD, data.crossVendor);
      Object.assign(SYSCO_TO_RD, SYSCO_TO_RD_LOCK);
    }
    cleanBadPrices();
    savePrices(); saveCache(); saveCrossVendor();
    log("✅ Restore: " + Object.keys(priceStore.rd).length + " RD + " + Object.keys(priceStore.sysco).length + " Sysco prices restored from GitHub");
    try {
      const hBase = "https://api.github.com/repos/" + repo + "/contents/backup/history.json";
      const hR = await fetch(hBase, { headers: { "Authorization": "token " + token, "User-Agent": "naan-curry-price-tracker" } });
      if (hR.ok) {
        const hJ = await hR.json();
        const githubHistory = JSON.parse(Buffer.from(hJ.content, "base64").toString("utf8"));
        Object.entries(githubHistory).forEach(([id, entries]) => {
          if (!priceHistory[id]) {
            priceHistory[id] = entries;
          } else {
            const localDates = new Set(priceHistory[id].map(e => e.date));
            const toAdd = entries.filter(e => !localDates.has(e.date));
            priceHistory[id] = [...priceHistory[id], ...toAdd]
              .sort((a, b) => a.date.localeCompare(b.date)).slice(-90);
          }
        });
        saveHistory();
        log("✅ Restore: history merged for " + Object.keys(priceHistory).length + " items");
      }
    } catch(e) { log("History restore error: " + e.message); }
    recordHistory();
    try {
      const kbBase = "https://api.github.com/repos/" + repo + "/contents/backup/item_knowledge.json";
      const kbR = await fetch(kbBase, { headers: { "Authorization": "token " + token, "User-Agent": "naan-curry-price-tracker" } });
      if (kbR.ok) {
        const kbJ = await kbR.json();
        itemKnowledge = JSON.parse(Buffer.from(kbJ.content, "base64").toString("utf8"));
        patchItemKnowledge();
        saveItemKnowledge();
        log("✅ Restore: item knowledge base restored for " + Object.keys(itemKnowledge).length + " items");
      }
    } catch(e) { log("Item KB restore error: " + e.message); }
  } catch(e) { log("Restore error: " + e.message); }
}

const _loaded = loadPrices();
let priceStore = { ..._loaded, log: [], oos: _loaded.oos || { rd: [], sysco: [] } };

function cleanBadPrices() {
  let cleaned = 0;
  // Paneer (1440528): Sysco price is per-lb, case = 10lb total. Multiply if stored wrong.
  const paneerEntry = priceStore.sysco["1440528"];
  if (paneerEntry?.price && paneerEntry.price < 20) {
    const corrected = Math.round(paneerEntry.price * 10 * 100) / 100;
    log("Startup fix: Paneer $" + paneerEntry.price + "/lb → case $" + corrected);
    priceStore.sysco["1440528"] = { ...paneerEntry, price: corrected };
    priceStore.sysco["7102961"] = { ...paneerEntry, price: corrected };
    savePrices();
  }
  Object.entries(priceStore.rd).forEach(([id, entry]) => {
    const max = RD_PRICE_MAX[id];
    if (max && entry.price > max) {
      delete priceStore.rd[id]; cleaned++;
      console.log("🧹 Cleaned bad cached price: " + id + " was $" + entry.price + " (max $" + max + ")");
      return;
    }
    const min = RD_PRICE_MIN[id];
    if (min && entry.price < min) {
      delete priceStore.rd[id]; cleaned++;
      console.log("🧹 Cleaned bad cached price: " + id + " was $" + entry.price + " (min $" + min + ")");
    }
  });
  Object.entries(priceStore.sysco).forEach(([id, entry]) => {
    const min = SYSCO_PRICE_MIN[id];
    if (min && entry.price < min) {
      delete priceStore.sysco[id]; cleaned++;
      console.log("🧹 Cleaned bad Sysco cached price: " + id + " was $" + entry.price + " (min $" + min + ")");
      return;
    }
    const max = SYSCO_PRICE_MAX[id];
    if (max && entry.price > max) {
      delete priceStore.sysco[id]; cleaned++;
      console.log("🧹 Cleaned bad Sysco cached price: " + id + " was $" + entry.price + " (max $" + max + ")");
    }
  });
  Object.entries(priceStore.rd).forEach(([id, entry]) => {
    if (RD_SINGLE_UNIT.has(id) && !RD_PRICE_MAX[id] && entry.price > 25) {
      delete priceStore.rd[id]; cleaned++;
      console.log("🧹 Cleaned bad single-unit cached price: " + id + " was $" + entry.price);
    }
  });
  const CHICKEN_THIGHS_PRICE = 76.30;
  Object.entries(priceStore.sysco).forEach(([id, entry]) => {
    const isChickenId = ["8053456","77232","77658","77670","77682","77200"].includes(id);
    if (!isChickenId && entry.syscoUpc === "8053456") {
      delete priceStore.sysco[id]; cleaned++;
      console.log("🧹 Cleaned Chicken Thighs (8053456) wrongly cross-mapped to " + id);
    }
    if (!isChickenId && entry.price === CHICKEN_THIGHS_PRICE && !["21039","440038","440039","440040","50103"].includes(id)) {
      delete priceStore.sysco[id]; cleaned++;
      console.log("🧹 Cleaned $76.30 Chicken Thighs contamination from Sysco[" + id + "]");
    }
  });
  if (cleaned > 0) savePrices();
}

const log = (msg) => {
  console.log(msg);
  priceStore.log.unshift({ time: new Date().toISOString(), msg });
  if (priceStore.log.length > 500) priceStore.log.pop();
};

// ── Match cache ───────────────────────────────────────────────────────────────
const CACHE_FILE = "/data/nc_match_cache.json";
let matchCache = { rd: {}, sysco: {} };

const CACHE_SEED = {
  rd: {
    "Fresh Boneless Skinless Chicken Leg Meat": "77658",
    "Boneless Skinless Chicken Leg Meat": "77658",
    "Fresh Boneless Skinless Chicken\nLeg Meat": "77658",
    "Fresh Chicken Leg Quarters - 40 lbs": "77670",
    "Boneless Skinless Chicken Breasts": "77232",
    "Herb - Mint - 1 lb": "42647",
    "Herb - Mint- 1 lb": "42647",
    "Herb - Mint-1 lb": "42647",
    "Herb Mint 1 lb": "42647",
    "Jumbo Chicken Party Wings 6-8 ct": "77200",
    "Thomas Farms - Bone in Goat Cube - #15": "1810019",
    "Frozen Halal Boneless Lamb Leg, Australia": "79042",
    "Frozen Halal Boneless Lamb Leg Australia": "79042",
    "James Farm - Plain Yogurt - 32 lbs": "14785",
    "MILK WHL GAL GS/AN": "370496",
    "James Farm - Heavy Cream, 40% - 64 oz": "1530438",
    "James Farm - Heavy Cream 40% - 64 oz": "1530438",
    "Royal Mahout - Paneer Loaf - 5 lbs": "1440528",
    "Chef's Quality - Clear Liquid Fry Oil, zero trans fats - 35 lbs": "1020077",
    "Royal Chef's Secret - Extra Long Grain Basmati Rice - 40 lbs": "490266",
    "Chef's Quality - Liquid Butter Alternative - gallon": "1020152",
    "Evian - Natural Spring Water, 24 Ct, 500 mL": "21039",
    "Peeled Garlic": "44146",
    "Taylor Farms - Bagged Cilantro": "42566",
    "Jumbo Spanish Onions - 50 lbs": "42545",
    "Jumbo Red Onions - 25 lbs": "42658",
    "Russet Potato - 50 lb": "42725",
    "Carrots - 10 lb": "79152",
    "Boneless, Skinless Chicken Breasts, Tenders Out, Dry": "77232",
    "White Cauliflower - 1 ct": "42606",
    "White Cauliflower": "42606",
    "Morton - Purex Salt - 50lb": "1070496",
    "Morton Purex Salt 50lb": "1070496",
    "Purex Salt - 50lb": "1070496",
    "Green Onions, Rootless & Iceless - 4 lbs": "40138",
    "Green Onions Rootless Iceless 4 lbs": "40138",
    "Green Bell Pepper - 5 lb bag": "42706",
    "Green Pepper, 5 lb bag": "42706",
    "Green Bell Peppers 5 lb": "42706",
    "Chef's Quality - Tomato Ketchup Jug - #10 size": "2010066",
    "Chef's Quality - Tomato Ketchup Jug": "2010066",
    "Tomato Ketchup Jug #10": "2010066",
    "Sunset 7313 - POS Thermal Printer Rolls - 10 pk": "50103",
    "POS Thermal Printer Rolls": "50103",
    "Thermal Printer Rolls 10": "50103",
    "Coca-Cola Bottles 16.9 fl oz 24 Pack": "440038",
    "Coca Cola Bottles 16.9 fl oz 24 Pack": "440038",
  },
  sysco: {
    "Chicken Cvp Leg Quarter Small Halal": "1803287",
    "Chicken Legs Quarters Jumbo Controlled Vacuum": "4418117",
    "Chicken Leg Quarter Jumbo": "4418117",
    "Chicken Cvp Leg Meat Boneless Skinless": "0868459",
    "Flour All Purpose Hotel Restaurant Bleached": "8379251",
    "Tomato Puree 1.06 Fancy California": "4002325",
    "Milk Whole Gallon": "4676306",
    "Oil Soybean Vegetable Pure": "4119079",
    "Sugar Granulated Extra Fine Cane": "5087572",
    "Shortening Fry Liquid Clear Zero Trans Fat": "4518403",
    "Butter-it Alternative Liquid Zero Trans Fat": "3355757",
    "Juice Lemon Pasteurized Ultra Premium": "4063095",
    "Potato Baking Russet 40 Count Fresh": "1543164",
    "Chicken Breast Boneless Skinless": "5231238",
    "Pan Coating Butter It": "6914451",
    "Pan Spray All Purpose": "6914451",
    "Cheese Cheddar Jack Fancy Shredded": "2822379",
    "Salt Granulated Plain": "4564894",
    "Cilantro Fresh": "7078475",
    "Chicken Wings 1st And 2nd Joints Jumbo": "6344790",
    "Onion Red Jumbo Bag": "1094663",
    "Garlic Peeled Fresh": "1821537",
    "Ginger Root Fresh": "1184902",
    "Cauliflower Cello Wrapped Fresh": "1243724",
    "Tilapia Fillet Boneless Skinless Iqf": "0496671",
    "Pea Green Packaged": "1053826",
    "Pea Green Petit Grade A Packaged": "6409940",
    "Milk Coconut Unsweetened": "1425982",
    "Paste Chili Ground Sambal Oelek": "2638660",
    "Vinegar White Distilled 50 Grain": "4113049",
    "Water Spring In Plastic Bottle": "2886075",
    "Shrimp White Peeled And Deveined 16/20": "5106388",
    "Coloring Food Egg Shade Yellow": "4112262",
    "Oil Salad Canola Zero Trans Fat": "4119079",
    "Corn Starch Food Grade": "4073441",
    "Powder Baking Double Acting": "5517701",
    "Broccoli Floret Poly Packaging Grade A": "6988158",
    "Spinach Chopped Bag": "2523833",
    "Demand Cheese Paneer": "7102961",
    "Spinach Baby Fresh": "8474538",
    "Carrots Loose Fresh": "3879962",
    "Lemon Choice Fresh": "2252013",
    "Cucumber Select Fresh": "7410640",
    "Pepper Serrano Util": "7007376",
    "Mint Fresh Herb": "2037125",
    "Vegetable Mix 4-way": "3960200",
    "Flour Wheat Whole Stone Ground": "4014684",
    "Bean Garbanzo Fancy No Sulfite": "4062337",
    "Bean Kidney Dark Red": "4014973",
    "Tomato Diced Salsa Style": "5895750",
    "Onion Yellow Jumbo Bag": "1094721",
    "Cream Heavy Whipping 40%": "6935464",
    "Cream Heavy Whipping": "6935464",
    "Cream Heavy 40%": "6935464",
    "Paneer": "7102961",
    "Cilantro Cleaned, Washed & Fresh Herb": "2219095",
    "Cilantro Washed Fresh Herb": "2219095",
    "Cilantro Bunch Iceless": "7078475",
    "Sauce Tomato California": "4978884",
    "Tomato Sauce California": "4978884",
    "Pepper Green Bell Choice Fresh": "1910231",
    "Ketchup Jug Red In Plastic Bottle With Pump": "9903790",
    "Ketchup Jug Red Plastic Bottle": "9903790",
  }
};

const scraperHealth = {
  rd:    { expectedItems: 63, minThreshold: 0.80, lastGoodCount: 0 },
  sysco: { expectedItems: 51, minThreshold: 0.80, lastGoodCount: 0 },
};

async function checkScraperHealth(vendor, scrapedCount, matchedCount) {
  const health = scraperHealth[vendor];
  const threshold = Math.floor(health.expectedItems * health.minThreshold);
  if (matchedCount >= threshold) {
    health.lastGoodCount = matchedCount;
    if (matchedCount > health.expectedItems) health.expectedItems = matchedCount;
    log("✅ Scraper health [" + vendor + "]: " + matchedCount + "/" + health.expectedItems + " items — healthy");
    return { healthy: true, matchedCount };
  }
  log("⚠️ Scraper health [" + vendor + "]: only " + matchedCount + "/" + health.expectedItems + " items scraped (threshold: " + threshold + ")");
  const prompt = `A web scraper returned fewer items than expected for a restaurant price tracker.

Vendor: ${vendor === "rd" ? "Restaurant Depot" : "Sysco"}
Expected items: ${health.expectedItems}
Items scraped today: ${matchedCount}
Last good scrape: ${health.lastGoodCount} items

This could mean:
1. The vendor's website had a partial load / timeout
2. The vendor changed their page layout
3. Many items are genuinely out of stock

Should we: (a) keep yesterday's prices for missing items and mark them as stale, or (b) accept partial data?

Return ONLY JSON: {"action":"keep_yesterday|accept_partial","reason":"brief explanation","severity":"low|medium|high"}`;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 300, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await r.json();
    const txt = data.content?.find(b => b.type === "text")?.text || "{}";
    const m = txt.match(/\{[\s\S]*\}/);
    const decision = m ? JSON.parse(m[0]) : { action: "keep_yesterday", reason: "parse error", severity: "medium" };
    log("🤖 Scraper health decision [" + vendor + "]: " + decision.action + " — " + decision.reason + " (severity: " + decision.severity + ")");
    return { healthy: false, action: decision.action, reason: decision.reason, severity: decision.severity, matchedCount };
  } catch(e) {
    log("Scraper health check error: " + e.message);
    return { healthy: false, action: "keep_yesterday", reason: "health check failed", matchedCount };
  }
}

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
      matchCache = {
        rd:    { ...(saved.rd    || {}), ...CACHE_SEED.rd    },
        sysco: { ...(saved.sysco || {}), ...CACHE_SEED.sysco },
      };
    } else {
      matchCache = { rd: { ...CACHE_SEED.rd }, sysco: { ...CACHE_SEED.sysco } };
    }
    const rdCount = Object.keys(matchCache.rd).length;
    const scCount = Object.keys(matchCache.sysco).length;
    console.log("✅ Match cache ready: RD=" + rdCount + " Sysco=" + scCount + " mappings");
  } catch(e) {
    console.log("Cache load error:", e.message);
    matchCache = { rd: { ...CACHE_SEED.rd }, sysco: { ...CACHE_SEED.sysco } };
  }
  const CACHE_CORRECTIONS = {
    rd: {
      "Herb - Mint- 1 lb":  "42647",
      "Herb - Mint - 1 lb": "42647",
      "Herb - Mint-1 lb":   "42647",
    }
  };
  let corrected = 0;
  Object.entries(CACHE_CORRECTIONS.rd || {}).forEach(([name, correctId]) => {
    if (matchCache.rd[name] && matchCache.rd[name] !== correctId) {
      console.log("🔧 Cache correction: '" + name + "' " + matchCache.rd[name] + " → " + correctId);
      matchCache.rd[name] = correctId;
      corrected++;
    }
  });
  if (corrected > 0) { saveCache(); console.log("✅ Fixed " + corrected + " bad cache entries"); }
}

function saveCache() {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(matchCache, null, 2)); }
  catch(e) { console.log("Cache save error:", e.message); }
}

function learnMatch(source, scrapedName, itemId) {
  if (!matchCache[source]) matchCache[source] = {};
  if (!matchCache[source][scrapedName]) {
    matchCache[source][scrapedName] = itemId;
    saveCache();
    log("🧠 Learned: [" + source + "] \"" + scrapedName + "\" → " + itemId);
  }
}

loadCache();

// ── RD Items ──────────────────────────────────────────────────────────────────
const RD_ITEMS = [
  { id: "860135",  name: "Isabella - Petite Diced Tomatoes -#10 cans" },
  { id: "860043",  name: "Chef's Quality - Tomato Puree - 6 lb Can" },
  { id: "860044",  name: "Chef's Quality - Tomato Sauce - #10 cans" },
  { id: "45900",   name: "Chef's Quality - White Vinegar - gallon" },
  { id: "12728",   name: "Chef's Quality - All Purpose Pan Spray - 17 oz" },
  { id: "1020152", name: "Chef's Quality - Liquid Butter Alternative - gallon" },
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
  { id: "40138",   name: "Green Onions, Rootless & Iceless - 4 lbs" },
  { id: "42706",   name: "Green Bell Pepper - 5 lb bag" },
  { id: "2010066", name: "Chef's Quality - Tomato Ketchup Jug - #10" },
  { id: "50103",   name: "Sunset 7313 - POS Thermal Printer Rolls - 10 pk" },
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
  { id: "43431",   name: "Green Bell Peppers - 9 ct" },
  { id: "42566",   name: "Taylor Farms - Bagged Cilantro" },
  { id: "42606",   name: "White Cauliflower - 1 ct" },
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

// ── Sysco Nick List ────────────────────────────────────────────────────────────
const SYSCO_ITEMS = [
  { id: "1094721", name: "Onion Yellow Jumbo Bag",                           pack: "1/50 LB"   },
  { id: "4418117", name: "Chicken Legs Quarters Jumbo Controlled Vacuum",    pack: "1/40 LB"   },
  { id: "0868459", name: "Chicken Cvp Leg Meat Boneless Skinless",           pack: "4 x 10 LB" },
  { id: "8379251", name: "Flour All Purpose Hotel Restaurant Bleached",      pack: "1/25LB"    },
  { id: "4002325", name: "Tomato Puree 1.06 Fancy California",               pack: "6/#10"     },
  { id: "6935464", name: "Cream Heavy 40% Extended Shelf Life Stabilized",  pack: "12/32 OZ"  },
  { id: "4676306", name: "Milk Whole Gallon",                                pack: "4/1 GAL"   },
  { id: "4119079", name: "Oil Soybean Vegetable Pure",                       pack: "1/35LB"    },
  { id: "5087572", name: "Sugar Granulated Extra Fine Cane",                 pack: "1/25LB"    },
  { id: "4518403", name: "Shortening Fry Liquid Clear Zero Trans Fat",       pack: "1/35LB"    },
  { id: "3355757", name: "Butter-it Alternative Liquid Zero Trans Fat",      pack: "3/1 GAL"   },
  { id: "4063095", name: "Juice Lemon Pasteurized Ultra Premium",            pack: "6/.5 GAL"  },
  { id: "1543164", name: "Potato Baking Russet 40 Count Fresh",             pack: "1/50LB"    },
  { id: "5231238", name: "Chicken Breast Boneless Skinless",                 pack: "4/10 LB"   },
  { id: "6914451", name: "Pan Coating Butter It",                            pack: "6/14 OZ"   },
  { id: "2822379", name: "Cheese Cheddar Jack Fancy Shredded",               pack: "4/5 LB"    },
  { id: "4564894", name: "Salt Granulated Plain",                            pack: "1/50 LB"   },
  { id: "2219095", name: "Cilantro Cleaned, Washed & Fresh Herb",           pack: "4/1 LB"    },
  { id: "6344790", name: "Chicken Wings 1st And 2nd Joints Jumbo",          pack: "4/10 LB"   },
  { id: "1094663", name: "Onion Red Jumbo Bag",                              pack: "1/25LB"    },
  { id: "1821537", name: "Garlic Peeled Fresh",                              pack: "4/5LB"     },
  { id: "1184902", name: "Ginger Root Fresh",                                pack: "1/30 LB"   },
  { id: "1243724", name: "Cauliflower Cello Wrapped Fresh",                  pack: "12/1EA"    },
  { id: "0496671", name: "Tilapia Fillet Boneless Skinless Iqf",            pack: "2/5LB"     },
  { id: "1053826", name: "Pea Green Packaged",                               pack: "12/2.5LB"  },
  { id: "1425982", name: "Milk Coconut Unsweetened",                         pack: "24/13.5OZ" },
  { id: "2638660", name: "Paste Chili Ground Sambal Oelek",                  pack: "3/136 OZ"  },
  { id: "4113049", name: "Vinegar White Distilled 50 Grain",                 pack: "4/1 GAL"   },
  { id: "2886075", name: "Water Spring In Plastic Bottle",                   pack: "24/500ML"  },
  { id: "5106388", name: "Shrimp White Peeled And Deveined 16/20",          pack: "4/2.5 LB"  },
  { id: "4112262", name: "Coloring Food Egg Shade Yellow",                   pack: "4/1 GAL"   },
  { id: "4073441", name: "Corn Starch Food Grade",                           pack: "24/1 LB"   },
  { id: "5517701", name: "Powder Baking Double Acting",                      pack: "6/5 LB"    },
  { id: "6988158", name: "Broccoli Floret Poly Packaging Grade A",           pack: "12/2 LB"   },
  { id: "2523833", name: "Spinach Chopped Bag",                              pack: "12/3LB"    },
  { id: "7102961", name: "Demand Cheese Paneer",                             pack: "2/5 LB"    },
  { id: "8474538", name: "Spinach Baby Fresh",                               pack: "1 x 4 LB"  },
  { id: "3879962", name: "Carrots Loose Fresh",                              pack: "1/10 LB"   },
  { id: "2252013", name: "Lemon Choice Fresh",                               pack: "1/115 CT"  },
  { id: "7410640", name: "Cucumber Select Fresh",                            pack: "1/5 LB"    },
  { id: "7007376", name: "Pepper Serrano Util",                              pack: "1/40 LB"   },
  { id: "2037125", name: "Mint Fresh Herb",                                  pack: "1/1 LB"    },
  { id: "3960200", name: "Vegetable Mix 4-way",                              pack: "1/30 LB"   },
  { id: "4014684", name: "Flour Wheat Whole Stone Ground",                   pack: "1/50LB"    },
  { id: "4062337", name: "Bean Garbanzo Fancy No Sulfite",                   pack: "6/#10"     },
  { id: "4014973", name: "Bean Kidney Dark Red",                             pack: "6/#10"     },
  { id: "4978884", name: "Sauce Tomato California",                          pack: "6/#10"     },
  { id: "7350788", name: "Onion Green Iceless",                              pack: "4/2 LB"    },
  { id: "1910231", name: "Pepper Green Bell Choice Fresh",                   pack: "1/22-25#"  },
  { id: "9903790", name: "Ketchup Jug Red In Plastic Bottle With Pump",     pack: "6/114 OZ"  },
];

// ── Cross-vendor map ───────────────────────────────────────────────────────────
const SYSCO_TO_RD_SEED = {
  "4418117": { rdId: "77670",   rdMult: 1 }, // Chicken Leg Quarters Jumbo 1/40LB
  "0868459": { rdId: "77658",   rdMult: 1 }, // Chicken Leg Meat
  "5231238": { rdId: "77232",   rdMult: 1 }, // Chicken Breast
  "6344790": { rdId: "77200",   rdMult: 1 }, // Chicken Wings
  "8379251": { rdId: "2061212", rdMult: 1 }, // Flour AP
  "4002325": { rdId: "860043",  rdMult: 1 }, // Tomato Puree → must NOT be 860044
  "4676306": { rdId: "370496",  rdMult: 1 }, // Whole Milk
  "4119079": { rdId: "1020075", rdMult: 1 }, // Soybean Oil
  "5087572": { rdId: "21051",   rdMult: 1 }, // Sugar
  "4518403": { rdId: "1020077", rdMult: 1 }, // Fryer Oil
  "3355757": { rdId: "1020152", rdMult: 1 }, // Liquid Butter
  "4063095": { rdId: "55523",   rdMult: 1 }, // Lemon Juice
  "1543164": { rdId: "42725",   rdMult: 1 }, // Russet Potato
  "6914451": { rdId: "12728",   rdMult: 1 }, // Pan Spray
  "4564894": { rdId: "1070496", rdMult: 1 }, // Salt
  "2219095": { rdId: "42566",   rdMult: 1 }, // Cilantro 4/1LB
  "2822379": { rdId: "1440203", rdMult: 1 }, // Cheddar Jack
  "1821537": { rdId: "44146",   rdMult: 1 }, // Garlic Peeled
  "1094663": { rdId: "42658",   rdMult: 1 }, // Red Onion
  "1184902": { rdId: "42513",   rdMult: 1 }, // Ginger
  "1243724": { rdId: "42606",   rdMult: 1 }, // Cauliflower
  "0496671": { rdId: "51457",   rdMult: 1 }, // Tilapia
  "1053826": { rdId: "86525",   rdMult: 1 }, // Frozen Peas 12/2.5LB
  "1425982": { rdId: "2620442", rdMult: 1 }, // Coconut Milk
  "2638660": { rdId: "13417",   rdMult: 1 }, // Sambal
  "4113049": { rdId: "45900",   rdMult: 1 }, // White Vinegar
  "2886075": { rdId: "21039",   rdMult: 1 }, // Evian Water
  "5106388": { rdId: "40212",   rdMult: 1 }, // Shrimp 16/20
  "4112262": { rdId: "2550012", rdMult: 1 }, // Egg Yellow Color
  "4073441": { rdId: "2910159", rdMult: 1 }, // Cornstarch
  "5517701": { rdId: "29268",   rdMult: 1 }, // Baking Powder
  "6988158": { rdId: "64120",   rdMult: 1 }, // Frozen Broccoli
  "2523833": { rdId: "64046",   rdMult: 1 }, // Frozen Spinach
  "7102961": { rdId: "1440528", rdMult: 1 }, // Paneer
  "8474538": { rdId: "44211",   rdMult: 1 }, // Baby Spinach
  "3879962": { rdId: "79152",   rdMult: 1 }, // Carrots
  "2252013": { rdId: "42570",   rdMult: 1 }, // Lemons
  "7410640": { rdId: "42504",   rdMult: 1 }, // Cucumbers
  "7007376": { rdId: "44137",   rdMult: 1 }, // Serrano
  "2037125": { rdId: "42647",   rdMult: 1 }, // Mint
  "3960200": { rdId: "86527",   rdMult: 1 }, // Frozen 4-Way Mix
  "4014684": { rdId: "53556",   rdMult: 1 }, // Roti Atta
  "4062337": { rdId: "16200",   rdMult: 1 }, // Garbanzo Beans
  "4014973": { rdId: "69810",   rdMult: 1 }, // Kidney Beans
  "5895750": { rdId: "860135",  rdMult: 1 }, // Petite Diced Tomato
  "4978884": { rdId: "860044",  rdMult: 1 }, // Tomato Sauce CA
  "6935464": { rdId: "1530438", rdMult: 1 }, // Heavy Cream 12×32oz
  "7350788": { rdId: "40138",   rdMult: 1 }, // Green Onions EA split
  "1910231": { rdId: "42706",   rdMult: 1 }, // Green Bell Pepper
  "9903790": { rdId: "2010066", rdMult: 1 }, // Ketchup 6/114oz
  "1094721": { rdId: "42545",   rdMult: 1 }, // Yellow Onion
};

// Locked — override seed AND any saved/backup data. Use for known-wrong auto-learned mappings.
const SYSCO_TO_RD_LOCK = {
  "4002325": { rdId: "860043",  rdMult: 1 }, // Tomato Puree → must be 860043, NEVER 860044
  "5895750": { rdId: "860135",  rdMult: 1 }, // Diced Tomato → must be 860135, NEVER 860044
  "8053456": { rdId: null,      rdMult: 1 }, // Chicken Thighs Sysco — not tracked in RD, block
};

const CROSS_VENDOR_FILE = "/data/nc_cross_vendor.json";
let SYSCO_TO_RD = { ...SYSCO_TO_RD_SEED };

function loadCrossVendor() {
  try {
    if (fs.existsSync(CROSS_VENDOR_FILE)) {
      const saved = JSON.parse(fs.readFileSync(CROSS_VENDOR_FILE, "utf8"));
      SYSCO_TO_RD = { ...SYSCO_TO_RD_SEED, ...saved, ...SYSCO_TO_RD_LOCK };
      console.log("✅ Cross-vendor map loaded: " + Object.keys(SYSCO_TO_RD).length + " mappings");
    }
  } catch(e) { console.log("Cross-vendor load error:", e.message); }
}

function saveCrossVendor() {
  try { fs.writeFileSync(CROSS_VENDOR_FILE, JSON.stringify(SYSCO_TO_RD, null, 2)); }
  catch(e) { console.log("Cross-vendor save error:", e.message); }
}

loadCrossVendor();

// ── Price history ─────────────────────────────────────────────────────────────
const HISTORY_FILE = "/data/nc_history.json";
let priceHistory = {};

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      priceHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
      const count = Object.keys(priceHistory).length;
      const dates = new Set();
      Object.values(priceHistory).forEach(entries => entries.forEach(e => dates.add(e.date)));
      console.log("✅ History loaded: " + count + " items, " + dates.size + " dates: " + [...dates].sort().join(", "));
    }
  } catch(e) { console.log("History load error:", e.message); }
}

function saveHistory() {
  try {
    const data = JSON.stringify(priceHistory);
    fs.writeFileSync(HISTORY_FILE, data);
    try { fs.writeFileSync("/tmp/nc_history_backup.json", data); } catch {}
  } catch(e) { console.log("History save error:", e.message); }
}

function loadHistoryFallback() {
  try {
    if (fs.existsSync("/tmp/nc_history_backup.json")) {
      const backup = JSON.parse(fs.readFileSync("/tmp/nc_history_backup.json", "utf8"));
      let added = 0;
      Object.entries(backup).forEach(([id, entries]) => {
        if (!priceHistory[id]) { priceHistory[id] = entries; added += entries.length; return; }
        const localDates = new Set(priceHistory[id].map(e => e.date));
        const toAdd = entries.filter(e => !localDates.has(e.date));
        if (toAdd.length > 0) {
          priceHistory[id] = [...priceHistory[id], ...toAdd].sort((a,b) => a.date.localeCompare(b.date)).slice(-90);
          added += toAdd.length;
        }
      });
      if (added > 0) { saveHistory(); console.log("✅ History fallback: merged " + added + " entries from /tmp backup"); }
    }
  } catch(e) { console.log("History fallback error:", e.message); }
}

function recordHistory() {
  const now = new Date();
  const lvOffset = -7 * 60; // PDT (UTC-7)
  const lvTime = new Date(now.getTime() + (now.getTimezoneOffset() + lvOffset) * 60000);
  const today = lvTime.toISOString().slice(0, 10);
  let changed = false;
  const allIds = new Set([...Object.keys(priceStore.rd), ...Object.keys(priceStore.sysco)]);
  allIds.forEach(id => {
    const rdP = priceStore.rd[id]?.price || null;
    const scP = priceStore.sysco[id]?.price || null;
    if (!rdP && !scP) return;
    if (!priceHistory[id]) priceHistory[id] = [];
    const existing = priceHistory[id].findIndex(e => e.date === today);
    if (existing >= 0) {
      const old = priceHistory[id][existing];
      priceHistory[id][existing] = { date: today, rd: rdP || old.rd || null, sc: scP || old.sc || null };
    } else {
      priceHistory[id] = [...priceHistory[id].slice(-89), { date: today, rd: rdP, sc: scP }];
    }
    changed = true;
  });
  if (changed) { saveHistory(); log("📅 History recorded: " + allIds.size + " items for " + today); }
}

loadHistory();
loadHistoryFallback();
cleanBadPrices();

// ── AI cross-vendor linker ────────────────────────────────────────────────────
async function buildCrossVendorMap(syscoMatched, rdMatched) {
  const unmapped = syscoMatched.filter(s => !SYSCO_TO_RD[s.id]);
  if (unmapped.length === 0) { log("Cross-vendor: all Sysco items already mapped"); return; }
  log("Cross-vendor: finding RD equivalents for " + unmapped.length + " unmapped Sysco items...");
  const syscoPriceCtx = unmapped.map(s => {
    const item = SYSCO_ITEMS.find(i => i.id === s.id);
    const p = priceStore.sysco[s.id]?.price;
    return s.id + ": " + (item ? item.name + " " + item.pack : s.id) + (p ? " @ $" + p : "");
  }).join("\n");
  const rdPriceCtx = RD_ITEMS.map(i => {
    const p = priceStore.rd[i.id]?.price;
    return i.id + ": " + i.name + (p ? " @ $" + p : "");
  }).join("\n");
  const prompt = `You are an expert wholesale grocery buyer linking equivalent products between Sysco and Restaurant Depot for Naan & Curry restaurant in Las Vegas.

SYSCO ITEMS TO MATCH (with pack size and current price):
${syscoPriceCtx}

RESTAURANT DEPOT ITEMS (with current price):
${rdPriceCtx}

For each Sysco item, find the Restaurant Depot item that is the SAME product.
Skip if genuinely different products or you are not confident.
Return ONLY JSON array: [{"sysco_id":"SYSCO_UPC","rd_id":"RD_ITEM_ID","reason":"one line explanation","confidence":"high|medium"}]`;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await r.json();
    const txt = data.content?.find(b => b.type === "text")?.text || "[]";
    const m = txt.match(/\[[\s\S]*\]/);
    if (!m) { log("Cross-vendor: no JSON found in AI response"); return; }
    const links = JSON.parse(m[0]);
    let newLinks = 0;
    links.forEach(({ sysco_id, rd_id, reason }) => {
      if (sysco_id && rd_id && !SYSCO_TO_RD[sysco_id]) {
        SYSCO_TO_RD[sysco_id] = rd_id;
        newLinks++;
        log("🔗 New cross-vendor link: Sysco " + sysco_id + " → RD " + rd_id + " (" + reason + ")");
      }
    });
    if (newLinks > 0) { saveCrossVendor(); log("Cross-vendor: " + newLinks + " new links saved (" + Object.keys(SYSCO_TO_RD).length + " total)"); }
    else { log("Cross-vendor: no new links found"); }
  } catch(e) { log("Cross-vendor AI error: " + e.message); }
}

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
function wordScore(a, b) {
  const stopWords = new Set(["the","and","for","with","from","lbs","lb","oz","gal","ct","pk","pack","case","fresh","frozen","boneless","skinless"]);
  const aw = a.toLowerCase().split(/[\s\-,\/]+/).filter(w => w.length > 2 && !stopWords.has(w));
  const bw = b.toLowerCase().split(/[\s\-,\/]+/).filter(w => w.length > 2 && !stopWords.has(w));
  let score = 0;
  aw.forEach(w => { if (bw.some(bx => bx.includes(w) || w.includes(bx))) score += w.length; });
  bw.forEach(w => { if (aw.some(ax => ax.includes(w) || w.includes(ax))) score += w.length; });
  return score;
}

async function matchWithAI(scrapedItems, itemList, source) {
  if (!scrapedItems.length) return [];
  const cacheKey = source === "Restaurant Depot" ? "rd" : "sysco";
  const cache = matchCache[cacheKey] || {};
  const results = [], usedIds = new Set(), needsMatching = [];
  for (const scraped of scrapedItems) {
    const cachedId = cache[scraped.name];
    if (cachedId && itemList.find(i => i.id === cachedId)) {
      if (!usedIds.has(cachedId)) {
        results.push({ id: cachedId, price: scraped.price, unitPrice: scraped.unitPrice });
        usedIds.add(cachedId);
        log("📋 Cache hit: \"" + scraped.name + "\" → " + cachedId);
      }
    } else { needsMatching.push(scraped); }
  }
  log(source + ": " + (scrapedItems.length - needsMatching.length) + "/" + scrapedItems.length + " from cache, " + needsMatching.length + " need matching");
  const stillUnmatched = [];
  for (const scraped of needsMatching) {
    let bestId = null, bestScore = 0;
    for (const item of itemList) {
      if (usedIds.has(item.id)) continue;
      const score = wordScore(scraped.name, item.name);
      if (score > bestScore) { bestScore = score; bestId = item.id; }
    }
    if (bestId && bestScore >= 6) {
      results.push({ id: bestId, price: scraped.price, unitPrice: scraped.unitPrice });
      usedIds.add(bestId);
      learnMatch(cacheKey, scraped.name, bestId);
      log("✅ Word match: \"" + scraped.name + "\" → " + bestId + " (score=" + bestScore + ")");
    } else {
      stillUnmatched.push(scraped);
      log("❓ No word match: \"" + scraped.name + "\" (best score=" + bestScore + ")");
    }
  }
  const unmatchedListItems = itemList.filter(i => !usedIds.has(i.id));
  if (stillUnmatched.length > 0 && unmatchedListItems.length > 0) {
    log(source + ": sending " + stillUnmatched.length + " items to AI...");
    try {
      const prompt = "You are a grocery product matcher for a restaurant. Match each scraped product name to the correct item ID from our list.\n\nSCRAPED PRODUCTS:\n" +
        stillUnmatched.map(i => "\"" + i.name + "\"  $" + i.price).join("\n") +
        "\n\nOUR ITEM LIST:\n" + unmatchedListItems.map(i => i.id + ": " + i.name).join("\n") +
        "\n\nReturn ONLY a JSON array. One entry per confident match:\n[{\"scraped\":\"exact scraped name\",\"id\":\"ITEM_ID\",\"price\":0.00}]\nSkip any you are not confident about.";
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
      });
      const data = await r.json();
      const txt = data.content?.find(b => b.type === "text")?.text || "[]";
      const m = txt.match(/\[[\s\S]*\]/);
      if (m) {
        JSON.parse(m[0]).forEach(({ scraped, id, price }) => {
          if (id && price > 0 && !usedIds.has(id)) {
            const origItem = scrapedItems.find(i => i.name === scraped);
            results.push({ id, price, unitPrice: origItem?.unitPrice });
            usedIds.add(id);
            if (scraped) learnMatch(cacheKey, scraped, id);
            log("🤖 AI match: \"" + (scraped || "?") + "\" → " + id + " $" + price);
          }
        });
      }
    } catch(e) { log("AI error: " + e.message); }
  }
  log(source + ": total matched " + results.length + "/" + scrapedItems.length);
  return results;
}

// ── Browser launch ────────────────────────────────────────────────────────────
async function launchBrowser() {
  const chromium = require("@sparticuz/chromium");
  const puppeteer = require("puppeteer-core");
  const execPath = await chromium.executablePath();
  return puppeteer.launch({
    args: [...chromium.args, "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--single-process"],
    executablePath: execPath, headless: chromium.headless, timeout: 30000,
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
    await page.goto("https://member.restaurantdepot.com/", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));
    const inStoreSet = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll("button, a, div, span"));
      const inStore = els.find(el => el.textContent.trim() === "In-Store" || el.textContent.trim() === "In-Store Las Vegas");
      if (inStore) { inStore.click(); return "clicked: " + inStore.textContent.trim(); }
      const current = document.body.innerText;
      return current.includes("In-Store") ? "already set" : "not found";
    });
    log("RD: In-Store mode = " + inStoreSet);
    await new Promise(r => setTimeout(r, 2000));
    await page.goto(
      "https://member.restaurantdepot.com/store/business/order-guide/19933806363004568",
      { waitUntil: "domcontentloaded", timeout: 60000 }
    ).catch(e => log("RD order guide: " + e.message));
    await new Promise(r => setTimeout(r, 8000));
    log("RD: order guide loaded, URL=" + page.url());
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(r => setTimeout(r, 1000));
    for (let i = 0; i < 50; i++) {
      await page.evaluate(() => window.scrollBy(0, 500));
      await new Promise(r => setTimeout(r, 300));
    }
    await new Promise(r => setTimeout(r, 3000));
    const lines = await page.evaluate(() =>
      document.body.innerText.split("\n").map(l => l.trim()).filter(l => l.length > 0)
    );
    log("RD: " + lines.length + " lines total");

    const priceLines = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = line.match(/Current price:\s*\$([\d,]+\.[\d]{2})/i);
      if (!m) continue;
      const unitPrice = parseFloat(m[1].replace(",", ""));
      if (unitPrice < 0.5 || unitPrice > 5000) continue;
      const isByWeight = /each\s*\(est/i.test(line) || /final cost by weight/i.test(line);
      let casePrice = unitPrice, raw = line;
      if (!isByWeight) {
        for (let k = i + 1; k <= Math.min(i + 2, lines.length - 1); k++) {
          const rangeLine = lines[k];
          const rangeM = rangeLine.match(/^\$([\d]+)-([\d]+)$/) ||
                         rangeLine.match(/^\$([\d]+)-\$([\d]+)$/) ||
                         rangeLine.match(/^\$([\d,]+\.\d{2})\s*-\s*\$([\d,]+\.\d{2})$/);
          if (rangeM) {
            const raw1 = rangeM[1].replace(",",""), raw2 = rangeM[2].replace(",","");
            const lo = raw1.includes(".") ? parseFloat(raw1) : parseInt(raw1) / 100;
            const hi = raw2.includes(".") ? parseFloat(raw2) : parseInt(raw2) / 100;
            casePrice = Math.max(lo, hi);
            raw = line + " → case=" + casePrice;
            break;
          }
        }
      } else {
        const nearby = lines.slice(Math.max(0, i - 5), Math.min(lines.length, i + 10)).join(" ");
        const perLbM = nearby.match(/\$([\d]+\.[\d]{2})\s*\/\s*lb/i);
        if (perLbM) {
          const perLb = parseFloat(perLbM[1]);
          const aboutLbM = nearby.match(/About\s+([\d.]+)\s+lb/i);
          const pageWeight = aboutLbM ? parseFloat(aboutLbM[1]) : null;
          const ctxLower = nearby.toLowerCase();
          let caseWeight;
          if (ctxLower.includes("goat")) { caseWeight = 15; }
          else if (ctxLower.includes("lamb")) { caseWeight = pageWeight || 42; }
          else if (ctxLower.includes("chicken") || ctxLower.includes("wings") ||
                   ctxLower.includes("breast") || ctxLower.includes("thigh") ||
                   ctxLower.includes("leg meat") || ctxLower.includes("leg quarter") ||
                   ctxLower.includes("leg")) { caseWeight = 40; }
          else { caseWeight = pageWeight || 40; }
          casePrice = Math.round(perLb * caseWeight * 100) / 100;
          raw = line + " ($" + perLb + "/lb × " + caseWeight + "lb = $" + casePrice + ")";
          log("RD: by-weight — $" + perLb + "/lb × " + caseWeight + "lb = $" + casePrice);
        } else {
          const estM = nearby.match(/Price estimate:\s*\$([\d,]+\.[\d]{2})/i);
          if (estM) { casePrice = parseFloat(estM[1].replace(",", "")); raw = line + " (est=" + casePrice + ")"; }
          else { raw = line + " (by weight)"; }
        }
      }
      if (casePrice < 0.5 || casePrice > 5000) continue;
      const ctx = lines.slice(Math.max(0, i - 10), Math.min(lines.length, i + 15));
      priceLines.push({ price: casePrice, unitPrice, raw, byWeight: isByWeight, ctx: ctx.join(" | ") });
    }
    log("RD: found " + priceLines.length + " price lines");

    const noise = new Set([
      "Skip Navigation","Buy It Again","Order Guides","Products","Equipment","Receipts",
      "Monthly Flyer","Back to Home","Many in stock","Add","Skip","Show similar","Back",
      "Las Vegas","Pickup","Delivery","Order history","Account settings","Addresses",
      "Payment methods","Credits and promos","Your saved lists","Notification settings",
      "Out of stock","Likely out of stock","Temporarily out of stock","Currently out of stock","Item unavailable","See eligible items","Explore popular","Whole","Dairy free",
      "Order approvals","Business settings","Log out","Restaurant Depot","Items","Members",
      "Settings","Delivery available","each (est.)","each (estimated)","Final cost by weight","Price estimate","Caffeinated",
      "Caffeine free","Gluten free","Sugar free","Alcohol free","In-Store","DietSugar free",
    ]);

    function isProductName(c) {
      if (!c || c.length < 8 || c.length > 130) return false;
      if (/^\$/.test(c)) return false;
      if (/^[\d\s.\-/#x$]+$/.test(c)) return false;
      if (/^\d+\s*(oz|lb|gal|ct|#|z|lbs|fl)\s*$/i.test(c)) return false;
      if (/^(Current price|Buy \d|Pickup|Out of stock|Show similar|See eligible|Buy It Again|Add \d+|Edit items|Order approvals|Business|Log out|Delivery|About \d|Bin -|\d+\.\d+ mi)/.test(c)) return false;
      if (/arrow keys|search field|Once you|navigate to|Enter key/i.test(c)) return false;
      if (/^\d+ ct$|^1 ct$|^[A-Z0-9]+ - \d+$/.test(c)) return false;
      if (noise.has(c)) return false;
      if (!/[a-zA-Z]{3,}/.test(c)) return false;
      if (c.split(" ").length < 2) return false;
      return true;
    }

    const items = [], seen = new Set();
    for (let pi = 0; pi < priceLines.length; pi++) {
      const pl = priceLines[pi];
      const ctxLines = pl.ctx.split(" | ").map(l => l.trim()).filter(l => l);
      const priceIdx = ctxLines.findIndex(l => l.startsWith("Current price:") && l.includes("$" + pl.unitPrice.toFixed(2)));
      let bestName = null;
      if (priceIdx >= 0) {
        for (let j = priceIdx + 1; j < Math.min(ctxLines.length, priceIdx + 10); j++) {
          const c = ctxLines[j];
          if (/^\$[\d]+-/.test(c) || /^\$[\d]+$/.test(c)) continue;
          if (isProductName(c) && !seen.has(c)) { bestName = c; break; }
        }
        if (!bestName) {
          for (let j = priceIdx - 1; j >= Math.max(0, priceIdx - 10); j--) {
            const c = ctxLines[j];
            if (/^\$[\d]+-/.test(c) || /^\$[\d]+$/.test(c)) continue;
            if (isProductName(c) && !seen.has(c)) { bestName = c; break; }
          }
        }
      } else {
        for (let j = 0; j < ctxLines.length; j++) {
          const c = ctxLines[j];
          if (/^\$/.test(c) || /Current price/.test(c)) continue;
          if (isProductName(c) && !seen.has(c)) { bestName = c; break; }
        }
      }
      if (bestName && pl.price > 0) {
        const tentativeId = Object.entries(matchCache.rd || {}).find(([k]) => k === bestName)?.[1];
        const priceMax = tentativeId ? RD_PRICE_MAX[tentativeId] : null;
        if (priceMax && pl.price > priceMax) {
          log("RD: ⚠️ Rejecting name '" + bestName + "' for $" + pl.price + " (max $" + priceMax + " for this item)");
        } else {
          items.push({ name: bestName, price: pl.price, unitPrice: pl.unitPrice, raw: pl.raw });
          seen.add(bestName);
        }
      } else {
        log("RD: no name for $" + pl.price + " | " + ctxLines.filter(isProductName).join(" / "));
      }
    }

    const singleUnitNames = {
      "42647":  ["Herb - Mint", "Mint - 1 lb", "Herb - Mint-"],
      "55519":  ["Orchid Flowers", "Micro Orchid"],
      "77658":  ["Chicken Leg Meat", "Boneless Skinless Chicken Leg Meat", "Chicken\nLeg Meat"],
      "77232":  ["Boneless Skinless Chicken Breast", "Chicken Breast", "Tenders Out"],
      "77670":  ["Chicken Leg Quarters", "Leg Quarters"],
      "1810019":["Bone in Goat", "Goat Cube"],
      "79042":  ["Boneless Lamb Leg", "Halal Boneless Lamb"],
    };
    for (const [itemId, nameVariants] of Object.entries(singleUnitNames)) {
      const alreadyFound = items.find(i => {
        const cache = matchCache.rd || {};
        return Object.entries(cache).find(([k, v]) => v === itemId && i.name === k);
      });
      if (alreadyFound) continue;
      for (let li = 0; li < lines.length; li++) {
        const lineText = lines[li], ltLower = lineText.toLowerCase();
        const matched = nameVariants.some(v => {
          const vLower = v.toLowerCase();
          if (itemId === "77658" && ltLower.includes("quarter")) return false;
          if (itemId === "77670" && ltLower.includes("leg meat")) return false;
          return ltLower.includes(vLower);
        });
        if (!matched) continue;
        let foundPrice = null;
        for (let offset = -10; offset <= 10; offset++) {
          const idx = li + offset;
          if (idx < 0 || idx >= lines.length) continue;
          const pm = lines[idx].match(/Current price:\s*\$([\d.]+)/i);
          if (pm) {
            const p = parseFloat(pm[1]);
            const max = RD_PRICE_MAX[itemId], min = RD_PRICE_MIN[itemId];
            if (p > 0 && (!max || p <= max) && (!min || p >= min)) { foundPrice = p; break; }
          }
        }
        if (foundPrice) {
          const itemName = lineText.trim();
          if (isProductName(itemName) && !seen.has(itemName)) {
            items.push({ name: itemName, price: foundPrice, raw: "targeted scan: $" + foundPrice });
            seen.add(itemName);
            log("RD: 🎯 Targeted scan found " + itemId + " '" + itemName + "' = $" + foundPrice);
          } else {
            const cacheName = Object.entries(matchCache.rd || {}).find(([k, v]) => v === itemId)?.[0];
            if (cacheName && !seen.has(cacheName)) {
              items.push({ name: cacheName, price: foundPrice, raw: "targeted scan: $" + foundPrice });
              seen.add(cacheName);
              log("RD: 🎯 Targeted scan found " + itemId + " (cache name) = $" + foundPrice);
            }
          }
          break;
        }
      }
    }

    const OOS_PATTERNS = [/^out of stock$/i,/^likely out of stock$/i,/^temporarily out of stock$/i,/^currently out of stock$/i,/^item unavailable$/i,/^unavailable$/i];
    function isOosLine(line) { return OOS_PATTERNS.some(p => p.test(line.trim())); }
    const oosNames = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!isOosLine(line)) continue;
      let foundName = null;
      for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
        const prev = lines[j].trim();
        if (/Current price/i.test(prev)) break;
        if (isProductName(prev)) { foundName = prev; break; }
      }
      if (!foundName) {
        for (let j = i + 1; j <= Math.min(lines.length - 1, i + 4); j++) {
          const next = lines[j].trim();
          if (/Current price/i.test(next)) break;
          if (isProductName(next)) { foundName = next; break; }
        }
      }
      if (foundName && !seen.has(foundName)) { oosNames.push(foundName); seen.add(foundName); log("RD: OOS confirmed [" + line.trim() + "]: " + foundName); }
    }
    log("RD: out-of-stock names found (" + oosNames.length + "): " + oosNames.join(", "));
    log("RD: " + items.length + " items extracted");
    return { success: true, items, oosNames };
  } catch(e) {
    log("RD FATAL: " + e.message);
    return { success: false, error: e.message, items: [] };
  } finally {
    if (browser) { try { await browser.close(); } catch(e) {} }
  }
}

// ── Sysco Scraper ─────────────────────────────────────────────────────────────
async function scrapeSysco() {
  log("🔵 Sysco: starting Nick List search scrape...");
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36");
    page.setDefaultTimeout(30000);
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

    await page.goto("https://shop.sysco.com/app/lists", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 4000));
    let nickClicked = null;
    for (let attempt = 0; attempt < 15; attempt++) {
      nickClicked = await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll("li, a, button, div, span"));
        for (const el of all) {
          if (el.children.length > 5) continue;
          const t = el.textContent.trim();
          if (t.toLowerCase().includes("nick list") && t.length < 30) { el.click(); return el.tagName + ": " + t; }
        }
        return null;
      });
      if (nickClicked) { log("Sysco: Nick List=" + nickClicked); break; }
      await new Promise(r => setTimeout(r, 1000));
    }
    if (!nickClicked) throw new Error("Nick List not found");
    await new Promise(r => setTimeout(r, 4000));
    let rows = 0;
    for (let w = 0; w < 15; w++) {
      rows = await page.evaluate(() => document.querySelectorAll("[class*='product-item-row']").length);
      if (rows > 0) { log("Sysco: Nick List loaded, " + rows + " rows visible"); break; }
      await new Promise(r => setTimeout(r, 1000));
    }
    const searchInput = await page.$('input[placeholder*="Search List"], input[placeholder*="search list"], [data-id="myProductSearch"], input[aria-label*="Search List"]');
    if (!searchInput) {
      const inputs = await page.evaluate(() =>
        Array.from(document.querySelectorAll("input")).map(i => ({ type: i.type, placeholder: i.placeholder, ariaLabel: i.getAttribute("aria-label"), id: i.id, name: i.name }))
      );
      log("Sysco: inputs on page: " + JSON.stringify(inputs));
      throw new Error("Search List input not found");
    }
    log("Sysco: Search List input found");
    await searchInput.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    await new Promise(r => setTimeout(r, 2000));
    await page.evaluate(async () => {
      const container = document.querySelector("[class*='product-list']") || document.querySelector("[class*='list-items']") || document.querySelector("[class*='products-list']") || document.querySelector("[class*='order-guide']") || document.querySelector("main") || document.body;
      for (let s = 0; s < 40; s++) {
        container.scrollTop = s * 400;
        window.scrollBy(0, 400);
        await new Promise(r => setTimeout(r, 150));
      }
      container.scrollTop = 0;
      window.scrollTo(0, 0);
    });
    await new Promise(r => setTimeout(r, 2000));

    const allDiscovered = await page.evaluate(() => {
      const SELECTORS = ["[class*='product-item-row']","[class*='list-row']","[class*='product-row']","[class*='item-row']","li[class*='product']","[data-testid*='product']"];
      let rows = [];
      for (const sel of SELECTORS) { const found = document.querySelectorAll(sel); if (found.length > 0) { rows = Array.from(found); break; } }
      const found = [];
      rows.forEach(row => {
        const text = row.innerText || "";
        const upcM = text.match(/\b(\d{7})\b/);
        const csM = text.match(/\$([\d,]+\.[\d]{2})\s*CS/i);
        const anyM = text.match(/\$([\d,]+\.[\d]{2})/);
        const m = csM || anyM;
        const nameEl = row.querySelector("[class*='item-details-col'], [class*='product-name'], [class*='item-name']");
        const name = (nameEl ? nameEl.innerText : text).trim().split("\n")[0].trim();
        if (upcM && m && name) found.push({ upc: upcM[1], name, price: parseFloat(m[1].replace(",", "")), raw: m[0] });
      });
      return found;
    });

    const knownIds = new Set(SYSCO_ITEMS.map(i => i.id));
    let newItemsFound = 0;
    allDiscovered.forEach(disc => {
      if (!knownIds.has(disc.upc)) {
        SYSCO_ITEMS.push({ id: disc.upc, name: disc.name, pack: "" });
        knownIds.add(disc.upc);
        newItemsFound++;
        log("Sysco: 🆕 New SKU discovered: " + disc.upc + " " + disc.name);
      }
    });
    if (newItemsFound > 0) log("Sysco: " + newItemsFound + " new SKUs added to list");

    const allItems = new Map();
    allDiscovered.forEach(disc => { allItems.set(disc.upc, { name: disc.name, price: disc.price, upc: disc.upc, raw: disc.raw }); });
    log("Sysco: bulk discovery got " + allItems.size + " items");

    for (const item of SYSCO_ITEMS) {
      if (allItems.has(item.id)) continue;
      try {
        const SEARCH_OVERRIDES = {"7102961":"Paneer","0868459":"Chicken Leg Meat","4418117":"Chicken Leg Quarter Jumbo","5231238":"Chicken Breast Boneless","6344790":"Chicken Wings Jumbo","9903790":"Ketchup Jug Pump","7350788":"Onion Green Iceless","1910231":"Pepper Green Bell","6935464":"Cream Heavy 40%","2219095":"Cilantro Cleaned Herb","4978884":"Sauce Tomato California"};
        const keyword = SEARCH_OVERRIDES[item.id] || item.name.split(" ").slice(0, 2).join(" ");
        await searchInput.click({ clickCount: 3 });
        await page.keyboard.type(keyword, { delay: 50 });
        await new Promise(r => setTimeout(r, 1200));
        const results = await page.evaluate((upc) => {
          const SELECTORS = ["[class*='product-item-row']","[class*='list-row']","[class*='product-row']","[class*='search-result']","[class*='item-row']","li[class*='product']","[data-testid*='product']"];
          let rows = [];
          for (const sel of SELECTORS) { const found = document.querySelectorAll(sel); if (found.length > 0) { rows = Array.from(found); break; } }
          const results = [];
          rows.forEach(row => {
            const text = row.innerText || "";
            const hasUpc = text.includes(upc);
            const csM = text.match(/\$([\d,]+\.[\d]{2})\s*CS/i);
            const anyM = text.match(/\$([\d,]+\.[\d]{2})/);
            const m = csM || anyM;
            if (m) results.push({ name: text.split("\n")[0].trim(), price: parseFloat(m[1].replace(",", "")), raw: m[0], hasUpc });
          });
          if (results.length === 0) {
            const bodyText = document.body.innerText || "";
            if (bodyText.includes(upc)) {
              const idx = bodyText.indexOf(upc);
              const nearby = bodyText.slice(Math.max(0, idx - 300), idx + 300);
              const csM = nearby.match(/\$([\d,]+\.[\d]{2})\s*CS/i);
              const anyM = nearby.match(/\$([\d,]+\.[\d]{2})/);
              const m = csM || anyM;
              if (m) results.push({ name: nearby.split("\n").find(l => l.trim().length > 3) || "unknown", price: parseFloat(m[1].replace(",", "")), raw: m[0], hasUpc: true });
            }
          }
          return results;
        }, item.id);
        const exact = results.find(r => r.hasUpc), best = exact || results[0];
        if (best) {
          log("Sysco: " + item.name + " → $" + best.price + " (search fallback)");
          allItems.set(item.id, { name: item.name, price: best.price, upc: item.id, raw: best.raw });
        } else {
          const diagInfo = await page.evaluate(() => {
            const allClasses = new Set();
            document.querySelectorAll("[class]").forEach(el => el.className.toString().split(/\s+/).forEach(c => { if (c.includes("row") || c.includes("product") || c.includes("item") || c.includes("price") || c.includes("list")) allClasses.add(c); }));
            return { classHints: [...allClasses].slice(0, 10), hasCS: (document.body.innerText || "").includes("CS") };
          });
          log("Sysco: " + item.name + " not found in search" + (diagInfo.hasCS ? " (CSS class changed?)" : " (no CS prices — empty or different layout)") + " classes:" + diagInfo.classHints.join(","));
        }
        await searchInput.click({ clickCount: 3 });
        await page.keyboard.press("Backspace");
        await new Promise(r => setTimeout(r, 500));
      } catch(e) { log("Sysco: error on " + item.name + ": " + e.message); }
    }

    const items = Array.from(allItems.values());
    log("Sysco: " + items.length + " items total");
    return { success: true, items };
  } catch(e) {
    log("Sysco FATAL: " + e.message);
    return { success: false, error: e.message, items: [] };
  } finally {
    if (browser) { try { await browser.close(); } catch(e) {} }
  }
}

function withTimeout(p, ms, name) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(name + " timed out")), ms))]);
}

async function crossValidatePrices() {
  const paired = [];
  Object.entries(SYSCO_TO_RD).forEach(([syscoId, mapping]) => {
    const rdId = mapping.rdId || mapping;
    const rdEntry = priceStore.rd[rdId];
    const scEntry = priceStore.sysco[rdId];
    if (!rdEntry?.price || !scEntry?.price) return;
    const rdItem = RD_ITEMS.find(i => i.id === rdId);
    const scItem = SYSCO_ITEMS.find(i => i.id === syscoId);
    const ratio = rdEntry.price / scEntry.price;
    if (ratio > 3 || ratio < 0.33) {
      paired.push({ rdId, syscoId, rdName: rdItem?.name || rdId, scName: scItem?.name || syscoId, rdPrice: rdEntry.price, scPrice: scEntry.price, ratio: ratio.toFixed(2) });
    }
  });
  if (paired.length === 0) { log("Cross-validation: all vendor pairs look reasonable ✅"); return; }
  log("Cross-validation: " + paired.length + " suspicious price pairs — asking Claude...");
  const prompt = `You are validating wholesale grocery prices for a restaurant. Flag any prices that are clearly wrong.

SUSPICIOUS PRICE PAIRS (one vendor is 3× or more the other):
${paired.map(p => `${p.rdName}: RD=$${p.rdPrice} vs Sysco=$${p.scPrice} (ratio=${p.ratio}x)`).join("\n")}

Return ONLY JSON array:
[{"rdId":"RD_ID","errorVendor":"rd|sysco|none","reason":"brief explanation"}]`;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await r.json();
    const txt = data.content?.find(b => b.type === "text")?.text || "[]";
    const m = txt.match(/\[[\s\S]*\]/);
    if (!m) return;
    JSON.parse(m[0]).forEach(({ rdId, errorVendor, reason }) => {
      if (errorVendor === "rd" && priceStore.rd[rdId]) {
        priceStore.rd[rdId].confidence = "low";
        priceStore.rd[rdId].crossValidationFlag = reason;
        log("🚨 Cross-validation: RD price for " + rdId + " flagged (" + reason + ")");
      } else if (errorVendor === "sysco" && priceStore.sysco[rdId]) {
        priceStore.sysco[rdId].confidence = "low";
        priceStore.sysco[rdId].crossValidationFlag = reason;
        log("🚨 Cross-validation: Sysco price for " + rdId + " flagged (" + reason + ")");
      } else if (errorVendor === "none") {
        if (priceStore.rd[rdId]) priceStore.rd[rdId].confidence = "high";
        if (priceStore.sysco[rdId]) priceStore.sysco[rdId].confidence = "high";
        log("✅ Cross-validation confirmed: " + rdId + " (" + reason + ")");
      }
    });
    savePrices();
    log("Cross-validation complete");
  } catch(e) { log("Cross-validation error: " + e.message); }
}

async function validatePricesWithAI(vendor) {
  const store = vendor === "rd" ? priceStore.rd : priceStore.sysco;
  const suspicious = [];
  Object.entries(store).forEach(([id, entry]) => {
    const itemHistory = priceHistory[id] || [];
    if (itemHistory.length < 2) return;
    const prev = itemHistory[itemHistory.length - 2];
    const prevPrice = vendor === "rd" ? prev.rd : prev.sc;
    if (!prevPrice || !entry.price) return;
    const changePct = Math.abs((entry.price - prevPrice) / prevPrice) * 100;
    if (changePct > 20) {
      const itemList = vendor === "rd" ? RD_ITEMS : SYSCO_ITEMS;
      const item = itemList.find(i => i.id === id);
      suspicious.push({ id, name: item?.name || id, prev: prevPrice, current: entry.price, changePct: Math.round(changePct) });
    }
  });
  if (suspicious.length === 0) { log("Price validation: no suspicious changes detected"); return; }
  log("Price validation: " + suspicious.length + " suspicious price changes — asking AI...");
  const prompt = `You are validating wholesale grocery prices for a restaurant. Review these price changes and identify likely scraping errors.

PRICE CHANGES (>20% overnight):
${suspicious.map(s => `${s.name}: $${s.prev} → $${s.current} (${s.changePct}% change)`).join("\n")}

Return ONLY JSON array:
[{"id":"ITEM_ID","verdict":"valid|error","reason":"brief explanation"}]`;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await r.json();
    const txt = data.content?.find(b => b.type === "text")?.text || "[]";
    const m = txt.match(/\[[\s\S]*\]/);
    if (!m) return;
    JSON.parse(m[0]).forEach(({ id, verdict, reason }) => {
      if (verdict === "error") {
        const prev = suspicious.find(s => s.id === id)?.prev;
        if (prev) {
          if (vendor === "rd") priceStore.rd[id] = { ...priceStore.rd[id], price: prev, flagged: true };
          else priceStore.sysco[id] = { ...priceStore.sysco[id], price: prev, flagged: true };
          log("🤖 Price validation: REVERTED " + id + " → $" + prev + " (" + reason + ")");
        }
      } else {
        if (vendor === "rd" && priceStore.rd[id]) priceStore.rd[id].confidence = "high";
        else if (priceStore.sysco[id]) priceStore.sysco[id].confidence = "high";
        log("🤖 Price validation: CONFIRMED " + id + " price change (" + reason + ")");
      }
    });
    savePrices();
  } catch(e) { log("Price validation AI error: " + e.message); }
}

async function autoDiscoverRDItems(scrapedItems) {
  const knownIds = new Set(RD_ITEMS.map(i => i.id));
  const unmatched = scrapedItems.filter(s => {
    const cacheHit = matchCache.rd[s.name];
    return !cacheHit || !knownIds.has(cacheHit);
  });
  if (unmatched.length === 0) { log("Auto-discover: no new RD items found"); return; }
  log("Auto-discover: " + unmatched.length + " potentially new RD items — asking AI...");
  const existingNames = RD_ITEMS.map(i => i.name).join(", ");
  const prompt = `You are reviewing scraped products from a Restaurant Depot order guide for Naan & Curry restaurant in Las Vegas.

EXISTING ITEMS (already tracked):
${existingNames}

NEWLY SCRAPED ITEMS (not yet in our list):
${unmatched.map(s => s.name + " @ $" + s.price).join("\n")}

Which of these new items should be added? Skip non-food items.
Return ONLY JSON array: [{"name":"exact scraped name","price":0.00,"category":"Produce|Dairy|Meat|Frozen|Dry|Oils|Other","reason":"why tracked"}]
Return [] if nothing should be added.`;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await r.json();
    const txt = data.content?.find(b => b.type === "text")?.text || "[]";
    const m = txt.match(/\[[\s\S]*\]/);
    if (!m) return;
    const toAdd = JSON.parse(m[0]);
    if (toAdd.length === 0) { log("Auto-discover: AI found no new items to add"); return; }
    if (!priceStore.discovered) priceStore.discovered = [];
    toAdd.forEach(item => {
      const exists = priceStore.discovered.find(d => d.name === item.name);
      if (!exists) {
        priceStore.discovered.push({ ...item, discoveredAt: new Date().toISOString() });
        log("🆕 Auto-discover: new item found — " + item.name + " @ $" + item.price + " (" + item.reason + ")");
      }
    });
    savePrices();
    log("Auto-discover: " + toAdd.length + " new items queued for review");
  } catch(e) { log("Auto-discover AI error: " + e.message); }
}

async function runScrape(source = "all") {
  if (source === "rd" || source === "all") {
    try {
      const result = await withTimeout(scrapeRD(), 180000, "RD");
      if (result.success && result.items.length > 0) {
        const matched = await matchWithAI(result.items, RD_ITEMS, "Restaurant Depot");
        autoDiscoverRDItems(result.items).catch(e => log("Auto-discover error: " + e.message));
        const rdHealth = await checkScraperHealth("rd", result.items.length, matched.length);
        if (!rdHealth.healthy && rdHealth.action === "keep_yesterday") {
          log("🛡️ Health guard: keeping yesterday's RD prices (partial scrape)");
          Object.keys(priceStore.rd).forEach(id => { if (priceStore.rd[id]) { priceStore.rd[id].stale = true; priceStore.rd[id].staleReason = rdHealth.reason; } });
          savePrices(); return;
        }
        matched.forEach(({ id, price: rawPrice, unitPrice }) => {
          if (!id || rawPrice <= 0) return;
          let price = rawPrice;
          if (RD_SINGLE_UNIT.has(id) && !RD_PRICE_MAX[id] && rawPrice > 25) {
            if (unitPrice && unitPrice > 0 && unitPrice <= 25) {
              price = unitPrice;
              log("RD: Single-unit " + id + ": using unit price $" + unitPrice + " (case price $" + rawPrice + " skipped)");
            } else { log("RD: ⚠️ Skipping suspicious single-unit price for " + id + ": $" + rawPrice); return; }
          }
          const maxPrice = RD_PRICE_MAX[id];
          if (maxPrice && price > maxPrice) { log("RD: ⚠️ Skipping bad price for " + id + ": $" + price + " (max $" + maxPrice + ")"); return; }
          const minPrice = RD_PRICE_MIN[id];
          if (minPrice && price < minPrice) { log("RD: ⚠️ Skipping bad price for " + id + ": $" + price + " (min $" + minPrice + ")"); return; }
          const now = new Date().toISOString(), prevEntry = priceStore.rd[id];
          priceStore.rd[id] = {
            price, date: now, unit: RD_SINGLE_UNIT.has(id) ? "each" : "case",
            confidence: "medium", source: "scraped_rd", rawScraped: null, scrapedAt: now,
            prevPrice: prevEntry?.price || null, validatedBy: null,
            auditLog: [...(prevEntry?.auditLog || []).slice(-9), { date: now, price, source: "scraped_rd", confidence: "medium" }],
          };
        });
        const oosIds = [];
        if (result.oosNames && result.oosNames.length > 0) {
          log("RD: matching OOS names: " + JSON.stringify(result.oosNames));
          result.oosNames.forEach(oosName => {
            const oosLower = oosName.toLowerCase();
            let bestId = null, bestScore = 0;
            RD_ITEMS.forEach(item => {
              const iLower = item.name.toLowerCase();
              let score = 0;
              iLower.split(" ").forEach(w => { if (w.length > 3 && oosLower.includes(w)) score += w.length; });
              oosLower.split(" ").forEach(w => { if (w.length > 3 && iLower.includes(w)) score += w.length; });
              if (score > bestScore) { bestScore = score; bestId = item.id; }
            });
            if (bestId && bestScore >= 4) { oosIds.push(bestId); log("RD: OOS matched '" + oosName + "' → " + bestId + " (score=" + bestScore + ")"); }
            else { log("RD: OOS no match for '" + oosName + "' (best score=" + bestScore + ")"); }
          });
        }
        if (!priceStore.oos) priceStore.oos = { rd: [], sysco: [] };
        priceStore.oos.rd = oosIds;
        log("RD: ✅ out-of-stock IDs: " + (oosIds.length ? oosIds.join(", ") : "none"));
        log("✅ RD: " + matched.length + " prices saved (" + result.items.length + " raw)");
        savePrices();
        validatePricesWithAI("rd").catch(e => log("Price validation error: " + e.message));
      } else { log("❌ RD: " + (result.error || "no items")); }
    } catch(e) { log("❌ RD: " + e.message); }
  }

  if (source === "sysco" || source === "all") {
    try {
      const result = await withTimeout(scrapeSysco(), 300000, "Sysco");
      if (result.success && result.items.length > 0) {
        const matched = await matchWithAI(result.items, SYSCO_ITEMS, "Sysco Nick List");
        const scHealth = await checkScraperHealth("sysco", result.items.length, matched.length);
        if (!scHealth.healthy && scHealth.action === "keep_yesterday") {
          log("🛡️ Health guard: partial Sysco scrape (" + matched.length + "/" + scHealth.expectedItems + ") — merging confirmed prices");
          matched.forEach(({ id, price }) => {
            if (!id || price <= 0) return;
            let adjP = price;
            if (id === "7102961" && price < 20) adjP = Math.round(price*10*100)/100;
            const syscoMin = SYSCO_PRICE_MIN[id]; if (syscoMin && adjP < syscoMin) return;
            const syscoMax = SYSCO_PRICE_MAX[id]; if (syscoMax && adjP > syscoMax) return;
            priceStore.sysco[id] = { price: adjP, date: new Date().toISOString() };
            const mapping = SYSCO_TO_RD[id];
            if (mapping) {
              const rdId = mapping.rdId || mapping;
              if (!rdId || typeof rdId !== "string") return;
              priceStore.sysco[rdId] = { price: adjP * (mapping.rdMult || 1), date: new Date().toISOString(), syscoUpc: id, partialScrape: true };
            }
          });
          const updatedIds = new Set(matched.map(m => m.id));
          Object.keys(priceStore.sysco).forEach(id => { if (!updatedIds.has(id) && priceStore.sysco[id]) { priceStore.sysco[id].stale = true; priceStore.sysco[id].staleReason = scHealth.reason; } });
          savePrices();
          log("🛡️ Health guard: applied " + matched.length + " confirmed prices, marked rest as stale");
          return;
        }
        let savedCount = 0;
        matched.forEach(({ id, price }) => {
          if (!id || price <= 0) return;
          let adjP = price;
          if (id === "7102961" && price < 20) { adjP = Math.round(price*10*100)/100; log("Sysco: Paneer $"+price+"/lb x 10lb = $"+adjP); }
          const syscoMin = SYSCO_PRICE_MIN[id];
          if (syscoMin && adjP < syscoMin) { log("Sysco: ⚠️ Skipping bad price for " + id + ": $" + adjP + " (min $" + syscoMin + ")"); return; }
          const syscoMax = SYSCO_PRICE_MAX[id];
          if (syscoMax && adjP > syscoMax) { log("Sysco: ⚠️ Skipping bad price for " + id + ": $" + adjP + " (max $" + syscoMax + ")"); return; }
          priceStore.sysco[id] = { price: adjP, date: new Date().toISOString() };
          const mapping = SYSCO_TO_RD[id];
          if (mapping) {
            const rdId = mapping.rdId || mapping;
            if (!rdId || typeof rdId !== "string") return;
            const rdMult = mapping.rdMult || 1, nowSc = new Date().toISOString(), prevSc = priceStore.sysco[rdId];
            priceStore.sysco[rdId] = {
              price: adjP, date: nowSc, syscoUpc: id, rdMult, confidence: "medium", source: "scraped_sysco", scrapedAt: nowSc,
              prevPrice: prevSc?.price || null, validatedBy: null,
              auditLog: [...(prevSc?.auditLog || []).slice(-9), { date: nowSc, price: adjP, source: "scraped_sysco", confidence: "medium" }],
            };
          }
          savedCount++;
        });
        await buildCrossVendorMap(matched, []);
        matched.forEach(({ id, price }) => {
          if (!id || price <= 0) return;
          const mapping = SYSCO_TO_RD[id];
          if (mapping) {
            const rdId = mapping.rdId || mapping;
            if (!rdId || typeof rdId !== "string") return;
            if (!priceStore.sysco[rdId]) {
              let reAdjP = price;
              if (id === "7102961" && price < 20) reAdjP = Math.round(price*10*100)/100;
              priceStore.sysco[rdId] = { price: reAdjP, date: new Date().toISOString(), syscoUpc: id, rdMult: mapping.rdMult || 1 };
            }
          }
        });
        log("✅ Sysco: " + savedCount + " prices saved (" + result.items.length + " raw)");
        savePrices();
        validatePricesWithAI("sysco").catch(e => log("Sysco price validation error: " + e.message));
      } else { log("❌ Sysco: " + (result.error || "no items")); }
    } catch(e) { log("❌ Sysco: " + e.message); }
  }
  priceStore.lastUpdated = new Date().toISOString();
  savePrices();
  recordHistory();
  if (source === "all") crossValidatePrices().catch(e => log("Cross-validation error: " + e.message));
  backupToGitHub().catch(e => log("Backup error: " + e.message));
}

// ── Item Knowledge Base ───────────────────────────────────────────────────────
const ITEM_KB_FILE = "/data/nc_item_knowledge.json";
let itemKnowledge = {};

function loadItemKnowledge() {
  try {
    if (fs.existsSync(ITEM_KB_FILE)) {
      itemKnowledge = JSON.parse(fs.readFileSync(ITEM_KB_FILE, "utf8"));
      console.log("Item KB loaded: " + Object.keys(itemKnowledge).length + " items");
    }
  } catch(e) { console.log("Item KB load error:", e.message); }
  patchItemKnowledge();
}

function saveItemKnowledge() {
  try { fs.writeFileSync(ITEM_KB_FILE, JSON.stringify(itemKnowledge, null, 2)); }
  catch(e) { console.log("Item KB save error:", e.message); }
}

function patchItemKnowledge() {
  // SOURCE OF TRUTH — verified against Nick List PDF + RD order guide + order CSVs
  // [rdTotal, rdCaseContents, unit, syscoTotal, syscoCaseContents]
  const P = {
    "77200":  [40,  "1 x 40 lb case",           "lb",  40,   "4 x 10 lb bags (40 lb)"],
    "77232":  [40,  "1 x 40 lb case",           "lb",  40,   "4 x 10 lb bags (40 lb)"],
    "77658":  [40,  "1 x 40 lb case",           "lb",  40,   "4 x 10 lb bags (40 lb)"],
    "77670":  [40,  "1 x 40 lb case",           "lb",  40,   "1 x 40 lb case"],
    "77682":  [40,  "1 x 40 lb case",           "lb",  40,   "4 x 10 lb bags (40 lb)"],
    "42545":  [50,  "1 x 50 lb bag",            "lb",  50,   "1 x 50 lb bag"],
    "42658":  [25,  "1 x 25 lb bag",            "lb",  25,   "1 x 25 lb bag"],
    "42725":  [50,  "1 x 50 lb bag",            "lb",  50,   "1 x 50 lb bag"],
    "44146":  [30,  "6 x 5 lb bags (30 lb)",    "lb",  20,   "4 x 5 lb bags (20 lb)"],
    "42513":  [30,  "1 x 30 lb bulk case",      "lb",  30,   "1 x 30 lb bag"],
    "42606":  [12,  "12-head case",             "head",12,   "12 x 1 head cello wrapped"],
    "42570":  [115, "1 x 115 count case",       "each",115,  "1 x 115 count"],
    "79152":  [10,  "1 x 10 lb bag",            "lb",  10,   "1 x 10 lb bag"],
    "44137":  [40,  "1 x 40 lb box",            "lb",  40,   "1 x 40 lb case"],
    "40138":  [4,   "1 x 4 lb bunch",           "lb",  2,    "1 x 2 lb split (EA)"],  // RD single 4lb bunch confirmed
    "42706":  [5,   "1 x 5 lb bag",             "lb",  23.5, "1 x 22-25 lb case"],
    "44211":  [10,  "4 x 2.5 lb bags (10 lb)",  "lb",  4,    "1 x 4 lb bag"],
    "42566":  [null,"RD case",                  "lb",  4,    "4 x 1 lb bunches"],
    "42647":  [1,   "1 x 1 lb package",         "lb",  1,    "1 x 1 lb package"],
    "42504":  [6,   "1 x 6ct pack",             "each",8,    "1 x 5 lb pack (~8ct est)"],
    "1530438":[384, "6 x 64 oz jugs (384 oz)",  "oz",  384,  "12 x 32 oz bottles (384 oz)"],
    "370496": [512, "4 x 1 gallon (512 oz)",    "oz",  512,  "4 x 1 gallon (512 oz)"],
    "1440203":[20,  "4 x 5 lb bags (20 lb)",    "lb",  20,   "4 x 5 lb bags (20 lb)"],
    "1440528":[20,  "4 x 5 lb loaves (20 lb)",  "lb",  10,   "2 x 5 lb blocks (10 lb)"],
    "14785":  [32,  "1 x 32 lb container",      "lb",  null, null],
    "1020077":[35,  "1 x 35 lb jug",            "lb",  35,   "1 x 35 lb jug"],
    "1020075":[35,  "1 x 35 lb container",      "lb",  35,   "1 x 35 lb container"],
    "1020152":[384, "3 x 1 gallon (384 oz)",    "oz",  384,  "3 x 1 gallon (384 oz)"],
    "55523":  [512, "4 x 1 gallon (512 oz)",    "oz",  384,  "6 x 0.5 gallon (384 oz)"],
    "12728":  [102, "6 x 17 oz cans (102 oz)",  "oz",  84,   "6 x 14 oz cans (84 oz)"],
    "2550012":[4,   "4 x 1 gallon jugs",        "gallon",4,  "4 x 1 gallon jugs"],
    "2620442":[24,  "24 x 13.5 oz cans",        "can", 24,   "24 x 13.5 oz cans"],  // both vendors same size confirmed
    "13417":  [408, "3 x 136 oz containers",    "oz",  408,  "3 x 136 oz containers"],
    "21039":  [12000,"24 x 500 ml bottles",     "ml",  12000,"24 x 500 ml bottles"],
    "21051":  [25,  "1 x 25 lb bag",            "lb",  25,   "1 x 25 lb bag"],
    "1070496":[50,  "1 x 50 lb bag",            "lb",  50,   "1 x 50 lb bag"],
    "2061212":[25,  "1 x 25 lb bag",            "lb",  25,   "1 x 25 lb bag"],
    "53556":  [40,  "2 x 20 lb bags (40 lb)",   "lb",  50,   "1 x 50 lb bag"],
    "2910159":[3,   "1 x 3 lb box",             "lb",  24,   "24 x 1 lb boxes"],
    "29268":  [30,  "6 x 5 lb cans (30 lb)",    "lb",  30,   "6 x 5 lb cans (30 lb)"],
    "16200":  [54,  "6 x #10 cans",             "lb",  54,   "6 x #10 cans"],
    "69810":  [60,  "6 x #10 cans",             "lb",  60,   "6 x #10 cans"],
    "860135": [6,   "6 x #10 cans",             "can", 6,    "6 x #10 cans"],
    "860043": [6,   "6 x #10 cans",             "can", 6,    "6 x #10 cans"],
    "860044": [6,   "6 x #10 cans",             "can", 6,    "6 x #10 cans"],
    "2010066":[684, "6 x 114 oz jugs (684 oz)", "oz",  684,  "6 x 114 oz jugs (684 oz)"],
    "490266": [40,  "1 x 40 lb bag",            "lb",  null, null],
    "86525":  [30,  "12 x 2.5 lb bags (30 lb)", "lb",  30,   "12 x 2.5 lb bags (30 lb)"],  // RD is Case-of-12 confirmed
    "64120":  [24,  "12 x 2 lb bags (24 lb)",   "lb",  24,   "12 x 2 lb bags (24 lb)"],  // RD Case of 12 confirmed
    "64046":  [36,  "12 x 3 lb bags (36 lb)",   "lb",  36,   "12 x 3 lb bags (36 lb)"],  // RD Case of 12 confirmed
    "86527":  [30,  "12 x 2.5 lb bags (30 lb)", "lb",  30,   "1 x 30 lb bag"],  // RD Case of 12 confirmed
    "51457":  [10,  "1 x 10 lb box",            "lb",  10,   "2 x 5 lb boxes (10 lb)"],
    "40212":  [10,  "1 x 10 lb box",            "lb",  10,   "4 x 2.5 lb bags (10 lb)"],
    "1810019":[15,  "1 x 15 lb box",            "lb",  null, null],
    "79042":  [42,  "~42 lb variable weight",   "lb",  null, null],
    "45900":  [512, "4 x 1 gallon (512 oz)",    "oz",  512,  "4 x 1 gallon (512 oz)"],
    "2550014":[4,   "4 x 1 gallon jugs",        "gallon",null,null],
  };

  let n = 0;
  Object.entries(P).forEach(([id, [rdT,rdC,u,scT,scC]]) => {
    if (!itemKnowledge[id]) itemKnowledge[id] = { rd:{}, sysco:scT!=null?{}:null, comparison:{}, rdItemId:id, lastUpdated:new Date().toISOString() };
    if (!itemKnowledge[id].rd) itemKnowledge[id].rd = {};
    if (rdT != null) { itemKnowledge[id].rd.totalUnits = rdT; itemKnowledge[id].rd.caseContents = rdC; itemKnowledge[id].rd.unitOfMeasure = u; }
    if (scT != null) {
      if (!itemKnowledge[id].sysco) itemKnowledge[id].sysco = {};
      itemKnowledge[id].sysco.totalUnits = scT; itemKnowledge[id].sysco.caseContents = scC; itemKnowledge[id].sysco.unitOfMeasure = u;
    }
    if (!itemKnowledge[id].comparison) itemKnowledge[id].comparison = {};
    itemKnowledge[id].comparison.rdTotalUnits = rdT;
    itemKnowledge[id].comparison.syscoTotalUnits = scT;
    itemKnowledge[id].comparison.unitOfMeasure = u;
    n++;
  });

  const BINS = { "77670": "6026", "77658": "6026" };
  Object.entries(BINS).forEach(([id, bin]) => {
    if (!itemKnowledge[id]) itemKnowledge[id] = { rd:{}, sysco:null, comparison:{}, rdItemId:id, lastUpdated:new Date().toISOString() };
    if (!itemKnowledge[id].rd) itemKnowledge[id].rd = {};
    itemKnowledge[id].rd.binLocation = "Bin " + bin;
  });

  if (n > 0) { saveItemKnowledge(); console.log("Item KB patched: " + n + " items with verified facts"); }
}

loadItemKnowledge();

async function buildItemKnowledgeBase(forceRefresh = false) {
  const needsUpdate = [];
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const item of RD_ITEMS) {
    const existing = itemKnowledge[item.id];
    if (!existing || forceRefresh || new Date(existing.lastUpdated).getTime() < sevenDaysAgo) needsUpdate.push(item);
  }
  if (needsUpdate.length === 0) { log("Item KB: all up to date"); return; }
  log("Item KB: building " + needsUpdate.length + " items...");
  let processed = 0;
  for (const rdItem of needsUpdate) {
    try {
      const syscoEntry = Object.entries(SYSCO_TO_RD).find(([upc, map]) => (map.rdId || map) === rdItem.id);
      const syscoUpc = syscoEntry?.[0];
      const syscoItem = syscoUpc ? SYSCO_ITEMS.find(i => i.id === syscoUpc) : null;
      const rdE = priceStore.rd[rdItem.id];
      const rdPrice = rdE?.price || null;
      let rdPage = "";
      try {
        const rr = await fetch("https://www.restaurantdepot.com/p/" + rdItem.id, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) });
        if (rr.ok) rdPage = (await rr.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 1500);
      } catch(e) {}
      const sysLine = syscoItem ? "Sysco: " + syscoItem.name + " | UPC: " + syscoUpc + " | Pack: " + syscoItem.pack : "No Sysco equivalent";
      const prompt = "Build wholesale grocery product knowledge for Naan & Curry Las Vegas.\nITEM: " + rdItem.name + " (RD: " + rdItem.id + ")" + (rdPrice ? "\nPrice: $" + rdPrice : "") + (rdPage ? "\nPage: " + rdPage.slice(0,500) : "") + "\n" + sysLine + "\nReturn ONLY JSON: {\"rd\":{\"name\":\"" + rdItem.name + "\",\"caseContents\":\"exact\",\"totalUnits\":0,\"unitOfMeasure\":\"lb\",\"binLocation\":\"\"},\"sysco\":" + (syscoItem ? "{\"name\":\"" + syscoItem.name + "\",\"pack\":\"" + syscoItem.pack + "\",\"caseContents\":\"exact\",\"totalUnits\":0,\"unitOfMeasure\":\"lb\"}" : "null") + ",\"comparison\":{\"rdTotalUnits\":0,\"syscoTotalUnits\":0,\"unitOfMeasure\":\"lb\",\"sameProduct\":true,\"notes\":\"\"}}";
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 800, messages: [{ role: "user", content: prompt }] }),
      });
      const data = await r.json();
      const txt = data.content?.find(b => b.type === "text")?.text || "{}";
      const m = txt.match(/\{[\s\S]*\}/);
      if (m) {
        itemKnowledge[rdItem.id] = { ...JSON.parse(m[0]), lastUpdated: new Date().toISOString(), rdItemId: rdItem.id, syscoUpc: syscoUpc || null };
        processed++;
        log("Item KB: " + rdItem.name + " learned");
      }
      if (processed % 10 === 0) { saveItemKnowledge(); patchItemKnowledge(); }
      await new Promise(res => setTimeout(res, 600));
    } catch(e) { log("Item KB error " + rdItem.name + ": " + e.message); }
  }
  saveItemKnowledge();
  patchItemKnowledge(); // always re-apply verified facts after AI build
  log("Item KB complete: " + processed + "/" + needsUpdate.length);
  backupItemKnowledgeToGitHub().catch(e => log("KB backup error: " + e.message));
}

async function backupItemKnowledgeToGitHub() {
  const token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPO;
  if (!token || !repo) return;
  try {
    const encoded = Buffer.from(JSON.stringify(itemKnowledge, null, 2)).toString("base64");
    await githubCommit(token, repo, "backup/item_knowledge.json", encoded, "Item knowledge " + new Date().toISOString().slice(0, 10));
    log("✅ Item KB backed up to GitHub");
  } catch(e) { log("Item KB GitHub error: " + e.message); }
}

// ── PACK_SIZES — single source of truth for unit price comparisons ─────────────
// Every entry hand-verified against Nick List PDF + RD order guide + order CSVs.
// The /api/unit-compare endpoint uses this EXCLUSIVELY — no AI division, no KB fallback
// for any tracked item. Math is done server-side: price / total = per-unit.
//
// Keys are always the RD Item ID (even when looking up Sysco price stored under RD ID).
// rdTotal / syscoTotal are the TOTAL UNITS IN ONE CASE in the given unit.
// "unit" is what rdTotal and syscoTotal are measured in.
//
// DIFF SIZES = vendors sell different total quantities → per-unit math required before comparing.
// Same total = case price is directly comparable, but per-unit still shown for reference.
const PACK_SIZES = {
  // ── PRODUCE ──────────────────────────────────────────────────────────────────
  "42545":  { rd: "1 × 50 lb bag",             sysco: "1 × 50 lb bag",              rdTotal: 50,    syscoTotal: 50,    unit: "lb"    }, // Yellow Onion (1094721)
  "42658":  { rd: "1 × 25 lb bag",             sysco: "1 × 25 lb bag",              rdTotal: 25,    syscoTotal: 25,    unit: "lb"    }, // Red Onion (1094663)
  "42725":  { rd: "1 × 50 lb bag",             sysco: "1 × 50 lb bag",              rdTotal: 50,    syscoTotal: 50,    unit: "lb"    }, // Russet Potato (1543164)
  "44146":  { rd: "6 × 5 lb bags (30 lb)",     sysco: "4 × 5 lb bags (20 lb)",      rdTotal: 30,    syscoTotal: 20,    unit: "lb"    }, // Peeled Garlic (1821537) — DIFF SIZES
  "42513":  { rd: "1 × 30 lb bulk case",       sysco: "1 × 30 lb bag",              rdTotal: 30,    syscoTotal: 30,    unit: "lb"    }, // Ginger (1184902)
  "42606":  { rd: "12-head case",              sysco: "12 × 1 head",                rdTotal: 12,    syscoTotal: 12,    unit: "head"  }, // Cauliflower (1243724) ✓
  "42570":  { rd: "1 × 115 ct case",           sysco: "1 × 115 ct case",            rdTotal: 115,   syscoTotal: 115,   unit: "each"  }, // Lemons (2252013) — FIXED: was rdTotal:null
  "79152":  { rd: "1 × 10 lb bag",             sysco: "1 × 10 lb bag",              rdTotal: 10,    syscoTotal: 10,    unit: "lb"    }, // Carrots (3879962)
  "44137":  { rd: "1 × 40 lb box",             sysco: "1 × 40 lb case",             rdTotal: 40,    syscoTotal: 40,    unit: "lb"    }, // Serrano Peppers (7007376)
  "40138":  { rd: "1 × 4 lb bunch",             sysco: "1 × 2 lb split (EA)",        rdTotal: 4,     syscoTotal: 2,     unit: "lb"    }, // Green Onions (7350788) — RD single 4lb bunch; Sysco buy EA 2lb
  "42706":  { rd: "1 × 5 lb bag",              sysco: "1 × 22-25 lb case",          rdTotal: 5,     syscoTotal: 23.5,  unit: "lb"    }, // Green Bell Pepper (1910231) — DIFF SIZES
  "44211":  { rd: "4 × 2.5 lb bags (10 lb)",   sysco: "1 × 4 lb bag",               rdTotal: 10,    syscoTotal: 4,     unit: "lb"    }, // Baby Spinach (8474538) — DIFF SIZES
  "42566":  { rd: "1 case",                    sysco: "4 × 1 lb bunches (4 lb)",    rdTotal: null,  syscoTotal: 4,     unit: "lb"    }, // Cilantro (2219095) — RD case size not on order guide
  "42647":  { rd: "1 × 1 lb package",          sysco: "1 × 1 lb package",           rdTotal: 1,     syscoTotal: 1,     unit: "lb"    }, // Mint (2037125)
  "42504":  { rd: "1 × 6 ct pack",             sysco: "1 × 5 lb pack (~8 ct est)",  rdTotal: 6,     syscoTotal: 8,     unit: "each"  }, // Cucumbers (7410640) — DIFF UNITS; est 8ct per 5lb
  // ── DAIRY ─────────────────────────────────────────────────────────────────────
  "1530438":{ rd: "6 × 64 oz jugs (384 oz)",   sysco: "12 × 32 oz bottles (384 oz)",rdTotal: 384,   syscoTotal: 384,   unit: "oz"    }, // Heavy Cream (6935464) — same oz total ✓
  "370496": { rd: "4 × 1 gallon (512 oz)",      sysco: "4 × 1 gallon (512 oz)",      rdTotal: 512,   syscoTotal: 512,   unit: "oz"    }, // Whole Milk (4676306)
  "1440203":{ rd: "4 × 5 lb bags (20 lb)",      sysco: "4 × 5 lb bags (20 lb)",      rdTotal: 20,    syscoTotal: 20,    unit: "lb"    }, // Cheddar Jack (2822379)
  "1440528":{ rd: "4 × 5 lb loaves (20 lb)",    sysco: "2 × 5 lb blocks (10 lb)",    rdTotal: 20,    syscoTotal: 10,    unit: "lb"    }, // Paneer (7102961) — DIFF SIZES
  "14785":  { rd: "1 × 32 lb container",        sysco: null,                          rdTotal: 32,    syscoTotal: null,  unit: "lb"    }, // Plain Yogurt — RD only
  // ── CHICKEN ───────────────────────────────────────────────────────────────────
  "77232":  { rd: "1 × 40 lb case",             sysco: "4 × 10 lb bags (40 lb)",     rdTotal: 40,    syscoTotal: 40,    unit: "lb"    }, // Chicken Breast (5231238)
  "77670":  { rd: "1 × 40 lb case",             sysco: "1 × 40 lb case",             rdTotal: 40,    syscoTotal: 40,    unit: "lb"    }, // Chicken Leg Quarters (4418117 1/40LB) ✓
  "77658":  { rd: "1 × 40 lb case",             sysco: "4 × 10 lb bags (40 lb)",     rdTotal: 40,    syscoTotal: 40,    unit: "lb"    }, // Chicken Leg Meat (0868459)
  "77200":  { rd: "1 × 40 lb case",             sysco: "4 × 10 lb bags (40 lb)",     rdTotal: 40,    syscoTotal: 40,    unit: "lb"    }, // Chicken Wings (6344790)
  // ── SEAFOOD / MEAT ────────────────────────────────────────────────────────────
  "40212":  { rd: "1 × 10 lb box",              sysco: "4 × 2.5 lb bags (10 lb)",    rdTotal: 10,    syscoTotal: 10,    unit: "lb"    }, // Shrimp 16/20 (5106388)
  "51457":  { rd: "1 × 10 lb box",              sysco: "2 × 5 lb boxes (10 lb)",     rdTotal: 10,    syscoTotal: 10,    unit: "lb"    }, // Tilapia (0496671)
  "79042":  { rd: "~42 lb variable weight",      sysco: null,                          rdTotal: 42,    syscoTotal: null,  unit: "lb"    }, // Lamb Leg Boneless — RD only
  "1810019":{ rd: "1 × 15 lb box",              sysco: null,                          rdTotal: 15,    syscoTotal: null,  unit: "lb"    }, // Goat Cubes — RD only
  // ── FROZEN ────────────────────────────────────────────────────────────────────
  "86525":  { rd: "12 × 2.5 lb bags (30 lb)",   sysco: "12 × 2.5 lb bags (30 lb)",   rdTotal: 30,    syscoTotal: 30,    unit: "lb"    }, // Frozen Peas (1053826) — SAME SIZE; RD $38.20 CS, Sysco $35.92 CS
  "64120":  { rd: "12 × 2 lb bags (24 lb)",     sysco: "12 × 2 lb bags (24 lb)",     rdTotal: 24,    syscoTotal: 24,    unit: "lb"    }, // Frozen Broccoli (6988158) — Case of 12 confirmed
  "64046":  { rd: "12 × 3 lb bags (36 lb)",     sysco: "12 × 3 lb bags (36 lb)",     rdTotal: 36,    syscoTotal: 36,    unit: "lb"    }, // Frozen Spinach (2523833) — Case of 12 confirmed
  "86527":  { rd: "12 × 2.5 lb bags (30 lb)",   sysco: "1 × 30 lb bag",              rdTotal: 30,    syscoTotal: 30,    unit: "lb"    }, // Frozen 4-Way Mix (3960200) — Case of 12 confirmed
  // ── OILS & FATS ───────────────────────────────────────────────────────────────
  "1020075":{ rd: "1 × 35 lb jug",              sysco: "1 × 35 lb jug",              rdTotal: 35,    syscoTotal: 35,    unit: "lb"    }, // Soybean Oil (4119079)
  "1020077":{ rd: "1 × 35 lb jug",              sysco: "1 × 35 lb jug",              rdTotal: 35,    syscoTotal: 35,    unit: "lb"    }, // Fryer Oil / Clear Fry (4518403)
  "1020152":{ rd: "3 × 1 gallon (384 oz)",       sysco: "3 × 1 gallon (384 oz)",      rdTotal: 384,   syscoTotal: 384,   unit: "oz"    }, // Liquid Butter (3355757)
  "12728":  { rd: "6 × 17 oz cans (102 oz)",     sysco: "6 × 14 oz cans (84 oz)",     rdTotal: 102,   syscoTotal: 84,    unit: "oz"    }, // Pan Spray (6914451) — DIFF SIZES
  // ── SAUCES / CONDIMENTS ───────────────────────────────────────────────────────
  "55523":  { rd: "4 × 1 gallon (512 oz)",       sysco: "6 × 0.5 gallon (384 oz)",    rdTotal: 512,   syscoTotal: 384,   unit: "oz"    }, // Lemon Juice (4063095) — DIFF SIZES
  "13417":  { rd: "3 × 136 oz containers",       sysco: "3 × 136 oz containers",      rdTotal: 408,   syscoTotal: 408,   unit: "oz"    }, // Sambal Oelek (2638660)
  "45900":  { rd: "4 × 1 gallon (512 oz)",       sysco: "4 × 1 gallon (512 oz)",      rdTotal: 512,   syscoTotal: 512,   unit: "oz"    }, // White Vinegar (4113049)
  "860043": { rd: "6 × #10 cans",                sysco: "6 × #10 cans",               rdTotal: 6,     syscoTotal: 6,     unit: "can"   }, // Tomato Puree (4002325) — price per can
  "860044": { rd: "6 × #10 cans",                sysco: "6 × #10 cans",               rdTotal: 6,     syscoTotal: 6,     unit: "can"   }, // Tomato Sauce (4978884) — price per can
  "860135": { rd: "6 × #10 cans",                sysco: "6 × #10 cans",               rdTotal: 6,     syscoTotal: 6,     unit: "can"   }, // Petite Diced Tomato (5895750) — price per can
  "2010066":{ rd: "6 × 114 oz jugs (684 oz)",    sysco: "6 × 114 oz jugs (684 oz)",   rdTotal: 684,   syscoTotal: 684,   unit: "oz"    }, // Ketchup (9903790)
  // ── DRY / PANTRY ──────────────────────────────────────────────────────────────
  "2061212":{ rd: "1 × 25 lb bag",               sysco: "1 × 25 lb bag",              rdTotal: 25,    syscoTotal: 25,    unit: "lb"    }, // All Purpose Flour (8379251)
  "53556":  { rd: "2 × 20 lb bags (40 lb)",      sysco: "1 × 50 lb bag",              rdTotal: 40,    syscoTotal: 50,    unit: "lb"    }, // Roti Atta (4014684) — DIFF SIZES
  "21051":  { rd: "1 × 25 lb bag",               sysco: "1 × 25 lb bag",              rdTotal: 25,    syscoTotal: 25,    unit: "lb"    }, // Sugar (5087572)
  "1070496":{ rd: "1 × 50 lb bag",               sysco: "1 × 50 lb bag",              rdTotal: 50,    syscoTotal: 50,    unit: "lb"    }, // Salt (4564894)
  "29268":  { rd: "6 × 5 lb cans (30 lb)",       sysco: "6 × 5 lb cans (30 lb)",      rdTotal: 30,    syscoTotal: 30,    unit: "lb"    }, // Baking Powder (5517701)
  "2910159":{ rd: "1 × 3 lb box",                sysco: "24 × 1 lb boxes (24 lb)",    rdTotal: 3,     syscoTotal: 24,    unit: "lb"    }, // Cornstarch (4073441) — DIFF SIZES
  "16200":  { rd: "6 × #10 cans",                sysco: "6 × #10 cans",               rdTotal: 54,    syscoTotal: 54,    unit: "lb"    }, // Garbanzo Beans (4062337) — ~9 lb/can
  "69810":  { rd: "6 × #10 cans",                sysco: "6 × #10 cans",               rdTotal: 60,    syscoTotal: 60,    unit: "lb"    }, // Kidney Beans (4014973) — ~10 lb/can
  "490266": { rd: "1 × 40 lb bag",               sysco: null,                          rdTotal: 40,    syscoTotal: null,  unit: "lb"    }, // Basmati Rice — RD only
  "2550012":{ rd: "4 × 1 gallon jugs",           sysco: "4 × 1 gallon jugs",          rdTotal: 4,     syscoTotal: 4,     unit: "gallon"}, // Egg Yellow Color (4112262)
  "2550014":{ rd: "4 × 1 gallon jugs",           sysco: null,                          rdTotal: 4,     syscoTotal: null,  unit: "gallon"}, // Red Food Color — RD only
  // ── BEVERAGES / WATER ─────────────────────────────────────────────────────────
  "21039":  { rd: "24 × 500 ml bottles",         sysco: "24 × 500 ml bottles",        rdTotal: 12000, syscoTotal: 12000, unit: "ml"    }, // Evian Water (2886075)
  "2620442":{ rd: "24 × 13.5 oz cans",           sysco: "24 × 13.5 oz cans",         rdTotal: 24,    syscoTotal: 24,    unit: "can"   }, // Coconut Milk (1425982) — CONFIRMED same size both vendors
};
// Note: No duplicate keys. No Sysco UPCs used as keys. 3960200 removed (was Sysco UPC, maps to RD 86527 which is already here).

// ── API routes ────────────────────────────────────────────────────────────────
app.get("/api/discovered", (req, res) => res.json(priceStore.discovered || []));
app.get("/api/item-knowledge", (req, res) => res.json(itemKnowledge));
app.get("/api/item-knowledge/:id", (req, res) => {
  const kb = itemKnowledge[req.params.id];
  if (!kb) return res.status(404).json({ error: "No knowledge for this item yet" });
  res.json(kb);
});
app.get("/api/build-knowledge", async (req, res) => {
  const force = req.query.force === "true";
  res.json({ message: "Building item knowledge base" + (req.query.item ? " for item " + req.query.item : "") + "..." });
  buildItemKnowledgeBase(force).catch(e => log("KB build error: " + e.message));
});

// ── Unit price comparison — pure server-side math, no AI division ─────────────
// PACK_SIZES is the ONLY source of truth. The itemKnowledge KB is a fallback for
// items not yet in PACK_SIZES (should be zero for all tracked items now).
// Claude is only asked to write ONE recommendation sentence — all math is done here.
app.post("/api/unit-compare", async (req, res) => {
  const { itemId, itemName, rdPrice, scPrice } = req.body;
  if (!itemId || !rdPrice || !scPrice) return res.status(400).json({ error: "Missing fields" });

  // PACK_SIZES is manually verified — always takes priority over AI-built KB
  const packInfo = PACK_SIZES[itemId];
  const kb = itemKnowledge[itemId];

  const rdPack  = packInfo?.rd    ?? kb?.rd?.caseContents    ?? kb?.rd?.packSize    ?? "1 case";
  const scPack  = packInfo?.sysco ?? kb?.sysco?.caseContents ?? kb?.sysco?.packSize ?? "1 case";
  const rdTotal = packInfo ? packInfo.rdTotal    : (kb?.comparison?.rdTotalUnits    ?? null);
  const scTotal = packInfo ? packInfo.syscoTotal : (kb?.comparison?.syscoTotalUnits ?? null);
  const unit    = packInfo?.unit ?? kb?.comparison?.unitOfMeasure ?? "unit";

  // Server-side division — never delegate math to Claude
  const rdP = parseFloat(rdPrice), scP = parseFloat(scPrice);
  const rdPerUnit = (rdTotal && rdTotal > 0) ? Math.round(rdP / rdTotal * 10000) / 10000 : null;
  const scPerUnit = (scTotal && scTotal > 0) ? Math.round(scP / scTotal * 10000) / 10000 : null;

  let cheaper = "same", savingsPct = 0, savingsPerUnit = 0;
  if (rdPerUnit !== null && scPerUnit !== null) {
    if (rdPerUnit < scPerUnit) {
      cheaper = "rd";
      savingsPerUnit = Math.round((scPerUnit - rdPerUnit) * 10000) / 10000;
      savingsPct     = Math.round((scPerUnit - rdPerUnit) / scPerUnit * 10000) / 100;
    } else if (scPerUnit < rdPerUnit) {
      cheaper = "sysco";
      savingsPerUnit = Math.round((rdPerUnit - scPerUnit) * 10000) / 10000;
      savingsPct     = Math.round((rdPerUnit - scPerUnit) / rdPerUnit * 10000) / 100;
    }
  }

  // Claude writes ONE sentence — math already computed above and given to it
  const prompt = `Naan & Curry Las Vegas wholesale purchasing.
${itemName}: RD $${rdP} for ${rdPack}${rdTotal ? ` (${rdTotal} ${unit})` : ""} = ${rdPerUnit !== null ? `$${rdPerUnit}/${unit}` : "unknown per-unit"}.
Sysco $${scP} for ${scPack}${scTotal ? ` (${scTotal} ${unit})` : ""} = ${scPerUnit !== null ? `$${scPerUnit}/${unit}` : "unknown per-unit"}.
${cheaper === "rd" ? `RD is cheaper by ${savingsPct}% ($${savingsPerUnit}/${unit}).` : cheaper === "sysco" ? `Sysco is cheaper by ${savingsPct}% ($${savingsPerUnit}/${unit}).` : "Same price per unit."}
Write ONE specific purchasing recommendation sentence. Return ONLY JSON: {"recommendation":"..."}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 150, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await r.json();
    const txt = data.content?.find(b => b.type === "text")?.text || "{}";
    const m = txt.match(/\{[\s\S]*\}/);
    const parsed = m ? JSON.parse(m[0]) : {};
    res.json({
      rdPerUnit:      rdPerUnit  ?? 0,
      scPerUnit:      scPerUnit  ?? 0,
      unit,
      rdPack,
      scPack,
      cheaper,
      savingsPct,
      savingsPerUnit,
      recommendation: parsed.recommendation || "",
      dataSource:     packInfo ? "pack_sizes" : kb ? "knowledge_base" : "unknown",
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/history", (req, res) => res.json({ data: priceHistory, lastRecorded: priceStore.lastUpdated || null }));
app.get("/api/prices", (req, res) => res.json({ rd: priceStore.rd, sysco: priceStore.sysco, lastUpdated: priceStore.lastUpdated, oos: priceStore.oos || { rd: [], sysco: [] } }));
app.get("/api/status", (req, res) => res.json({ status: "running", lastUpdated: priceStore.lastUpdated, rdItems: Object.keys(priceStore.rd).length, syscoItems: Object.keys(priceStore.sysco).length, log: priceStore.log.slice(0, 200) }));
app.get("/api/trigger", (req, res) => {
  const src = req.query.source || "all";
  res.json({ message: "Scraping " + src });
  runScrape(src).catch(e => log("Trigger: " + e.message));
});
app.get("/api/debug-rd", async (req, res) => {
  res.json({ message: "Debugging RD scrape — check /api/status in 3 minutes" });
  try {
    const result = await scrapeRD();
    result.items.forEach(item => { log("DEBUG: $" + item.price + " → " + item.name + " | raw=" + item.raw); });
    log("DEBUG: " + result.items.length + " total items scraped");
  } catch(e) { log("DEBUG error: " + e.message); }
});
app.get("/api/force-backup", async (req, res) => {
  try {
    cleanBadPrices();
    await backupToGitHub();
    res.json({ success: true, rdItems: Object.keys(priceStore.rd).length, syscoItems: Object.keys(priceStore.sysco).length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/clear", async (req, res) => {
  const { id, vendor } = req.query;
  if (!id) return res.status(400).json({ error: "id required" });
  const v = vendor || "rd", cleared = [];
  if ((v === "rd" || v === "all") && priceStore.rd[id]) {
    const old = priceStore.rd[id].price; delete priceStore.rd[id];
    cleared.push({ vendor: "rd", was: old }); log("🧹 Cleared RD price for " + id + " (was $" + old + ")");
  }
  if ((v === "sysco" || v === "all") && priceStore.sysco[id]) {
    const old = priceStore.sysco[id].price; delete priceStore.sysco[id];
    cleared.push({ vendor: "sysco", was: old }); log("🧹 Cleared Sysco price for " + id + " (was $" + old + ")");
  }
  if (priceHistory[id]) {
    priceHistory[id] = priceHistory[id].map(e => ({ ...e, rd: (v === "rd" || v === "all") ? null : e.rd, sc: (v === "sysco" || v === "all") ? null : e.sc }));
    saveHistory();
  }
  if (cleared.length > 0) {
    savePrices();
    backupToGitHub().catch(e => log("Backup after clear: " + e.message));
    res.json({ cleared: true, id, details: cleared });
  } else { res.json({ cleared: false, message: "No price found for " + id + " at " + v }); }
});
app.post("/api/scrape", (req, res) => {
  const src = req.body?.source || "all";
  res.json({ message: "Scraping " + src });
  runScrape(src).catch(e => log("Scrape: " + e.message));
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

// ── Grocery breakdown — GOD MODE ──────────────────────────────────────────────
app.post("/api/grocery", async (req, res) => {
  const { list } = req.body;
  if (!list) return res.status(400).json({ error: "No list" });
  try {
    const rdOosSet = new Set(priceStore.oos?.rd || []);
    const scOosSet = new Set(priceStore.oos?.sysco || []);

    const DISPLAY_NAMES = {
      "42545":  "Yellow Onions",        "42658":  "Red Onions",
      "42725":  "Russet Potato",        "44146":  "Peeled Garlic",
      "42513":  "Ginger",               "1440528":"Paneer",
      "55519":  "Flowers",              "42606":  "Cauliflower",
      "40138":  "Green Onions",         "79152":  "Carrots",
      "44211":  "Fresh Spinach",        "42706":  "Green Bell Pepper",
      "42570":  "Lemons",               "42647":  "Mint",
      "42566":  "Cilantro",             "44137":  "Green Chilies",
      "42504":  "Cucumbers",            "1530438":"Heavy Cream",
      "370496": "Whole Milk",           "77232":  "Chicken Breast",
      "77670":  "Chicken Leg Quarters", "77200":  "Chicken Wings",
      "77658":  "Chicken Leg Meat",     "79042":  "Lamb Leg Boneless",
      "1810019":"Goat Cubes",           "1440203":"Cheese Blend",
      "14785":  "Plain Yogurt",         "40212":  "Shrimp 16-20",
      "51457":  "Fish (Tilapia)",       "64046":  "Frozen Spinach",
      "86525":  "Frozen Peas",          "64120":  "Frozen Broccoli",
      "86527":  "Frozen 4-Way Mix",     "25267":  "Eggplant Pulp",
      "45900":  "White Vinegar",        "1020152":"Liquid Butter",
      "12728":  "Pan Spray",            "1020075":"Soybean Oil",
      "1020077":"Fryer Oil",            "55523":  "Lemon Juice",
      "53556":  "Roti Atta",            "13417":  "Sambal Chili",
      "2620442":"Coconut Milk",         "2061212":"All Purpose Flour",
      "29268":  "Baking Powder",        "2910159":"Cornstarch",
      "490266": "Rice – Royal",         "2550014":"Red Food Color",
      "2550012":"Egg Yellow Color",     "16200":  "Garbanzo Beans",
      "69810":  "Red Kidney Beans",     "1070496":"Salt",
      "21051":  "Sugar",                "2010066":"Ketchup",
      "860043": "Tomato Puree",         "860044": "Tomato Sauce",
      "860135": "Petite Diced Tomato",  "21039":  "Water",
      "440038": "Coca-Cola",            "440039": "Diet Coke",
      "440040": "Sprite",               "50103":  "Printer Paper Roll",
      "77682":  "Chicken Thighs",       "43431":  "Green Bell Peppers (9ct)",
    };

    function perUnit(price, id, vendor) {
      const ps = PACK_SIZES[id];
      if (!ps) return "";
      const total = vendor === "rd" ? ps.rdTotal : ps.syscoTotal;
      if (!total || total <= 0) return "";
      return ` ($${(price / total).toFixed(2)}/${ps.unit})`;
    }

    const catalog = [];
    RD_ITEMS.forEach(rdItem => {
      const rdE = priceStore.rd[rdItem.id];
      const isRdOos = rdOosSet.has(rdItem.id);
      const syscoEntry = Object.entries(SYSCO_TO_RD).find(([upc, map]) => {
        const rid = map.rdId || map;
        return rid === rdItem.id && typeof rid === "string";
      });
      const syscoUpc = syscoEntry?.[0];
      const syscoItem = syscoUpc ? SYSCO_ITEMS.find(i => i.id === syscoUpc) : null;
      const syscoE = syscoUpc ? (priceStore.sysco[rdItem.id] || priceStore.sysco[syscoUpc]) : null;
      const isScOos = syscoUpc ? scOosSet.has(syscoUpc) : false;
      if (!rdE?.price && !syscoE?.price) return;

      const ps = PACK_SIZES[rdItem.id];
      const kb = itemKnowledge[rdItem.id];
      const rdBin = kb?.rd?.binLocation || "";
      const shortName = DISPLAY_NAMES[rdItem.id] || rdItem.name
        .replace(/Chef's Quality - |James Farm - |Royal Mahout - |Thomas Farms - |Clabber Girl - |Clabber Girl |Golden Temple - |Royal Chef's Secret - |Frozen James Farm - |Frozen |Jumbo |Fresh |Boneless Skinless |Boneless, Skinless /gi, "")
        .replace(/ - \d+.*$/, "").replace(/\bGS\/AN\b|\bIQF\b|\bSEAFOOD\b|\bWHL GAL\b/gi, "").replace(/\s+/g, " ").trim();

      let verdict = "?", verdictTag = "";
      if (rdE?.price && !isRdOos && syscoE?.price && !isScOos) {
        const rdPu = ps?.rdTotal ? rdE.price / ps.rdTotal : rdE.price;
        const scPu = ps?.syscoTotal ? syscoE.price / ps.syscoTotal : syscoE.price;
        const caseDiff = Math.abs(rdE.price - syscoE.price);
        const diffSizes = ps?.rdTotal && ps?.syscoTotal && ps.rdTotal !== ps.syscoTotal;
        if (caseDiff < 2) {
          verdict = "SYSCO"; verdictTag = `same price ±$${caseDiff.toFixed(2)} → SYSCO preference rule`;
        } else if (!diffSizes && rdPu <= scPu) {
          verdict = "RD"; verdictTag = `RD cheaper by $${caseDiff.toFixed(2)}`;
        } else if (!diffSizes) {
          verdict = "SYSCO"; verdictTag = `Sysco cheaper by $${caseDiff.toFixed(2)}`;
        } else {
          verdict = rdPu <= scPu ? "RD" : "SYSCO";
          verdictTag = `per-unit: RD $${rdPu.toFixed(3)}/${ps.unit} vs Sysco $${scPu.toFixed(3)}/${ps.unit} ⚖DIFF CASE SIZE`;
        }
      } else if ((isRdOos || !rdE?.price) && syscoE?.price && !isScOos) {
        verdict = "SYSCO"; verdictTag = "RD unavailable";
      } else if (rdE?.price && !isRdOos && !syscoE?.price) {
        verdict = "RD"; verdictTag = "Sysco not tracked";
      }

      let rdPart = isRdOos ? "RD:⛔OOS" : rdE?.price ? `RD:$${rdE.price}${perUnit(rdE.price, rdItem.id, "rd")}` : "RD:N/A";
      if (rdBin && rdE?.price && !isRdOos) rdPart += `(${rdBin})`;
      let scPart = isScOos ? "Sysco:⛔OOS" : syscoE?.price ? `Sysco:$${syscoE.price}${perUnit(syscoE.price, rdItem.id, "sysco")}` : "Sysco:N/A";
      catalog.push(`[${verdict}] ${shortName} | ${verdictTag} | ${rdPart} | ${scPart}`);
    });

    if (catalog.length === 0) return res.status(500).json({ error: "No price data — run scrape first" });
    const lastUpdated = priceStore.lastUpdated
      ? new Date(priceStore.lastUpdated).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
      : "unknown";

    const systemPrompt = `You are the purchasing assistant for Naan & Curry, an Indian restaurant in Las Vegas, Nevada.
You have full access to today's live vendor pricing, per-unit costs, stock status, bin locations, and price history.
Prices are scraped daily from Restaurant Depot and Sysco. Data was last updated: ${lastUpdated}.
Your job: parse the chef's order and assign every item to the cheapest available vendor with perfect accuracy.
Trust the catalog completely. When the catalog says OUT OF STOCK, it is physically unavailable — never put it under RD.
CRITICAL: Output ONLY the final formatted result. No thinking, no reasoning, no notes, no explanations, no asterisks, no intermediate steps. Just the list.`;

    const prompt = `LIVE PRICE CATALOG — ${catalog.length} items, updated ${lastUpdated}:

${catalog.join("\n\n")}

---
CHEF'S ORDER:
${list}

---
ITEM NAME ALIASES (chef shorthand → catalog name):
LQ / leg quarters / bone-in = Chicken Leg Quarters
breast = Chicken Breast (Boneless Skinless)
wings = Chicken Wings
leg meat / BLSM = Chicken Leg Meat
WM = Whole Milk | HWC / cream = Heavy Cream 40%
garlic = Peeled Garlic | onion = Yellow Onion
carrots / carrots 25lb / carrots 10lb / carrots (any size) = Carrots (catalog has 10lb bag — ignore size in order)
green pepper / bell pepper = Green Bell Pepper
serrano / green chili = Serrano Peppers
4-way / frozen mix / mixed veg = Frozen 4-Way Mix
frozen spinach / chopped spinach = Frozen Spinach
baby spinach / cleaned spinach = Fresh Spinach
tomato puree = Tomato Puree (NOT Tomato Sauce — different items)
tomato sauce = Tomato Sauce
petite diced / diced tomato = Petite Diced Tomato
roti / atta = Roti Atta (Golden Temple)
fryer oil / frying oil = Fryer Oil | salad oil / canola / canola oil / cooking oil / vegetable oil = Soybean Oil (we only use soybean)
liquid butter / butter alt = Liquid Butter
baking powder = Baking Powder (NOT baking soda — completely different product)
cornstarch = Cornstarch
paneer = Paneer | yogurt = Plain Yogurt
shrimp = Shrimp 16-20 | tilapia = Fish (Tilapia)

RULES — follow without exception:
1. Every item in the chef's order must appear in output. Zero exceptions.
2. THE CATALOG VERDICT IS THE FINAL ANSWER. Each catalog line starts with [RD] or [SYSCO]. Assign every item to that vendor. Do not override it.
3. [SYSCO] = buy from Sysco. [RD] = buy from RD. [?] = no price data, ORDER MANUALLY.
4. The $2 rule is already computed in the catalog. "same price ±$X → SYSCO preference rule" means SYSCO wins.
5. ⛔OOS = out of stock. Never assign an OOS item to that vendor.
6. Quantities: x2 means 2 cases → Item x2 — $total
7. Items not in catalog → ORDER MANUALLY.
8. Short names only. No brands, no notes, no parenthetical explanations.
9. Math must be exact.
10. Output ONLY the final list. No reasoning, no working.

OUTPUT — exactly this format, nothing else, no extra text:

🟢 RD
[Item] — $[price]
[Item] x[qty] — $[total]
Total: $[total]

🔵 SYSCO
[Item] — $[price]
Total: $[total]

⚠️ ORDER MANUALLY
[Item]
[Item]

💰 $[grand total]`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 4096, system: systemPrompt, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await r.json();
    if (data.error) throw new Error("API error: " + (data.error.message || JSON.stringify(data.error)));
    const result = data.content?.find(b => b.type === "text")?.text;
    if (!result) throw new Error("Empty response from Claude");
    res.json({ result });
  } catch(e) { log("Grocery error: " + e.message); res.status(500).json({ error: e.message }); }
});

// ── Cron + startup ────────────────────────────────────────────────────────────
// Daily 6am Las Vegas = 1pm UTC
cron.schedule("0 13 * * *", () => { log("⏰ Daily scrape"); runScrape("all").catch(console.error); });

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "../build/index.html")));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  log("🚀 Server port " + PORT);
  restoreFromGitHub()
    .catch(e => log("Restore error: " + e.message))
    .finally(() => { setTimeout(() => runScrape("all").catch(console.error), 5000); });
});
