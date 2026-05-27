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
const RD_SINGLE_UNIT = new Set(["42647","55519"]); // sold per-unit not per-case
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

// ── GitHub backup — commits prices.json to repo after every scrape ────────────
// Requires GITHUB_TOKEN and GITHUB_REPO env vars in Railway
// GITHUB_REPO format: "username/repo-name"
async function githubCommit(token, repo, filePath, content, message) {
  const apiBase = "https://api.github.com/repos/" + repo + "/contents/" + filePath;
  const headers = {
    "Authorization": "token " + token,
    "Content-Type": "application/json",
    "User-Agent": "naan-curry-price-tracker",
  };
  // Always fetch latest SHA right before committing to avoid conflicts
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
      rd: priceStore.rd,
      sysco: priceStore.sysco,
      lastUpdated: priceStore.lastUpdated,
      oos: priceStore.oos || { rd: [], sysco: [] },
      matchCache: matchCache,
      crossVendor: SYSCO_TO_RD,
    };

    const encoded = Buffer.from(JSON.stringify(data, null, 2)).toString("base64");
    const date = new Date().toISOString().slice(0, 10);

    // Commit prices first, then history sequentially (avoids SHA conflicts)
    await githubCommit(token, repo, "backup/prices.json", encoded, "Price backup " + date);
    log("✅ GitHub backup: prices.json committed to " + repo);

    // Now history
    const hEncoded = Buffer.from(JSON.stringify(priceHistory)).toString("base64");
    await githubCommit(token, repo, "backup/history.json", hEncoded, "History backup " + date);
    log("✅ GitHub backup: history.json committed");

  } catch(e) { log("❌ GitHub backup error: " + e.message); }
}

// ── Restore from GitHub backup on startup (if local files missing) ────────────
async function restoreFromGitHub() {
  const token = process.env.GITHUB_TOKEN;
  const repo  = process.env.GITHUB_REPO;
  if (!token || !repo) return;

  // Only restore if local prices are empty (fresh deploy)
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
      // Mark all restored prices as "low" confidence until re-scraped
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
    if (data.crossVendor) { Object.assign(SYSCO_TO_RD, data.crossVendor); }

    // Clean bad prices BEFORE saving (don't persist known-wrong prices)
    cleanBadPrices();
    savePrices();
    saveCache();
    saveCrossVendor();
    log("✅ Restore: " + Object.keys(priceStore.rd).length + " RD + " + Object.keys(priceStore.sysco).length + " Sysco prices restored from GitHub");

    // Restore history — MERGE with local history, don't overwrite
    // This preserves any local entries that didn't make it to GitHub backup
    try {
      const hBase = "https://api.github.com/repos/" + repo + "/contents/backup/history.json";
      const hR = await fetch(hBase, { headers: { "Authorization": "token " + token, "User-Agent": "naan-curry-price-tracker" } });
      if (hR.ok) {
        const hJ = await hR.json();
        const githubHistory = JSON.parse(Buffer.from(hJ.content, "base64").toString("utf8"));
        // Merge: for each item, combine local + GitHub entries, dedup by date, keep all unique dates
        Object.entries(githubHistory).forEach(([id, entries]) => {
          if (!priceHistory[id]) {
            priceHistory[id] = entries;
          } else {
            // Merge entries — keep all dates from both, prefer local if same date
            const localDates = new Set(priceHistory[id].map(e => e.date));
            const toAdd = entries.filter(e => !localDates.has(e.date));
            priceHistory[id] = [...priceHistory[id], ...toAdd]
              .sort((a, b) => a.date.localeCompare(b.date))
              .slice(-90); // keep max 90 days
          }
        });
        saveHistory();
        log("✅ Restore: history merged for " + Object.keys(priceHistory).length + " items");
      }
    } catch(e) { log("History restore error: " + e.message); }

    // Record TODAY's prices AFTER history is loaded — merges today on top correctly
    recordHistory();

    // Also restore item knowledge base from GitHub
    try {
      const kbBase = "https://api.github.com/repos/" + repo + "/contents/backup/item_knowledge.json";
      const kbR = await fetch(kbBase, { headers: { "Authorization": "token " + token, "User-Agent": "naan-curry-price-tracker" } });
      if (kbR.ok) {
        const kbJ = await kbR.json();
        itemKnowledge = JSON.parse(Buffer.from(kbJ.content, "base64").toString("utf8"));
        patchItemKnowledge(); // apply verified facts over any stale KB data
        saveItemKnowledge();
        log("✅ Restore: item knowledge base restored for " + Object.keys(itemKnowledge).length + " items");
      }
    } catch(e) { log("Item KB restore error: " + e.message); }
  } catch(e) { log("Restore error: " + e.message); }
}

const _loaded = loadPrices();
let priceStore = { ..._loaded, log: [], oos: _loaded.oos || { rd: [], sysco: [] } };

// Clean up any previously cached bad prices on startup
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
      delete priceStore.rd[id];
      cleaned++;
      console.log("🧹 Cleaned bad cached price: " + id + " was $" + entry.price + " (max $" + max + ")");
      return;
    }
    const min = RD_PRICE_MIN[id];
    if (min && entry.price < min) {
      delete priceStore.rd[id];
      cleaned++;
      console.log("🧹 Cleaned bad cached price: " + id + " was $" + entry.price + " (min $" + min + ") — likely per-lb stored as case price");
    }
  });
  if (cleaned > 0) savePrices();
}

const log = (msg) => {
  console.log(msg);
  priceStore.log.unshift({ time: new Date().toISOString(), msg });
  if (priceStore.log.length > 500) priceStore.log.pop();
};

// ── Match cache — persists learned name→ID mappings forever ──────────────────
const CACHE_FILE = "/data/nc_match_cache.json";
let matchCache = { rd: {}, sysco: {} }; // { "scraped name": "item_id" }

// Seed cache — known scraped-name → item-id mappings, never lost on restart
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
    "Jumbo Chicken Party Wings 6-8 ct": "77200",
    "Boneless Skinless Chicken Breasts": "77232",
    "Boneless, Skinless Chicken Breasts, Tenders Out, Dry": "77232",
    "White Cauliflower - 1 ct": "42606",
    "White Cauliflower": "42606",
    "Morton - Purex Salt - 50lb": "1070496",
    "Morton Purex Salt 50lb": "1070496",
    "Purex Salt - 50lb": "1070496",
  },
  sysco: {
    "Chicken Cvp Leg Quarter Small Halal": "1803287",
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
    "Pea Green Petit Grade A Packaged": "6409940",
    "Milk Coconut Unsweetened": "1425982",
    "Paste Chili Ground Sambal Oelek": "2638660",
    "Vinegar White Distilled 50 Grain": "4113049",
    "Water Spring In Plastic Bottle": "2886075",
    "Shrimp White Peeled And Deveined 16/20": "5106388",
    "Coloring Food Egg Shade Yellow": "4112262",
    "Oil Salad Canola Zero Trans Fat": "5061643",
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
    "Cream Heavy Whipping 40%": "2139911",
    "Cream Heavy Whipping": "2139911",
    "Demand Cheese Paneer": "7102961",
    "Paneer": "7102961",
    "Cilantro Bunch Iceless": "7078475",
  }
};

// ── Scraper health monitoring ────────────────────────────────────────────────
// Tracks expected item counts per vendor. If a scrape returns significantly fewer,
// Claude flags it as partial and keeps yesterday's prices.
const scraperHealth = {
  rd:    { expectedItems: 59, minThreshold: 0.80, lastGoodCount: 0 }, // warn if <80% of expected
  sysco: { expectedItems: 48, minThreshold: 0.80, lastGoodCount: 0 },
};

async function checkScraperHealth(vendor, scrapedCount, matchedCount) {
  const health = scraperHealth[vendor];
  const threshold = Math.floor(health.expectedItems * health.minThreshold);

  if (matchedCount >= threshold) {
    // Healthy scrape
    health.lastGoodCount = matchedCount;
    if (matchedCount > health.expectedItems) health.expectedItems = matchedCount; // auto-adjust upward
    log("✅ Scraper health [" + vendor + "]: " + matchedCount + "/" + health.expectedItems + " items — healthy");
    return { healthy: true, matchedCount };
  }

  // Partial scrape detected — ask Claude what to do
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
      // Merge: learned cache first, then SEED always wins (seed is ground truth)
      matchCache = {
        rd:    { ...(saved.rd    || {}), ...CACHE_SEED.rd    }, // seed overrides learned
        sysco: { ...(saved.sysco || {}), ...CACHE_SEED.sysco }, // seed overrides learned
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

  // Force-correct any known bad cache entries that may have been learned incorrectly
  const CACHE_CORRECTIONS = {
    rd: {
      "Herb - Mint- 1 lb":  "42647",  // was wrongly mapped to 42504 (Cucumbers)
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



// ── Sysco Nick List: exact Sysco UPCs from Nick List PDF ─────────────────────
// Prices from Sysco PDF: CS = case price
const SYSCO_ITEMS = [
  { id: "1094721", name: "Onion Yellow Jumbo Bag",                        pack: "1/50 LB" },
  { id: "1803287", name: "Chicken Cvp Leg Quarter Small Halal",           pack: "4/10LB"  },
  { id: "0868459", name: "Chicken Cvp Leg Meat Boneless Skinless",        pack: "4/10 LB" },
  { id: "8379251", name: "Flour All Purpose Hotel Restaurant Bleached",   pack: "1/25LB"  },
  { id: "4002325", name: "Tomato Puree 1.06 Fancy California",            pack: "6/#10"   },
  { id: "2139911", name: "Cream Heavy Whipping 40%",                                pack: "6/64OZ"  },
  { id: "4676306", name: "Milk Whole Gallon",                             pack: "4/1 GAL" },
  { id: "4119079", name: "Oil Soybean Vegetable Pure",                    pack: "1/35LB"  },
  { id: "5087572", name: "Sugar Granulated Extra Fine Cane",              pack: "1/25LB"  },
  { id: "4518403", name: "Shortening Fry Liquid Clear Zero Trans Fat",    pack: "1/35LB"  },
  { id: "3355757", name: "Butter-it Alternative Liquid Zero Trans Fat",   pack: "3/1 GAL" },
  { id: "4063095", name: "Juice Lemon Pasteurized Ultra Premium",         pack: "6/.5 GAL"},
  { id: "1543164", name: "Potato Baking Russet 40 Count Fresh",          pack: "1/50LB"  },
  { id: "5231238", name: "Chicken Breast Boneless Skinless",              pack: "2/10 LB" },
  { id: "6914451", name: "Pan Coating Butter It",                          pack: "6/14 OZ"  },
  { id: "2822379", name: "Cheese Cheddar Jack Fancy Shredded",                    pack: "4/5 LB"   },
  { id: "4564894", name: "Salt Granulated Plain",                              pack: "1/50 LB"  },
  { id: "7078475", name: "Cilantro Fresh",                                  pack: "1 CS"     },
  { id: "6344790", name: "Chicken Wings 1st And 2nd Joints Jumbo",          pack: "4/10 LB"  },
  { id: "1094663", name: "Onion Red Jumbo Bag",                             pack: "1/25LB"   },
  { id: "1821537", name: "Garlic Peeled Fresh",                             pack: "4/5LB"    },
  { id: "1184902", name: "Ginger Root Fresh",                               pack: "1/30 LB"  },
  { id: "1243724", name: "Cauliflower Cello Wrapped Fresh",                 pack: "12/1EA"   },
  { id: "0496671", name: "Tilapia Fillet Boneless Skinless Iqf",            pack: "2/5LB"    },
  { id: "6409940", name: "Pea Green Petit Grade A Packaged",                pack: "12/2.5LB" },
  { id: "1425982", name: "Milk Coconut Unsweetened",                        pack: "24/13.5OZ"},
  { id: "2638660", name: "Paste Chili Ground Sambal Oelek",                 pack: "3/136 OZ" },
  { id: "4113049", name: "Vinegar White Distilled 50 Grain",                pack: "4/1 GAL"  },
  { id: "2886075", name: "Water Spring In Plastic Bottle",                  pack: "24/500ML" },
  { id: "5106388", name: "Shrimp White Peeled And Deveined 16/20", pack: "4/2.5 LB" },
  { id: "4112262", name: "Coloring Food Egg Shade Yellow", pack: "4/1 GAL" },
  { id: "5061643", name: "Oil Salad Canola Zero Trans Fat", pack: "1/35 LB" },
  { id: "4073441", name: "Corn Starch Food Grade", pack: "24/1 LB" },
  { id: "5517701", name: "Powder Baking Double Acting", pack: "6/5 LB" },
  { id: "6988158", name: "Broccoli Floret Poly Packaging Grade A", pack: "12/2 LB" },
  { id: "2523833", name: "Spinach Chopped Bag", pack: "12/3LB" },
  { id: "7102961", name: "Demand Cheese Paneer", pack: "2/5 LB" },
  { id: "8474538", name: "Spinach Baby Fresh", pack: "1/4 LB" },
  { id: "3879962", name: "Carrots Loose Fresh", pack: "1/10 LB" },
  { id: "2252013", name: "Lemon Choice Fresh", pack: "1/115 CT" },
  { id: "7410640", name: "Cucumber Select Fresh", pack: "1/5 LB" },
  { id: "7007376", name: "Pepper Serrano Util", pack: "1/40 LB" },
  { id: "2037125", name: "Mint Fresh Herb", pack: "1/1 LB" },
  { id: "3960200", name: "Vegetable Mix 4-way", pack: "1/30 LB" },
  { id: "4014684", name: "Flour Wheat Whole Stone Ground", pack: "1/50LB" },
  { id: "4062337", name: "Bean Garbanzo Fancy No Sulfite", pack: "6/#10" },
  { id: "4014973", name: "Bean Kidney Dark Red", pack: "6/#10" },
  { id: "5895750", name: "Tomato Diced Salsa Style", pack: "6/#10" },
];

// ── Cross-vendor map: Sysco UPC → RD Item ID ─────────────────────────────────
// Seeded with known mappings, then auto-expanded by AI after each scrape
// Cross-vendor map: Sysco UPC → { rdId, rdMult }
// Both vendors show FULL CASE prices — rdMult is always 1
// Sysco $43.87 heavy cream = full 12/32oz case price
// RD $43.95 heavy cream = full case price
// Direct comparison is apples-to-apples
const SYSCO_TO_RD_SEED = {
  "1803287": { rdId: "77670",   rdMult: 1 }, // Chicken Leg Quarters Halal
  "0868459": { rdId: "77658",   rdMult: 1 }, // Chicken Leg Meat
  "5231238": { rdId: "77232",   rdMult: 1 }, // Chicken Breast
  "6344790": { rdId: "77200",   rdMult: 1 }, // Chicken Wings
  "8379251": { rdId: "2061212", rdMult: 1 }, // Flour
  "4002325": { rdId: "860044",  rdMult: 1 }, // Tomato Puree
  "4676306": { rdId: "370496",  rdMult: 1 }, // Whole Milk
  "4119079": { rdId: "1020075", rdMult: 1 }, // Soybean Oil
  "5087572": { rdId: "21051",   rdMult: 1 }, // Sugar
  "4518403": { rdId: "1020077", rdMult: 1 }, // Fry Shortening
  "3355757": { rdId: "1020152", rdMult: 1 }, // Butter Alternative
  "4063095": { rdId: "55523",   rdMult: 1 }, // Lemon Juice
  "1543164": { rdId: "42725",   rdMult: 1 }, // Russet Potato
  "6914451": { rdId: "12728",   rdMult: 1 }, // Pan Spray
  "4564894": { rdId: "1070496", rdMult: 1 }, // Salt
  "7078475": { rdId: "42566",   rdMult: 1 }, // Cilantro
  "2822379": { rdId: "1440203", rdMult: 1 }, // Cheddar Jack
  "1821537": { rdId: "44146",   rdMult: 1 }, // Garlic Peeled
  "1094663": { rdId: "42658",   rdMult: 1 }, // Red Onion
  "1184902": { rdId: "42513",   rdMult: 1 }, // Ginger
  "1243724": { rdId: "42606",   rdMult: 1 }, // Cauliflower
  "0496671": { rdId: "51457",   rdMult: 1 }, // Tilapia
  "6409940": { rdId: "86525",   rdMult: 1 }, // Peas
  "1425982": { rdId: "2620442", rdMult: 1 }, // Coconut Milk
  "2638660": { rdId: "13417",   rdMult: 1 }, // Sambal Oelek
  "4113049": { rdId: "45900",   rdMult: 1 }, // White Vinegar
  "2886075": { rdId: "21039",   rdMult: 1 }, // Evian Water
  "5106388": { rdId: "40212", rdMult: 1 }, // Shrimp White Peeled And Deveined 16/20
  "4112262": { rdId: "2550012", rdMult: 1 }, // Coloring Food Egg Shade Yellow
  "5061643": { rdId: "1020079", rdMult: 1 }, // Oil Salad Canola Zero Trans Fat
  "4073441": { rdId: "2910159", rdMult: 1 }, // Corn Starch Food Grade
  "5517701": { rdId: "29268", rdMult: 1 }, // Powder Baking Double Acting
  "6988158": { rdId: "64120", rdMult: 1 }, // Broccoli Floret Poly Packaging Grade A
  "2523833": { rdId: "64046", rdMult: 1 }, // Spinach Chopped Bag
  "7102961": { rdId: "1440528", rdMult: 1 }, // Demand Cheese Paneer
  "8474538": { rdId: "44211", rdMult: 1 }, // Spinach Baby Fresh
  "3879962": { rdId: "79152", rdMult: 1 }, // Carrots Loose Fresh
  "2252013": { rdId: "42570", rdMult: 1 }, // Lemon Choice Fresh
  "7410640": { rdId: "42504", rdMult: 1 }, // Cucumber Select Fresh
  "7007376": { rdId: "44137", rdMult: 1 }, // Pepper Serrano Util
  "2037125": { rdId: "42647", rdMult: 1 }, // Mint Fresh Herb
  "3960200": { rdId: "86527", rdMult: 1 }, // Vegetable Mix 4-way
  "4014684": { rdId: "53556", rdMult: 1 }, // Flour Wheat Whole Stone Ground
  "4062337": { rdId: "16200", rdMult: 1 }, // Bean Garbanzo Fancy No Sulfite
  "4014973": { rdId: "69810", rdMult: 1 }, // Bean Kidney Dark Red
  "5895750": { rdId: "860135", rdMult: 1 }, // Tomato Diced Salsa Style
  "1094721": { rdId: "42545",   rdMult: 1 }, // Yellow Onion 50lb
  "2139911": { rdId: "1530438", rdMult: 1 }, // Heavy Cream 6x64oz
};

const CROSS_VENDOR_FILE = "/data/nc_cross_vendor.json";
let SYSCO_TO_RD = { ...SYSCO_TO_RD_SEED };

function loadCrossVendor() {
  try {
    if (fs.existsSync(CROSS_VENDOR_FILE)) {
      const saved = JSON.parse(fs.readFileSync(CROSS_VENDOR_FILE, "utf8"));
      SYSCO_TO_RD = { ...SYSCO_TO_RD_SEED, ...saved };
      console.log("✅ Cross-vendor map loaded: " + Object.keys(SYSCO_TO_RD).length + " mappings");
    }
  } catch(e) { console.log("Cross-vendor load error:", e.message); }
}

function saveCrossVendor() {
  try { fs.writeFileSync(CROSS_VENDOR_FILE, JSON.stringify(SYSCO_TO_RD, null, 2)); }
  catch(e) { console.log("Cross-vendor save error:", e.message); }
}

loadCrossVendor();

// ── Price history store — persisted to disk + GitHub ─────────────────────────
const HISTORY_FILE = "/data/nc_history.json";
let priceHistory = {}; // { itemId: [{date, rd, sc}] }

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
    // Also write to /tmp as secondary backup in case /data has issues
    try { fs.writeFileSync("/tmp/nc_history_backup.json", data); } catch {}
  }
  catch(e) { console.log("History save error:", e.message); }
}

function loadHistoryFallback() {
  // Try /tmp backup if main history file is empty or missing
  try {
    if (fs.existsSync("/tmp/nc_history_backup.json")) {
      const backup = JSON.parse(fs.readFileSync("/tmp/nc_history_backup.json", "utf8"));
      const backupDates = new Set();
      Object.values(backup).forEach(entries => entries.forEach(e => backupDates.add(e.date)));
      // Merge backup into current history
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
      if (added > 0) {
        saveHistory();
        console.log("✅ History fallback: merged " + added + " entries from /tmp backup");
      }
    }
  } catch(e) { console.log("History fallback error:", e.message); }
}

function recordHistory() {
  // Use Las Vegas local date (UTC-7 or UTC-8 depending on DST)
  const now = new Date();
  const lvOffset = -7 * 60; // PDT (UTC-7), change to -8 for PST
  const lvTime = new Date(now.getTime() + (now.getTimezoneOffset() + lvOffset) * 60000);
  const today = lvTime.toISOString().slice(0, 10);
  let changed = false;
  // Go through every item we have prices for
  const allIds = new Set([...Object.keys(priceStore.rd), ...Object.keys(priceStore.sysco)]);
  allIds.forEach(id => {
    const rdP = priceStore.rd[id]?.price || null;
    const scP = priceStore.sysco[id]?.price || null;
    if (!rdP && !scP) return;
    if (!priceHistory[id]) priceHistory[id] = [];
    const existing = priceHistory[id].findIndex(e => e.date === today);
    if (existing >= 0) {
      // Update today — merge, never overwrite real price with null
      const old = priceHistory[id][existing];
      priceHistory[id][existing] = {
        date: today,
        rd: rdP || old.rd || null,
        sc: scP || old.sc || null,
      };
    } else {
      // New entry — keep max 90 days
      priceHistory[id] = [...priceHistory[id].slice(-89), { date: today, rd: rdP, sc: scP }];
    }
    changed = true;
  });
  if (changed) {
    saveHistory();
    log("📅 History recorded: " + allIds.size + " items for " + today);
  }
}

loadHistory();
loadHistoryFallback(); // merge any /tmp backup entries missed by main file
cleanBadPrices(); // remove any previously stored bad prices

// AI-powered cross-vendor linker — runs after both scrapers finish
async function buildCrossVendorMap(syscoMatched, rdMatched) {
  // Only process Sysco items not already in our map
  const unmapped = syscoMatched.filter(s => !SYSCO_TO_RD[s.id]);
  if (unmapped.length === 0) { log("Cross-vendor: all Sysco items already mapped"); return; }

  log("Cross-vendor: finding RD equivalents for " + unmapped.length + " unmapped Sysco items...");

  // Build context: what Sysco items need linking, and what RD items are available
  const syscoCtx = unmapped.map(s => {
    const item = SYSCO_ITEMS.find(i => i.id === s.id);
    return s.id + ": " + (item ? item.name + " " + item.pack : s.id);
  }).join("\n");

  const rdCtx = RD_ITEMS.map(i => i.id + ": " + i.name).join("\n");

  // Add current prices to context for smarter matching
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

For each Sysco item, find the Restaurant Depot item that is the SAME product. Consider:
1. Product type (most important - chicken thighs = chicken thighs)
2. Similar pack size / total weight
3. Price per unit should be in a similar range if available
4. Brand name doesn't matter

Valid match examples:
- Sysco "Onion Yellow Jumbo Bag 1/25LB @ $11.31" = RD "Jumbo Spanish Onions - 50 lbs @ $18.95" (both bulk yellow onions, different pack size is OK)
- Sysco "Cream Heavy 40% 12/32OZ @ $43.87" = RD "James Farm - Heavy Cream 40% - 64 oz @ $43.95" (same product, similar price confirms match)
- Sysco "Pan Coating Butter It 6/14 OZ" = RD "Chef's Quality - All Purpose Pan Spray - 17 oz" (same product category, different brand/size)

Skip if genuinely different products or you are not confident.

Return ONLY JSON array:
[{"sysco_id":"SYSCO_UPC","rd_id":"RD_ITEM_ID","reason":"one line explanation","confidence":"high|medium"}]`;

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
    if (newLinks > 0) {
      saveCrossVendor();
      log("Cross-vendor: " + newLinks + " new links saved (" + Object.keys(SYSCO_TO_RD).length + " total)");
    } else {
      log("Cross-vendor: no new links found");
    }
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
// Word-overlap scorer
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
  const results = [];
  const usedIds = new Set();
  const needsMatching = []; // items not in cache

  // ── Step 1: Check cache first (instant, no scoring needed) ──
  for (const scraped of scrapedItems) {
    const cachedId = cache[scraped.name];
    if (cachedId && itemList.find(i => i.id === cachedId)) {
      if (!usedIds.has(cachedId)) {
        results.push({ id: cachedId, price: scraped.price });
        usedIds.add(cachedId);
        log("📋 Cache hit: \"" + scraped.name + "\" → " + cachedId);
      }
    } else {
      needsMatching.push(scraped);
    }
  }
  log(source + ": " + (scrapedItems.length - needsMatching.length) + "/" + scrapedItems.length + " from cache, " + needsMatching.length + " need matching");

  // ── Step 2: Word-overlap for uncached items ──
  const stillUnmatched = [];
  for (const scraped of needsMatching) {
    let bestId = null, bestScore = 0;
    for (const item of itemList) {
      if (usedIds.has(item.id)) continue;
      const score = wordScore(scraped.name, item.name);
      if (score > bestScore) { bestScore = score; bestId = item.id; }
    }
    if (bestId && bestScore >= 6) {
      results.push({ id: bestId, price: scraped.price });
      usedIds.add(bestId);
      learnMatch(cacheKey, scraped.name, bestId); // save to cache
      log("✅ Word match: \"" + scraped.name + "\" → " + bestId + " (score=" + bestScore + ")");
    } else {
      stillUnmatched.push(scraped);
      log("❓ No word match: \"" + scraped.name + "\" (best score=" + bestScore + ")");
    }
  }

  // ── Step 3: AI for anything still unmatched ──
  const unmatchedListItems = itemList.filter(i => !usedIds.has(i.id));
  if (stillUnmatched.length > 0 && unmatchedListItems.length > 0) {
    log(source + ": sending " + stillUnmatched.length + " items to AI...");
    try {
      const prompt = "You are a grocery product matcher for a restaurant. Match each scraped product name to the correct item ID from our list. Use the closest match based on product type and description.\n\nSCRAPED PRODUCTS:\n" +
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
            results.push({ id, price });
            usedIds.add(id);
            if (scraped) learnMatch(cacheKey, scraped, id); // save AI match to cache
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

    // Set In-Store mode (not Pickup/Delivery) to get in-store pricing
    // Navigate to homepage first to trigger store selector
    await page.goto("https://member.restaurantdepot.com/", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));

    // Click "In-Store" option if not already selected
    const inStoreSet = await page.evaluate(() => {
      // Look for In-Store button/link
      const els = Array.from(document.querySelectorAll("button, a, div, span"));
      const inStore = els.find(el => el.textContent.trim() === "In-Store" || el.textContent.trim() === "In-Store Las Vegas");
      if (inStore) {
        inStore.click();
        return "clicked: " + inStore.textContent.trim();
      }
      // Check if already in In-Store mode
      const current = document.body.innerText;
      return current.includes("In-Store") ? "already set" : "not found";
    });
    log("RD: In-Store mode = " + inStoreSet);
    await new Promise(r => setTimeout(r, 2000));

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

    // RD price parsing strategy:
    // "Current price: $36.24"              → flat case price, use as-is
    // "Current price: $24.40" + "$2440-$8676" → range format, higher = case price
    // "Current price: $76.80 each (est.)"  → by-weight estimate, use as-is (it IS the case price)
    // "Current price: $76.80 each (estimated)" → same

    const priceLines = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Match both regular prices AND "each (est.)" / "each (estimated)" weight-based prices
      const m = line.match(/Current price:\s*\$([\d,]+\.[\d]{2})/i);
      if (!m) continue;

      const unitPrice = parseFloat(m[1].replace(",", ""));
      if (unitPrice < 0.5 || unitPrice > 5000) continue;

      // Detect if this is a by-weight estimate
      const isByWeight = /each\s*\(est/i.test(line) || /final cost by weight/i.test(line);

      // Check next 1-2 lines for a range "$XXXX-$YYYY" (cents format, flat items only)
      let casePrice = unitPrice;
      let raw = line;

      if (!isByWeight) {
        for (let k = i + 1; k <= Math.min(i + 2, lines.length - 1); k++) {
          const rangeLine = lines[k];
          const rangeM = rangeLine.match(/^\$([\d]+)-([\d]+)$/) ||
                         rangeLine.match(/^\$([\d]+)-\$([\d]+)$/) ||
                         rangeLine.match(/^\$([\d,]+\.\d{2})\s*-\s*\$([\d,]+\.\d{2})$/); // decimal format
          if (rangeM) {
            const raw1 = rangeM[1].replace(",",""), raw2 = rangeM[2].replace(",","");
            // Detect format: if values contain decimal point they're already dollars, else cents
            const lo = raw1.includes(".") ? parseFloat(raw1) : parseInt(raw1) / 100;
            const hi = raw2.includes(".") ? parseFloat(raw2) : parseInt(raw2) / 100;
            casePrice = Math.max(lo, hi);
            raw = line + " → case=" + casePrice;
            break;
          }
        }
      } else {
        // By-weight items — fixed case weights per item type at Restaurant Depot:
        // Chicken (wings, breast, leg meat, leg quarters): always 40 lb
        // Lamb leg: ~40-42 lb (use "About X lb" from page, fallback 40)
        // Goat bone-in box: always 15 lb
        const nearby = lines.slice(Math.max(0, i - 5), Math.min(lines.length, i + 10)).join(" ");
        const perLbM = nearby.match(/\$([\d]+\.[\d]{2})\s*\/\s*lb/i);

        if (perLbM) {
          const perLb = parseFloat(perLbM[1]);

          // Try to read "About X.X lb each" from page for variable-weight items
          const aboutLbM = nearby.match(/About\s+([\d.]+)\s+lb/i);
          const pageWeight = aboutLbM ? parseFloat(aboutLbM[1]) : null;

          // Determine case weight by item context
          const ctxLower = nearby.toLowerCase();
          let caseWeight;
          if (ctxLower.includes("goat")) {
            caseWeight = 15;
          } else if (ctxLower.includes("lamb")) {
            caseWeight = pageWeight || 42; // use actual page weight or fallback 42
          } else if (ctxLower.includes("chicken") || ctxLower.includes("wings") ||
                     ctxLower.includes("breast") || ctxLower.includes("thigh") ||
                     ctxLower.includes("leg meat") || ctxLower.includes("leg quarter") ||
                     ctxLower.includes("leg")) {
            caseWeight = 40;
          } else {
            caseWeight = pageWeight || 40; // fallback
          }

          casePrice = Math.round(perLb * caseWeight * 100) / 100;
          raw = line + " ($" + perLb + "/lb × " + caseWeight + "lb = $" + casePrice + ")";
          log("RD: by-weight — $" + perLb + "/lb × " + caseWeight + "lb = $" + casePrice);
        } else {
          // No per-lb rate found — try "Price estimate: $XX.XX"
          const estM = nearby.match(/Price estimate:\s*\$([\d,]+\.[\d]{2})/i);
          if (estM) {
            casePrice = parseFloat(estM[1].replace(",", ""));
            raw = line + " (est=" + casePrice + ")";
          } else {
            raw = line + " (by weight)";
          }
        }
      }

      if (casePrice < 0.5 || casePrice > 5000) continue;
      const ctx = lines.slice(Math.max(0, i - 10), Math.min(lines.length, i + 15));
      priceLines.push({ price: casePrice, unitPrice, raw, byWeight: isByWeight, ctx: ctx.join(" | ") });
    }
    log("RD: found " + priceLines.length + " price lines");
    log("RD: contexts: " + JSON.stringify(priceLines.slice(0, 5)));

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
      if (/^\d+ ct$|^1 ct$|^[A-Z0-9]+ - \d+$/.test(c)) return false; // "1 ct", "Bin - 4043"
      if (noise.has(c)) return false;
      if (!/[a-zA-Z]{3,}/.test(c)) return false;
      if (c.split(" ").length < 2) return false;
      return true;
    }

    const items = [];
    const seen = new Set();

    for (let pi = 0; pi < priceLines.length; pi++) {
      const pl = priceLines[pi];
      const ctxLines = pl.ctx.split(" | ").map(l => l.trim()).filter(l => l);

      // Find the "Current price: $XX" line in context (use unitPrice to find it)
      const cpStr = "Current price: $" + pl.unitPrice.toFixed(2);
      const priceIdx = ctxLines.findIndex(l => l.startsWith("Current price:") && l.includes("$" + pl.unitPrice.toFixed(2)));

      let bestName = null;

      if (priceIdx >= 0) {
        // Search FORWARD first (most items: name comes after price)
        for (let j = priceIdx + 1; j < Math.min(ctxLines.length, priceIdx + 10); j++) {
          const c = ctxLines[j];
          // Skip the range line "$XXXX-$YYYY" and unit lines
          if (/^\$[\d]+-/.test(c) || /^\$[\d]+$/.test(c)) continue;
          if (isProductName(c) && !seen.has(c)) { bestName = c; break; }
        }
        // Search BACKWARD if forward found nothing
        if (!bestName) {
          for (let j = priceIdx - 1; j >= Math.max(0, priceIdx - 10); j--) {
            const c = ctxLines[j];
            if (/^\$[\d]+-/.test(c) || /^\$[\d]+$/.test(c)) continue;
            if (isProductName(c) && !seen.has(c)) { bestName = c; break; }
          }
        }
      } else {
        // priceIdx not found (range case price) — search whole ctx
        for (let j = 0; j < ctxLines.length; j++) {
          const c = ctxLines[j];
          if (/^\$/.test(c) || /Current price/.test(c)) continue;
          if (isProductName(c) && !seen.has(c)) { bestName = c; break; }
        }
      }

      if (bestName && pl.price > 0) {
        // Before accepting this name+price combo, check if the name belongs
        // to a known single-unit item and the price exceeds its max
        // If so, don't assign — let a later price line with correct value claim the name
        const tentativeId = Object.entries(matchCache.rd || {}).find(([k]) => k === bestName)?.[1];
        const priceMax = tentativeId ? RD_PRICE_MAX[tentativeId] : null;
        if (priceMax && pl.price > priceMax) {
          log("RD: ⚠️ Rejecting name '" + bestName + "' for $" + pl.price + " (max $" + priceMax + " for this item) — will try to match name to correct price");
          // Don't add to seen — allow the correct lower price line to claim this name
        } else {
          items.push({ name: bestName, price: pl.price, raw: pl.raw });
          seen.add(bestName);
        }
      } else {
        log("RD: no name for $" + pl.price + " | " + ctxLines.filter(isProductName).join(" / "));
      }
    }

    // ── Targeted scan for single-unit items that normal extraction misses ────────
    // For items in RD_SINGLE_UNIT, search the full page for their name
    // then find the nearest "Current price: $X.XX" within 8 lines
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
      if (seen.has(itemId + "_found")) continue; // already found via normal extraction
      // Check if already found by name
      const alreadyFound = items.find(i => {
        const cache = matchCache.rd || {};
        return Object.entries(cache).find(([k, v]) => v === itemId && i.name === k);
      });
      if (alreadyFound) continue;

      // Scan full lines for this item's name
      for (let li = 0; li < lines.length; li++) {
        const lineText = lines[li];
        const ltLower = lineText.toLowerCase();
        const matched = nameVariants.some(v => {
          const vLower = v.toLowerCase();
          // Strict: must include the variant but NOT be the wrong item
          if (itemId === "77658" && ltLower.includes("quarter")) return false; // don't match quarters
          if (itemId === "77670" && ltLower.includes("leg meat")) return false; // don't match leg meat
          return ltLower.includes(vLower);
        });
        if (!matched) continue;

        // Found the name — look for price within ±10 lines
        let foundPrice = null;
        for (let offset = -10; offset <= 10; offset++) {
          const idx = li + offset;
          if (idx < 0 || idx >= lines.length) continue;
          const pm = lines[idx].match(/Current price:\s*\$([\d.]+)/i);
          if (pm) {
            const p = parseFloat(pm[1]);
            const max = RD_PRICE_MAX[itemId];
            const min = RD_PRICE_MIN[itemId];
            if (p > 0 && (!max || p <= max) && (!min || p >= min)) {
              foundPrice = p;
              break;
            }
          }
        }

        if (foundPrice) {
          const itemName = lineText.trim();
          if (isProductName(itemName) && !seen.has(itemName)) {
            items.push({ name: itemName, price: foundPrice, raw: "targeted scan: $" + foundPrice });
            seen.add(itemName);
            log("RD: 🎯 Targeted scan found " + itemId + " '" + itemName + "' = $" + foundPrice);
          } else {
            // Use the name from cache seed instead
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

    // Detect OOS items — catch all RD out-of-stock phrasings:
    // "Out of stock", "Likely out of stock", "Temporarily out of stock", etc.
    const OOS_PATTERNS = [
      /^out of stock$/i,
      /^likely out of stock$/i,
      /^temporarily out of stock$/i,
      /^currently out of stock$/i,
      /^item unavailable$/i,
      /^unavailable$/i,
    ];

    function isOosLine(line) {
      return OOS_PATTERNS.some(p => p.test(line.trim()));
    }

    const oosNames = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!isOosLine(line)) continue;
      // Search backward up to 8 lines for the nearest product name
      // Stop early if we hit another "Current price" (that belongs to a different item)
      let foundName = null;
      for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
        const prev = lines[j].trim();
        if (/Current price/i.test(prev)) break;
        if (isProductName(prev)) { foundName = prev; break; }
      }
      // Also search forward up to 4 lines (sometimes name comes after OOS label)
      if (!foundName) {
        for (let j = i + 1; j <= Math.min(lines.length - 1, i + 4); j++) {
          const next = lines[j].trim();
          if (/Current price/i.test(next)) break;
          if (isProductName(next)) { foundName = next; break; }
        }
      }
      if (foundName && !seen.has(foundName)) {
        oosNames.push(foundName);
        seen.add(foundName);
        log("RD: OOS confirmed [" + line.trim() + "]: " + foundName);
      }
    }
    log("RD: out-of-stock names found (" + oosNames.length + "): " + oosNames.join(", "));

    log("RD: " + items.length + " items extracted: " + JSON.stringify(items.slice(0, 10)));
    return { success: true, items, oosNames };
  } catch(e) {
    log("RD FATAL: " + e.message);
    return { success: false, error: e.message, items: [] };
  } finally {
    if (browser) { try { await browser.close(); } catch(e) {} }
  }
}

// ── Sysco Scraper — search each item within Nick List ────────────────────────
async function scrapeSysco() {
  log("🔵 Sysco: starting Nick List search scrape...");
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36");
    page.setDefaultTimeout(30000);

    // Login step 1: email
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

    // Login step 2: password (Okta)
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

    // Go to lists page and click Nick List
    await page.goto("https://shop.sysco.com/app/lists", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 4000));

    // Click Nick List LI
    let nickClicked = null;
    for (let attempt = 0; attempt < 15; attempt++) {
      nickClicked = await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll("li, a, button, div, span"));
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
      if (nickClicked) { log("Sysco: Nick List=" + nickClicked); break; }
      await new Promise(r => setTimeout(r, 1000));
    }
    if (!nickClicked) throw new Error("Nick List not found");

    // Wait for Nick List to load with items
    await new Promise(r => setTimeout(r, 4000));
    let rows = 0;
    for (let w = 0; w < 15; w++) {
      rows = await page.evaluate(() => document.querySelectorAll("[class*='product-item-row']").length);
      if (rows > 0) { log("Sysco: Nick List loaded, " + rows + " rows visible"); break; }
      await new Promise(r => setTimeout(r, 1000));
    }

    // Find the "Search List" input inside Nick List
    const searchInput = await page.$('input[placeholder*="Search List"], input[placeholder*="search list"], [data-id="myProductSearch"], input[aria-label*="Search List"]');
    if (!searchInput) {
      // Log all inputs to find the right one
      const inputs = await page.evaluate(() =>
        Array.from(document.querySelectorAll("input")).map(i => ({ type: i.type, placeholder: i.placeholder, ariaLabel: i.getAttribute("aria-label"), id: i.id, name: i.name }))
      );
      log("Sysco: inputs on page: " + JSON.stringify(inputs));
      throw new Error("Search List input not found");
    }
    log("Sysco: Search List input found");

    // Step 1: Clear search to show ALL items, scrape every UPC visible on the list
    // This auto-discovers any new items you added to Nick List in Sysco
    await searchInput.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    await new Promise(r => setTimeout(r, 2000));

    // Scroll through entire list to load all rows
    for (let s = 0; s < 20; s++) {
      await page.evaluate(() => window.scrollBy(0, 400));
      await new Promise(r => setTimeout(r, 200));
    }
    await new Promise(r => setTimeout(r, 1000));

    // Read ALL rows currently visible — captures every item on the Nick List
    const allDiscovered = await page.evaluate(() => {
      const rows = document.querySelectorAll("[class*='product-item-row']");
      const found = [];
      rows.forEach(row => {
        const nameEl = row.querySelector("[class*='item-details-col']");
        const priceEl = row.querySelector("[class*='price-col']");
        if (!nameEl || !priceEl) return;
        const text = row.innerText;
        // Extract UPC — usually a 7-digit number in the item details
        const upcM = text.match(/\b(\d{7})\b/);
        const name = nameEl.innerText.trim().split("\n")[0].trim();
        const priceText = priceEl.innerText.trim();
        const csM = priceText.match(/\$([\d,]+\.[\d]{2})\s*CS/i);
        const anyM = priceText.match(/\$([\d,]+\.[\d]{2})/);
        const m = csM || anyM;
        if (upcM && m && name) {
          found.push({ upc: upcM[1], name, price: parseFloat(m[1].replace(",", "")), raw: priceText });
        }
      });
      return found;
    });

    // Auto-update SYSCO_ITEMS with any newly discovered SKUs
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

    // Step 2: Now search each item (known + newly discovered) for accurate UPC-confirmed prices
    const allItems = new Map();

    // First populate from bulk discovery (items already visible)
    allDiscovered.forEach(disc => {
      allItems.set(disc.upc, { name: disc.name, price: disc.price, upc: disc.upc, raw: disc.raw });
    });
    log("Sysco: bulk discovery got " + allItems.size + " items");

    // Step 3: For known SKUs not caught by bulk, search individually to confirm
    for (const item of SYSCO_ITEMS) {
      if (allItems.has(item.id)) continue; // already found
      try {
        const SEARCH_OVERRIDES = {"7102961":"Paneer","0868459":"Chicken Leg Meat","1803287":"Chicken Leg Quarter Halal","5231238":"Chicken Breast Boneless","6344790":"Chicken Wings Jumbo"};
        const keyword = SEARCH_OVERRIDES[item.id] || item.name.split(" ").slice(0, 2).join(" ");
        await searchInput.click({ clickCount: 3 });
        await page.keyboard.type(keyword, { delay: 50 });
        await new Promise(r => setTimeout(r, 2000));

        const results = await page.evaluate((upc) => {
          const rows = document.querySelectorAll("[class*='product-item-row']");
          const found = [];
          rows.forEach(row => {
            const text = row.innerText;
            const nameEl = row.querySelector("[class*='item-details-col']");
            const priceEl = row.querySelector("[class*='price-col']");
            if (!nameEl || !priceEl) return;
            const name = nameEl.innerText.trim().split("\n")[0].trim();
            const priceText = priceEl.innerText.trim();
            const hasUpc = text.includes(upc);
            const csM = priceText.match(/\$([\d,]+\.[\d]{2})\s*CS/i);
            const anyM = priceText.match(/\$([\d,]+\.[\d]{2})/);
            const m = csM || anyM;
            if (m) found.push({ name, price: parseFloat(m[1].replace(",", "")), raw: priceText, hasUpc });
          });
          return found;
        }, item.id);

        const exact = results.find(r => r.hasUpc);
        const best = exact || results[0];
        if (best) {
          log("Sysco: " + item.name + " → $" + best.price + " (search fallback)");
          allItems.set(item.id, { name: item.name, price: best.price, upc: item.id, raw: best.raw });
        } else {
          log("Sysco: " + item.name + " not found in search");
        }
        await searchInput.click({ clickCount: 3 });
        await page.keyboard.press("Backspace");
        await new Promise(r => setTimeout(r, 500));
      } catch(e) {
        log("Sysco: error on " + item.name + ": " + e.message);
      }
    }

    const items = Array.from(allItems.values());
    log("Sysco: " + items.length + " items total (including " + newItemsFound + " new): " + JSON.stringify(items.slice(0, 5)));
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

// ── Feature 2: Cross-vendor price validation ─────────────────────────────────
// After both scrapers finish, Claude compares prices for the same item across vendors
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
    // Flag if one vendor's price is more than 3× the other — almost certainly a scrape error
    if (ratio > 3 || ratio < 0.33) {
      paired.push({
        rdId, syscoId,
        rdName: rdItem?.name || rdId,
        scName: scItem?.name || syscoId,
        rdPrice: rdEntry.price,
        scPrice: scEntry.price,
        ratio: ratio.toFixed(2),
      });
    }
  });

  if (paired.length === 0) { log("Cross-validation: all vendor pairs look reasonable ✅"); return; }

  log("Cross-validation: " + paired.length + " suspicious price pairs — asking Claude...");

  const prompt = `You are validating wholesale grocery prices for a restaurant. The same product was scraped from two vendors. Flag any prices that are clearly wrong.

SUSPICIOUS PRICE PAIRS (one vendor's price is 3× or more the other's):
${paired.map(p => `${p.rdName}: RD=$${p.rdPrice} vs Sysco=$${p.scPrice} (ratio=${p.ratio}x)`).join("\n")}

For each pair, which price is the error? Consider:
- Typical wholesale prices for each product type
- A 3× difference almost always means one price has a decimal error or is per-unit vs per-case
- Chicken 40lb case: typically $40-$120
- Produce per case: typically $5-$80
- Dairy per case: typically $15-$60

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
        priceStore.rd[rdId].auditLog = [...(priceStore.rd[rdId].auditLog || []), 
          { date: new Date().toISOString(), event: "cross_validation_flagged", reason, errorVendor }];
        log("🚨 Cross-validation: RD price for " + rdId + " flagged (" + reason + ")");
      } else if (errorVendor === "sysco" && priceStore.sysco[rdId]) {
        priceStore.sysco[rdId].confidence = "low";
        priceStore.sysco[rdId].crossValidationFlag = reason;
        priceStore.sysco[rdId].auditLog = [...(priceStore.sysco[rdId].auditLog || []),
          { date: new Date().toISOString(), event: "cross_validation_flagged", reason, errorVendor }];
        log("🚨 Cross-validation: Sysco price for " + rdId + " flagged (" + reason + ")");
      } else if (errorVendor === "none") {
        // Both confirmed reasonable — upgrade confidence
        if (priceStore.rd[rdId]) priceStore.rd[rdId].confidence = "high";
        if (priceStore.sysco[rdId]) priceStore.sysco[rdId].confidence = "high";
        log("✅ Cross-validation confirmed: " + rdId + " (" + reason + ")");
      }
    });
    savePrices();
    log("Cross-validation complete");
  } catch(e) { log("Cross-validation error: " + e.message); }
}

// ── Feature 1: AI Price Validation ───────────────────────────────────────────
async function validatePricesWithAI(vendor) {
  const store = vendor === "rd" ? priceStore.rd : priceStore.sysco;
  const items = vendor === "rd" ? RD_ITEMS : SYSCO_ITEMS;
  const history = priceHistory;

  // Build context: items where price changed significantly vs yesterday
  const suspicious = [];
  const today = new Date().toISOString().slice(0, 10);

  Object.entries(store).forEach(([id, entry]) => {
    const itemHistory = history[id] || [];
    if (itemHistory.length < 2) return;
    const prev = itemHistory[itemHistory.length - 2];
    const prevPrice = vendor === "rd" ? prev.rd : prev.sc;
    if (!prevPrice || !entry.price) return;
    const changePct = Math.abs((entry.price - prevPrice) / prevPrice) * 100;
    // Flag if price changed more than 20% overnight
    if (changePct > 20) {
      const itemList = vendor === "rd" ? RD_ITEMS : SYSCO_ITEMS;
      const item = itemList.find(i => i.id === id);
      suspicious.push({
        id,
        name: item?.name || id,
        prev: prevPrice,
        current: entry.price,
        changePct: Math.round(changePct),
      });
    }
  });

  if (suspicious.length === 0) { log("Price validation: no suspicious changes detected"); return; }

  log("Price validation: " + suspicious.length + " suspicious price changes — asking AI...");

  const prompt = `You are validating wholesale grocery prices for a restaurant. Review these price changes and identify which ones are likely scraping errors vs genuine price changes.

PRICE CHANGES (>20% overnight):
${suspicious.map(s => `${s.name}: $${s.prev} → $${s.current} (${s.changePct}% change)`).join("\n")}

For each item, decide:
- "valid": price change is plausible for this product (seasonal, market fluctuation)
- "error": price change is almost certainly a scraping error (e.g. 10x jump, doesn't match product type)

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
          // Revert to previous price
          if (vendor === "rd") priceStore.rd[id] = { ...priceStore.rd[id], price: prev, flagged: true };
          else priceStore.sysco[id] = { ...priceStore.sysco[id], price: prev, flagged: true };
          log("🤖 Price validation: REVERTED " + id + " from $" + store[id]?.price + " → $" + prev + " (" + reason + ")");
        }
      } else {
        // Confirmed valid — upgrade confidence to high
        if (vendor === "rd" && priceStore.rd[id]) {
          priceStore.rd[id].confidence = "high";
          priceStore.rd[id].validatedBy = "claude_price_validation";
          priceStore.rd[id].auditLog = [...(priceStore.rd[id].auditLog || []),
            { date: new Date().toISOString(), event: "ai_validated", confidence: "high", reason }];
        } else if (priceStore.sysco[id]) {
          priceStore.sysco[id].confidence = "high";
          priceStore.sysco[id].validatedBy = "claude_price_validation";
        }
        log("🤖 Price validation: CONFIRMED " + id + " price change (" + reason + ")");
      }
    });
    savePrices();
  } catch(e) { log("Price validation AI error: " + e.message); }
}

// ── Feature 3: Auto-add new RD items ─────────────────────────────────────────
async function autoDiscoverRDItems(scrapedItems) {
  // Find scraped items that didn't match anything in RD_ITEMS
  const knownIds = new Set(RD_ITEMS.map(i => i.id));
  const unmatched = scrapedItems.filter(s => {
    // Check if this scraped name is in our cache pointing to a known item
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

Which of these new items should be added to the restaurant's tracking list? Consider:
- Is it a food/beverage product the restaurant likely uses?
- Is it NOT a duplicate of an existing item (different name, same product)?
- Skip non-food items, equipment, disposables

Return ONLY JSON array of items to add:
[{"name":"exact scraped name","price":0.00,"category":"Produce|Dairy|Meat|Frozen|Dry|Oils|Other","reason":"why this should be tracked"}]
Return empty array [] if nothing should be added.`;

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

    // Store discovered items for review — don't auto-add to RD_ITEMS without review
    // Instead store them in priceStore for the app to display
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
        // Auto-discover potentially new items not in our list
        autoDiscoverRDItems(result.items).catch(e => log("Auto-discover error: " + e.message));
        // Health check — did we get enough items?
        const rdHealth = await checkScraperHealth("rd", result.items.length, matched.length);
        if (!rdHealth.healthy && rdHealth.action === "keep_yesterday") {
          log("🛡️ Health guard: keeping yesterday's RD prices (partial scrape)");
          // Mark existing prices as stale but don't overwrite with partial data
          Object.keys(priceStore.rd).forEach(id => {
            if (priceStore.rd[id]) {
              priceStore.rd[id].stale = true;
              priceStore.rd[id].staleReason = rdHealth.reason;
            }
          });
          savePrices();
          return; // skip saving this scrape's results
        }
        matched.forEach(({ id, price }) => {
          if (!id || price <= 0) return;
          // Sanity check against known max prices — catches adjacent-item bleed
          const maxPrice = RD_PRICE_MAX[id];
          if (maxPrice && price > maxPrice) {
            log("RD: ⚠️ Skipping bad price for " + id + ": $" + price + " (max expected $" + maxPrice + ")");
            return;
          }
          // Sanity check against min prices — catches per-lb price stored without ×weight
          const minPrice = RD_PRICE_MIN[id];
          if (minPrice && price < minPrice) {
            log("RD: ⚠️ Skipping bad price for " + id + ": $" + price + " (min expected $" + minPrice + ") — likely per-lb not case price");
            return;
          }
          // Also check single-unit items with generic $25 ceiling
          if (RD_SINGLE_UNIT.has(id) && !maxPrice && price > 25) {
            log("RD: ⚠️ Skipping suspicious single-unit price for " + id + ": $" + price);
            return;
          }
          const now = new Date().toISOString();
          const prevEntry = priceStore.rd[id];
          priceStore.rd[id] = {
            price,
            date: now,
            unit: RD_SINGLE_UNIT.has(id) ? "each" : "case",
            confidence: "medium",        // upgraded to "high" after AI validation
            source: "scraped_rd",
            rawScraped: null,
            scrapedAt: now,
            prevPrice: prevEntry?.price || null,
            validatedBy: null,
            auditLog: [
              ...(prevEntry?.auditLog || []).slice(-9), // keep last 10 entries
              { date: now, price, source: "scraped_rd", confidence: "medium" }
            ],
          };
        });
        // Match OOS scraped names to RD item IDs using simple word-overlap scoring
        const oosIds = [];
        if (result.oosNames && result.oosNames.length > 0) {
          log("RD: matching OOS names: " + JSON.stringify(result.oosNames));
          result.oosNames.forEach(oosName => {
            const oosLower = oosName.toLowerCase();
            let bestId = null, bestScore = 0;
            RD_ITEMS.forEach(item => {
              const iLower = item.name.toLowerCase();
              let score = 0;
              // Word overlap scoring
              iLower.split(" ").forEach(w => { if (w.length > 3 && oosLower.includes(w)) score += w.length; });
              oosLower.split(" ").forEach(w => { if (w.length > 3 && iLower.includes(w)) score += w.length; });
              if (score > bestScore) { bestScore = score; bestId = item.id; }
            });
            if (bestId && bestScore >= 4) {
              oosIds.push(bestId);
              log("RD: OOS matched '" + oosName + "' → " + bestId + " (score=" + bestScore + ")");
            } else {
              log("RD: OOS no match for '" + oosName + "' (best score=" + bestScore + ")");
            }
          });
        }
        if (!priceStore.oos) priceStore.oos = { rd: [], sysco: [] };
        priceStore.oos.rd = oosIds;
        if (oosIds.length) log("RD: ✅ out-of-stock IDs stored: " + oosIds.join(", "));
        else log("RD: no out-of-stock items matched");
        log("✅ RD: " + matched.length + " prices saved (" + result.items.length + " raw)");
        savePrices();
        // AI price validation — runs async, flags suspicious price changes
        validatePricesWithAI("rd").catch(e => log("Price validation error: " + e.message));
      } else { log("❌ RD: " + (result.error || "no items")); }
    } catch(e) { log("❌ RD: " + e.message); }
  }

  if (source === "sysco" || source === "all") {
    try {
      const result = await withTimeout(scrapeSysco(), 180000, "Sysco");
      if (result.success && result.items.length > 0) {
        const matched = await matchWithAI(result.items, SYSCO_ITEMS, "Sysco Nick List");
        // Health check
        const scHealth = await checkScraperHealth("sysco", result.items.length, matched.length);
        if (!scHealth.healthy && scHealth.action === "keep_yesterday") {
          log("🛡️ Health guard: keeping yesterday's Sysco prices (partial scrape)");
          Object.keys(priceStore.sysco).forEach(id => {
            if (priceStore.sysco[id]) { priceStore.sysco[id].stale = true; priceStore.sysco[id].staleReason = scHealth.reason; }
          });
          savePrices();
          return;
        }
        let savedCount = 0;
        matched.forEach(({ id, price }) => {
          if (!id || price <= 0) return;
          let adjP = price;
          if (id === "7102961" && price < 20) { adjP = Math.round(price*10*100)/100; log("Sysco: Paneer $"+price+"/lb x 10lb = $"+adjP); }
          priceStore.sysco[id] = { price: adjP, date: new Date().toISOString() };
          // ALSO save under RD equivalent ID for cross-vendor comparison
          const mapping = SYSCO_TO_RD[id];
          if (mapping) {
            const rdId = mapping.rdId || mapping;
            const rdMult = mapping.rdMult || 1;
            const nowSc = new Date().toISOString();
            const prevSc = priceStore.sysco[rdId];
            priceStore.sysco[rdId] = {
              price: adjP,  // use adjusted price (e.g. Paneer per-lb × 10 = case price)
              date: nowSc,
              syscoUpc: id,
              rdMult,
              confidence: "medium",
              source: "scraped_sysco",
              scrapedAt: nowSc,
              prevPrice: prevSc?.price || null,
              validatedBy: null,
              auditLog: [
                ...(prevSc?.auditLog || []).slice(-9),
                { date: nowSc, price: adjP, source: "scraped_sysco", confidence: "medium" }
              ],
            };
          }
          savedCount++;
        });
        // Build / expand cross-vendor map for any unmapped Sysco items
        await buildCrossVendorMap(matched, []);

        // Re-apply cross-vendor links now that map may have grown
        matched.forEach(({ id, price }) => {
          if (!id || price <= 0) return;
          const mapping = SYSCO_TO_RD[id];
          if (mapping) {
            const rdId = mapping.rdId || mapping;
            if (!priceStore.sysco[rdId]) {
              // Use adjusted price (handles per-lb items like Paneer)
              let reAdjP = price;
              if (id === "7102961" && price < 20) reAdjP = Math.round(price*10*100)/100;
              priceStore.sysco[rdId] = { price: reAdjP, date: new Date().toISOString(), syscoUpc: id, rdMult: mapping.rdMult || 1 };
            }
          }
        });

        log("✅ Sysco: " + savedCount + " prices saved (" + result.items.length + " raw). Mapped: " +
          matched.filter(m => SYSCO_TO_RD[m.id]).map(m => { const mp = SYSCO_TO_RD[m.id]; return m.id + "→" + (mp.rdId || mp) + (mp.rdMult > 1 ? "(×"+mp.rdMult+")" : ""); }).join(", "));
        savePrices();
        validatePricesWithAI("sysco").catch(e => log("Sysco price validation error: " + e.message));
      } else { log("❌ Sysco: " + (result.error || "no items")); }
    } catch(e) { log("❌ Sysco: " + e.message); }
  }
  priceStore.lastUpdated = new Date().toISOString();
  savePrices();
  recordHistory(); // record today's prices to history

  // Run cross-vendor validation only on full scrapes (both vendors)
  if (source === "all") {
    crossValidatePrices().catch(e => log("Cross-validation error: " + e.message));
  }

  // Backup everything to GitHub after each full scrape
  backupToGitHub().catch(e => log("Backup error: " + e.message));
}

// ── API routes ────────────────────────────────────────────────────────────────
// New items discovered by AI during scraping — review before adding
app.get("/api/discovered", (req, res) => res.json(priceStore.discovered || []));

// ── Item Knowledge Base ──────────────────────────────────────────────────────
// Stores full product details scraped from vendor product pages
// Built by Claude reading actual product pages — not manually entered
const ITEM_KB_FILE = "/data/nc_item_knowledge.json";
let itemKnowledge = {}; // { rdId: { rd: {...}, sysco: {...}, synthesized: {...}, lastUpdated } }

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
  const P = {
    "77200":  [40,"1 x 40 lb case","lb",40,"4 x 10 lb bags (40 lb)"],
    "77232":  [40,"1 x 40 lb case","lb",20,"2 x 10 lb bags (20 lb)"],
    "77658":  [40,"1 x 40 lb case","lb",40,"4 x 10 lb bags (40 lb)"],
    "77670":  [40,"1 x 40 lb case","lb",40,"4 x 10 lb bags (40 lb)"],
    "77682":  [40,"1 x 40 lb case","lb",40,"4 x 10 lb bags (40 lb)"],
    "44146":  [30,"6 x 5 lb bags (30 lb)","lb",20,"4 x 5 lb bags (20 lb)"],
    "42513":  [30,"1 x 30 lb bulk case","lb",30,"1 x 30 lb bag"],
    "42545":  [50,"1 x 50 lb bag","lb",50,"1 x 50 lb bag"],
    "42658":  [25,"1 x 25 lb bag","lb",25,"1 x 25 lb bag"],
    "42725":  [50,"1 x 50 lb bag","lb",50,"1 x 50 lb bag"],
    "42570":  [115,"1 x 115 count case","each",115,"1 x 115 count"],
    "44137":  [40,"1 x 40 lb box","lb",40,"1 x 40 lb case"],
    "79152":  [10,"1 x 10 lb bag","lb",10,"1 x 10 lb bag"],
    "42606":  [12,"12-head case","each",12,"12 x 1 head cello wrapped"],
    "42566":  [21,"6 x 3.5 oz bags","oz",21,"6 x 3.5 oz bags (30 ct)"],
    "42647":  [1,"1 x 1 lb package","lb",1,"1 x 1 lb package"],
    "1530438":[384,"6 x 64 oz jugs (384 oz)","oz",384,"6 x 64 oz jugs (384 oz)"],
    "370496": [4,"4 x 1 gallon jugs","gallon",4,"4 x 1 gallon jugs"],
    "1440203":[20,"4 x 5 lb bags (20 lb)","lb",20,"4 x 5 lb bags (20 lb)"],
    "1440528":[20,"4 x 5 lb loaves (20 lb)","lb",10,"2 x 5 lb blocks (10 lb)"],
    "14785":  [32,"1 x 32 lb container","lb",null,null],
    "1020077":[35,"1 x 35 lb bag","lb",35,"1 x 35 lb bag"],
    "1020079":[35,"1 x 35 lb container","lb",35,"1 x 35 lb container"],
    "1020075":[35,"1 x 35 lb container","lb",35,"1 x 35 lb container"],
    "1020152":[3,"3 x 1 gallon jugs","gallon",3,"3 x 1 gallon jugs"],
    "55523":  [4,"4 x 1 gallon jugs","gallon",3,"6 x 0.5 gallon jugs (3 gal)"],
    "45900":  [4,"4 x 1 gallon jugs","gallon",4,"4 x 1 gallon jugs"],
    "21051":  [25,"1 x 25 lb bag","lb",25,"1 x 25 lb bag"],
    "1070496":[50,"1 x 50 lb bag","lb",50,"1 x 50 lb bag"],
    "2061212":[25,"1 x 25 lb bag","lb",25,"1 x 25 lb bag"],
    "53556":  [40,"2 x 20 lb bags (40 lb)","lb",50,"1 x 50 lb bag"],
    "2910159":[3,"1 x 3 lb box","lb",24,"24 x 1 lb boxes"],
    "29268":  [30,"6 x 5 lb cans","lb",30,"6 x 5 lb cans (30 lb)"],
    "16200":  [54,"6 x #10 cans","lb",54,"6 x #10 cans"],
    "69810":  [60,"6 x #10 cans","lb",60,"6 x #10 cans"],
    "860135": [102,"6 x #10 cans","oz",102,"6 x #10 cans"],
    "490266": [40,"1 x 40 lb bag","lb",null,null],
    "86525":  [2.5,"1 x 2.5 lb bag","lb",30,"12 x 2.5 lb bags (30 lb)"],
    "64120":  [2,"1 x 2 lb bag","lb",24,"12 x 2 lb bags (24 lb)"],
    "64046":  [36,"12 x 3 lb bags (36 lb)","lb",36,"12 x 3 lb bags (36 lb)"],
    "86527":  [25,"10 x 2.5 lb bags (25 lb)","lb",30,"1 x 30 lb bag"],
    "51457":  [10,"1 x 10 lb box","lb",10,"2 x 5 lb boxes"],
    "40212":  [10,"1 x 10 lb box","lb",10,"4 x 2.5 lb bags"],
    "13417":  [408,"3 x 136 oz containers","oz",408,"3 x 136 oz containers"],
    "2620442":[4800,"12 x 400 ml cans","ml",9720,"24 x 13.5 oz cans"],
    "12728":  [102,"6 x 17 oz cans (102 oz)","oz",84,"6 x 14 oz cans (84 oz)"],
    "2550012":[4,"4 x 1 gallon jugs","gallon",4,"4 x 1 gallon jugs"],
    "21039":  [12000,"24 x 500 ml bottles","ml",12000,"24 x 500 ml bottles"],
    "1810019":[15,"1 x 15 lb box","lb",null,null],
    "79042":  [42,"variable weight ~40-42 lb","lb",null,null],
  };
  let n = 0;
  Object.entries(P).forEach(([id, [rdT,rdC,u,scT,scC]]) => {
    if (!itemKnowledge[id]) itemKnowledge[id] = { rd:{}, sysco:scT?{}:null, comparison:{}, rdItemId:id, lastUpdated:new Date().toISOString() };
    if (itemKnowledge[id].rd) Object.assign(itemKnowledge[id].rd, { totalUnits:rdT, caseContents:rdC, unitOfMeasure:u });
    if (scT && itemKnowledge[id].sysco) Object.assign(itemKnowledge[id].sysco, { totalUnits:scT, caseContents:scC, unitOfMeasure:u });
    if (!itemKnowledge[id].comparison) itemKnowledge[id].comparison = {};
    Object.assign(itemKnowledge[id].comparison, { rdTotalUnits:rdT, syscoTotalUnits:scT||null, unitOfMeasure:u });
    n++;
  });
  if (n > 0) { saveItemKnowledge(); console.log("Item KB patched: " + n + " items with verified facts"); }
}

loadItemKnowledge();

// Scrape RD product page for a single item
async function scrapeRDProductPage(browser, itemId) {
  const url = "https://member.restaurantdepot.com/store/business/product-detail/" + itemId;
  let page;
  try {
    page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36");
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));
    const text = await page.evaluate(() => document.body.innerText);
    return { url, text: text.slice(0, 3000), success: true };
  } catch(e) {
    return { url, error: e.message, success: false };
  } finally {
    if (page) await page.close();
  }
}

// Scrape Sysco product page for a single item
async function scrapesSyscoProductPage(browser, syscoUpc) {
  const url = "https://shop.sysco.com/app/catalog/search?query=" + syscoUpc;
  let page;
  try {
    page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36");
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));
    const text = await page.evaluate(() => document.body.innerText);
    return { url, text: text.slice(0, 3000), success: true };
  } catch(e) {
    return { url, error: e.message, success: false };
  } finally {
    if (page) await page.close();
  }
}

// Use Claude to extract and synthesize product knowledge from page text
async function synthesizeItemKnowledge(itemId, rdItemName, rdPageText, syscoItemName, syscoPageText) {
  const prompt = `You are building a product knowledge base for a restaurant purchasing system.

Extract detailed product information from these vendor page texts.

ITEM: ${rdItemName}
RD Item ID: ${itemId}

RESTAURANT DEPOT PAGE TEXT:
${rdPageText || "Not available"}

SYSCO PAGE TEXT:
${syscoPageText || "Not available"}

Extract ALL of the following information. Be precise — this will be used for purchasing decisions.

Return ONLY JSON:
{
  "rd": {
    "itemId": "${itemId}",
    "name": "exact product name from RD",
    "brand": "brand name",
    "packSize": "e.g. 1 case / 6 cans / 40 lbs",
    "caseContents": "what exactly comes in one case (e.g. 6 cans × 17 oz each)",
    "totalWeight": "total weight or volume in case (e.g. 102 oz total / 40 lb)",
    "unitOfMeasure": "lb|oz|ml|each|gallon",
    "totalUnits": 0,
    "pricePerUnit": 0.00,
    "upc": "UPC if visible",
    "binLocation": "bin number if visible",
    "category": "product category"
  },
  "sysco": {
    "upc": "Sysco UPC",
    "name": "exact product name from Sysco",
    "brand": "brand name",
    "packSize": "e.g. 4/10 LB",
    "caseContents": "what exactly comes in one case",
    "totalWeight": "total weight or volume",
    "unitOfMeasure": "lb|oz|ml|each|gallon",
    "totalUnits": 0
  },
  "comparison": {
    "sameProduct": true,
    "rdTotalUnits": 0,
    "syscoTotalUnits": 0,
    "unitOfMeasure": "lb|oz|ml|each",
    "rdPricePerUnit": null,
    "syscoPricePerUnit": null,
    "cheaperVendor": "rd|sysco|same|unknown",
    "notes": "any important differences in quality, brand, or specification"
  }
}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await r.json();
    const txt = data.content?.find(b => b.type === "text")?.text || "{}";
    const m = txt.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch(e) {
    log("Item KB synthesis error for " + itemId + ": " + e.message);
    return null;
  }
}

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
      const rdCtx2 = rdE?.scrapedCtx || "";
      const rdRaw = rdE?.rawScraped || "";
      const rdPrice = rdE?.price || null;
      let rdPage = "";
      try {
        const rr = await fetch("https://www.restaurantdepot.com/p/" + rdItem.id, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) });
        if (rr.ok) rdPage = (await rr.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 1500);
      } catch(e) {}
      const sysLine = syscoItem ? "Sysco: " + syscoItem.name + " | UPC: " + syscoUpc + " | Pack: " + syscoItem.pack : "No Sysco equivalent";
      const ctxLine = rdCtx2 ? "RD page context: " + rdCtx2 : "";
      const prompt = "Build wholesale grocery product knowledge for Naan & Curry Las Vegas.\nITEM: " + rdItem.name + " (RD: " + rdItem.id + ")" + (rdPrice ? "\nPrice: $" + rdPrice : "") + (rdRaw ? "\nFormat: " + rdRaw : "") + (ctxLine ? "\n" + ctxLine : "") + (rdPage ? "\nPage: " + rdPage : "") + "\n" + sysLine + "\nReturn ONLY JSON: {\"rd\":{\"name\":\"" + rdItem.name + "\",\"caseContents\":\"exact\",\"totalUnits\":0,\"unitOfMeasure\":\"lb\",\"binLocation\":\"\"},\"sysco\":" + (syscoItem ? "{\"name\":\"" + syscoItem.name + "\",\"pack\":\"" + syscoItem.pack + "\",\"caseContents\":\"exact\",\"totalUnits\":0,\"unitOfMeasure\":\"lb\"}" : "null") + ",\"comparison\":{\"rdTotalUnits\":0,\"syscoTotalUnits\":0,\"unitOfMeasure\":\"lb\",\"sameProduct\":true,\"notes\":\"\"}}";
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
  saveItemKnowledge(); patchItemKnowledge();
  log("Item KB complete: " + processed + "/" + needsUpdate.length);
  backupItemKnowledgeToGitHub().catch(e => log("KB backup error: " + e.message));
}

// Backup item knowledge to GitHub
async function backupItemKnowledgeToGitHub() {
  const token = process.env.GITHUB_TOKEN;
  const repo  = process.env.GITHUB_REPO;
  if (!token || !repo) return;
  try {
    const encoded = Buffer.from(JSON.stringify(itemKnowledge, null, 2)).toString("base64");
    await githubCommit(token, repo, "backup/item_knowledge.json", encoded, "Item knowledge " + new Date().toISOString().slice(0, 10));
    log("✅ Item KB backed up to GitHub");
  } catch(e) { log("Item KB GitHub error: " + e.message); }
}

// ── Pack size reference data ──────────────────────────────────────────────────
const PACK_SIZES = {
  // rdId: { rd: "pack description", sysco: "pack description", rdTotal: total_units, syscoTotal: total_units, unit: "lb|oz|ml|each" }
  "42545":  { rd: "1 × 50 lb bag",           sysco: "1 × 50 lb bag",          rdTotal: 50,    syscoTotal: 50,    unit: "lb"   },
  "1530438":{ rd: "6 × 64 oz jugs",          sysco: "6 × 64 oz jugs",          rdTotal: 384,   syscoTotal: 384,   unit: "oz"   },
  "370496": { rd: "1 × 1 gallon",            sysco: "4 × 1 gallon",           rdTotal: 128,   syscoTotal: 512,   unit: "oz"   },
  "1020152":{ rd: "1 × 1 gallon",            sysco: "3 × 1 gallon",           rdTotal: 128,   syscoTotal: 384,   unit: "oz"   },
  "55523":  { rd: "4 × 1 gallon jugs",        sysco: "6 × 0.5 gallon jugs",    rdTotal: 512,   syscoTotal: 384,   unit: "oz"   },
  "12728":  { rd: "1 × 17 oz can",           sysco: "6 × 14 oz cans",         rdTotal: 17,    syscoTotal: 84,    unit: "oz"   },
  "1440203":{ rd: "1 × 5 lb bag",            sysco: "4 × 5 lb bags",          rdTotal: 5,     syscoTotal: 20,    unit: "lb"   },
  "44146":  { rd: "1 × 30 lb bag",           sysco: "4 × 5 lb bags (20 lb)", rdTotal: 30,    syscoTotal: 20,    unit: "lb"   },
  "86525":  { rd: "1 × 2.5 lb bag",          sysco: "12 × 2.5 lb bags",       rdTotal: 2.5,   syscoTotal: 30,    unit: "lb"   },
  "2620442":{ rd: "1 × 400ml can",           sysco: "24 × 13.5 oz cans",      rdTotal: 400,   syscoTotal: 9720,  unit: "ml"   },
  "45900":  { rd: "1 × 1 gallon",            sysco: "4 × 1 gallon",           rdTotal: 128,   syscoTotal: 512,   unit: "oz"   },
  "64120":  { rd: "1 × 2 lb bag",            sysco: "12 × 2 lb bags",         rdTotal: 2,     syscoTotal: 24,    unit: "lb"   },
  "64046":  { rd: "1 × 3 lb bag",            sysco: "12 × 3 lb bags",         rdTotal: 3,     syscoTotal: 36,    unit: "lb"   },
  "42606":  { rd: "12-head case",            sysco: "12-head case",           rdTotal: 12,    syscoTotal: 12,    unit: "head" },
  "86527":  { rd: "1 × 2.5 lb bag",          sysco: "12 × 2.5 lb bags",       rdTotal: 2.5,   syscoTotal: 30,    unit: "lb"   },
  "1440528":{ rd: "1 × 5 lb loaf",           sysco: "2 × 5 lb loaves",        rdTotal: 5,     syscoTotal: 10,    unit: "lb"   },
  "2910159":{ rd: "1 × 3 lb box",            sysco: "24 × 1 lb boxes",        rdTotal: 3,     syscoTotal: 24,    unit: "lb"   },
  "29268":  { rd: "6 × 5 lb cans",            sysco: "6 × 5 lb cans",          rdTotal: 30,    syscoTotal: 30,    unit: "lb"   },
  "51457":  { rd: "1 × 10 lb box",           sysco: "2 × 5 lb boxes",         rdTotal: 10,    syscoTotal: 10,    unit: "lb"   },
  "40212":  { rd: "1 × 10 lb box",           sysco: "4 × 2.5 lb boxes",       rdTotal: 10,    syscoTotal: 10,    unit: "lb"   },
  // Same size — included so UI can still show pack info
  "77200":  { rd: "1 × 40 lb case",          sysco: "4 × 10 lb (40 lb)",      rdTotal: 40,    syscoTotal: 40,    unit: "lb"   },
  "77658":  { rd: "1 × 40 lb case",          sysco: "4 × 10 lb (40 lb)",      rdTotal: 40,    syscoTotal: 40,    unit: "lb"   },
  "77670":  { rd: "1 × 40 lb case",          sysco: "4 × 10 lb (40 lb)",      rdTotal: 40,    syscoTotal: 40,    unit: "lb"   },
  "77232":  { rd: "1 × 40 lb case",          sysco: "4 × 10 lb (40 lb)",      rdTotal: 40,    syscoTotal: 40,    unit: "lb"   },
  "77682":  { rd: "1 × 40 lb case",          sysco: "4 × 10 lb (40 lb)",      rdTotal: 40,    syscoTotal: 40,    unit: "lb"   },
  "42658":  { rd: "1 × 25 lb bag",           sysco: "1 × 25 lb bag",          rdTotal: 25,    syscoTotal: 25,    unit: "lb"   },
  "42725":  { rd: "1 × 50 lb case",          sysco: "1 × 50 lb bag",          rdTotal: 50,    syscoTotal: 50,    unit: "lb"   },
  "42513":  { rd: "1 × 30 lb case",          sysco: "1 × 30 lb bag",          rdTotal: 30,    syscoTotal: 30,    unit: "lb"   },
  "21039":  { rd: "24 × 500ml bottles",      sysco: "24 × 500ml bottles",     rdTotal: 12000, syscoTotal: 12000, unit: "ml"   },
};

// Get full item knowledge base
app.get("/api/item-knowledge", (req, res) => res.json(itemKnowledge));

// Get knowledge for a specific item
app.get("/api/item-knowledge/:id", (req, res) => {
  const kb = itemKnowledge[req.params.id];
  if (!kb) return res.status(404).json({ error: "No knowledge for this item yet" });
  res.json(kb);
});

// Trigger knowledge base build (can specify single item or all)
app.get("/api/build-knowledge", async (req, res) => {
  const force = req.query.force === "true";
  const itemId = req.query.item; // optional: build for single item
  res.json({ message: "Building item knowledge base" + (itemId ? " for item " + itemId : "") + "..." });
  buildItemKnowledgeBase(force).catch(e => log("KB build error: " + e.message));
});

// Unit price comparison — uses Claude + knowledge base for accuracy
app.post("/api/unit-compare", async (req, res) => {
  const { itemId, itemName, rdPrice, scPrice } = req.body;
  if (!itemId || !rdPrice || !scPrice) return res.status(400).json({ error: "Missing fields" });

  const packInfo = PACK_SIZES[itemId];
  const kb = itemKnowledge[itemId]; // Use knowledge base if available

  // Build context — prefer knowledge base over manual PACK_SIZES
  const rdPack  = kb?.rd?.caseContents  || kb?.rd?.packSize  || packInfo?.rd  || "1 case";
  const scPack  = kb?.sysco?.caseContents || kb?.sysco?.packSize || packInfo?.sysco || "1 case";
  const rdTotal = kb?.comparison?.rdTotalUnits    || packInfo?.rdTotal    || null;
  const scTotal = kb?.comparison?.syscoTotalUnits || packInfo?.syscoTotal || null;
  const unit    = kb?.comparison?.unitOfMeasure   || packInfo?.unit       || "unit";
  const notes   = kb?.comparison?.notes || "";

  const prompt = `You are a wholesale purchasing assistant for Naan & Curry restaurant in Las Vegas.

ITEM: ${itemName}
Restaurant Depot: $${rdPrice} for ${rdPack}${rdTotal ? " ("+rdTotal+" "+unit+" total)" : ""}
Sysco: $${scPrice} for ${scPack}${scTotal ? " ("+scTotal+" "+unit+" total)" : ""}
${notes ? "Additional context: " + notes : ""}

Calculate precisely:
1. Price per ${unit} for each vendor (use total units if provided)
2. Which vendor is cheaper per ${unit} and by how much (% and $)  
3. A plain English one-sentence recommendation for a restaurant buyer

Return ONLY JSON:
{
  "rdPerUnit": 0.00,
  "scPerUnit": 0.00,
  "unit": "${unit}",
  "rdPack": "${rdPack}",
  "scPack": "${scPack}",
  "cheaper": "rd|sysco|same",
  "savingsPct": 0,
  "savingsPerUnit": 0.00,
  "recommendation": "one sentence plain English",
  "dataSource": "${kb ? 'knowledge_base' : 'manual'}"
}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 500, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await r.json();
    const txt = data.content?.find(b => b.type === "text")?.text || "{}";
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return res.status(500).json({ error: "AI parse error" });
    res.json(JSON.parse(m[0]));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/history", (req, res) => res.json({
  data: priceHistory,
  lastRecorded: priceStore.lastUpdated || null,
}));

app.get("/api/prices", (req, res) => res.json({
  rd: priceStore.rd,
  sysco: priceStore.sysco,
  lastUpdated: priceStore.lastUpdated,
  oos: priceStore.oos || { rd: [], sysco: [] },
}));
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

// Debug endpoint: scrape RD and dump every price line + assigned name
app.get("/api/debug-rd", async (req, res) => {
  res.json({ message: "Debugging RD scrape — check /api/status in 3 minutes" });
  try {
    const result = await scrapeRD();
    // Log every single price+name pair
    result.items.forEach(item => {
      log("DEBUG: $" + item.price + " → " + item.name + " | raw=" + item.raw);
    });
    log("DEBUG: " + result.items.length + " total items scraped");
  } catch(e) { log("DEBUG error: " + e.message); }
});

// Force an immediate clean backup to GitHub (no scrape needed)
app.get("/api/force-backup", async (req, res) => {
  try {
    cleanBadPrices(); // ensure no bad prices go in
    await backupToGitHub();
    res.json({ success: true, rdItems: Object.keys(priceStore.rd).length, syscoItems: Object.keys(priceStore.sysco).length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Clear a specific item price and push clean backup to GitHub
// e.g. /api/clear?id=42647&vendor=rd
app.get("/api/clear", async (req, res) => {
  const { id, vendor } = req.query;
  if (!id) return res.status(400).json({ error: "id required" });
  const v = vendor || "rd";
  const cleared = [];

  // Clear from rd
  if ((v === "rd" || v === "all") && priceStore.rd[id]) {
    const old = priceStore.rd[id].price;
    delete priceStore.rd[id];
    cleared.push({ vendor: "rd", was: old });
    log("🧹 Cleared RD price for " + id + " (was $" + old + ")");
  }
  // Clear from sysco
  if ((v === "sysco" || v === "all") && priceStore.sysco[id]) {
    const old = priceStore.sysco[id].price;
    delete priceStore.sysco[id];
    cleared.push({ vendor: "sysco", was: old });
    log("🧹 Cleared Sysco price for " + id + " (was $" + old + ")");
  }
  // Also clear from history for this item
  if (priceHistory[id]) {
    priceHistory[id] = priceHistory[id].map(e => ({
      ...e,
      rd: (v === "rd" || v === "all") ? null : e.rd,
      sc: (v === "sysco" || v === "all") ? null : e.sc,
    }));
    saveHistory();
  }

  if (cleared.length > 0) {
    savePrices();
    // Push clean backup to GitHub immediately so restart doesn't restore bad price
    backupToGitHub().catch(e => log("Backup after clear: " + e.message));
    res.json({ cleared: true, id, details: cleared });
  } else {
    res.json({ cleared: false, message: "No price found for " + id + " at " + v });
  }
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
    const DIFF_SIZES = new Set(["55523","12728","44146","86525","2620442","64120","86527","1440528","2910159","29268"]);

    // Build the richest possible catalog — everything Claude needs to be accurate
    const catalog = [];
    RD_ITEMS.forEach(rdItem => {
      const rdE = priceStore.rd[rdItem.id];
      if (!rdE?.price) return;

      const syscoEntry = Object.entries(SYSCO_TO_RD).find(([upc, map]) => (map.rdId || map) === rdItem.id);
      const syscoUpc = syscoEntry?.[0];
      const syscoItem = syscoUpc ? SYSCO_ITEMS.find(i => i.id === syscoUpc) : null;
      const syscoE = syscoUpc ? (priceStore.sysco[rdItem.id] || priceStore.sysco[syscoUpc]) : null;

      // Pack info from KB (ground truth) or PACK_SIZES
      const kb = itemKnowledge[rdItem.id];
      const rdPack  = kb?.rd?.caseContents  || PACK_SIZES[rdItem.id]?.rd  || "1 case";
      const scPack  = kb?.sysco?.caseContents || syscoItem?.pack || PACK_SIZES[rdItem.id]?.sysco || "";

      // Short name
      const shortName = rdItem.name
        .replace(/Chef's Quality - |James Farm - |Royal Mahout - |Thomas Farms - |Clabber Girl - |Clabber Girl |Golden Temple - |Royal Chef's Secret - |Frozen James Farm - |Frozen /gi, "")
        .replace(/ - \d+.*$/, "").trim();

      // Raw scrape data — bin, stock status, price format
      const rdCtx = rdE.scrapedCtx || "";
      const rdBin = rdCtx.match(/Bin - (\d+)/)?.[1];
      const rdStock = rdCtx.includes("Many in stock") ? "In stock" : rdCtx.includes("out of stock") ? "OUT OF STOCK" : "";
      const rdRaw = rdE.rawScraped || "";

      const cheaper = syscoE?.price ? (rdE.price <= syscoE.price ? "RD" : "Sysco") : "RD only";
      const diffSize = DIFF_SIZES.has(rdItem.id);

      // Build catalog line with all available data
      let line = shortName;
      line += " | RD: $" + rdE.price + " — " + rdPack;
      if (rdBin) line += " (Bin " + rdBin + ")";
      if (rdStock) line += " [" + rdStock + "]";
      if (rdRaw && rdRaw !== "null") line += " {format: " + rdRaw + "}";
      if (syscoE?.price) {
        line += " | Sysco: $" + syscoE.price + " — " + scPack;
        line += " | CHEAPER: " + cheaper;
      } else {
        line += " | Sysco: not on Nick List";
      }
      if (diffSize) line += " *** DIFF CASE SIZE — compare per unit ***";
      catalog.push(line);
    });

    if (catalog.length === 0) return res.status(500).json({ error: "No price data — run scrape first at /api/trigger" });

    const prompt = `You are the purchasing assistant for Naan & Curry restaurant in Las Vegas.
You have complete knowledge of every item tracked, with today's live prices, pack sizes, bin locations, and stock status.
Parse the order list and produce a clean, accurate vendor breakdown.

TODAY'S COMPLETE PRICE CATALOG (${catalog.length} items):
${catalog.join("\n")}

ORDER LIST FROM CHEF:
${list}

MATCHING GUIDE:
LQ / leg quarters = Fresh Chicken Leg Quarters
chx breast / chicken breast = Boneless Skinless Chicken Breast  
WM / whole milk = Whole Milk
HWC / heavy cream / cream = Heavy Cream Whipping 40%
wings = Chicken Wings
leg meat = Chicken Leg Meat Boneless
garlic = Peeled Garlic
onion (without red/yellow) = Yellow Onion (most common)

RULES:
1. Every item in the order list must appear in the output — either assigned to a vendor or in ORDER MANUALLY
2. Assign to CHEAPER vendor always
3. If quantity given (x2, 2 cases, etc.) multiply and show math
4. Items marked DIFF CASE SIZE: assign to cheaper but add note "(verify case volume)"
5. OUT OF STOCK items at RD → check Sysco, else ORDER MANUALLY
6. Use short clean names — no brand names, no SKU numbers

OUTPUT — follow exactly, no markdown, no asterisks, no explanations:

🟢 RESTAURANT DEPOT
[Item] — $[price]
[Item] x[n] ([n] × $[unit]) — $[total]
RD Cart Total: $[total]

🔵 SYSCO
[Item] — $[price]
Sysco Cart Total: $[total]

⚠️ ORDER MANUALLY
[Item] — [reason]

💰 TOTAL ORDER COST: $[grand total]`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 2000, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await r.json();
    if (data.error) throw new Error("API error: " + (data.error.message || JSON.stringify(data.error)));
    const result = data.content?.find(b => b.type === "text")?.text;
    if (!result) throw new Error("Empty response from Claude");
    res.json({ result });
  } catch(e) { log("Grocery error: " + e.message); res.status(500).json({ error: e.message }); }
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
  // Restore from GitHub backup first if local data is empty, then scrape
  restoreFromGitHub()
    .catch(e => log("Restore error: " + e.message))
    .finally(() => {
      // Record current prices into history immediately (populates history tab right away)
      if (Object.keys(priceStore.rd).length > 0 || Object.keys(priceStore.sysco).length > 0) {
        recordHistory();
        log("📅 History seeded from current prices on startup");
      }
      setTimeout(() => runScrape("all").catch(console.error), 5000);
    });
});
