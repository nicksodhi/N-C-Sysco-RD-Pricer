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
  "42647":  15,  // Mint 1 lb (~$5-8)
  "55519":  25,  // Orchid Flowers (~$5-15)
  "1070496": 20, // Morton Salt 50lb (~$8-12)
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

    if (data.rd) { priceStore.rd = data.rd; }
    if (data.sysco) { priceStore.sysco = data.sysco; }
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

    // Restore history FIRST, then record today on top of it
    try {
      const hBase = "https://api.github.com/repos/" + repo + "/contents/backup/history.json";
      const hR = await fetch(hBase, { headers: { "Authorization": "token " + token, "User-Agent": "naan-curry-price-tracker" } });
      if (hR.ok) {
        const hJ = await hR.json();
        priceHistory = JSON.parse(Buffer.from(hJ.content, "base64").toString("utf8"));
        saveHistory();
        log("✅ Restore: history restored for " + Object.keys(priceHistory).length + " items");
      }
    } catch(e) { log("History restore error: " + e.message); }

    // Record TODAY's prices AFTER history is loaded — merges today on top correctly
    recordHistory();
  } catch(e) { log("Restore error: " + e.message); }
}

const _loaded = loadPrices();
let priceStore = { ..._loaded, log: [], oos: _loaded.oos || { rd: [], sysco: [] } };

// Clean up any previously cached bad prices on startup
function cleanBadPrices() {
  let cleaned = 0;
  Object.entries(priceStore.rd).forEach(([id, entry]) => {
    const max = RD_PRICE_MAX[id];
    if (max && entry.price > max) {
      delete priceStore.rd[id];
      cleaned++;
      console.log("🧹 Cleaned bad cached price: " + id + " was $" + entry.price + " (max $" + max + ")");
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
    "Fresh Chicken Leg Quarters - 40 lbs": "77670",
    "Boneless Skinless Chicken Breasts": "77232",
    "Herb - Mint - 1 lb": "42647",
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
    "Morton - Purex Salt - 50lb": "1070496",
    "Morton Purex Salt 50lb": "1070496",
    "Purex Salt - 50lb": "1070496",
  },
  sysco: {
    "Onion Yellow Jumbo Bag": "1048222",
    "Chicken Cvp Thighs Boneless Skinless Frozen": "8053456",
    "Chicken Legs Quarters Jumbo Controlled Vacuum": "4418117",
    "Chicken Cvp Leg Quarter Small Halal": "1803287",
    "Chicken Cvp Leg Meat Boneless Skinless": "0868459",
    "Flour All Purpose Hotel Restaurant Bleached": "8379251",
    "Tomato Puree 1.06 Fancy California": "4002325",
    "Cream Heavy 40% Extended Shelf Life": "6935464",
    "Milk Whole Gallon": "4676306",
    "Oil Soybean Vegetable Pure": "4119079",
    "Sugar Granulated Extra Fine Cane": "5087572",
    "Shortening Fry Liquid Clear Zero Trans Fat": "4518403",
    "Butter-it Alternative Liquid Zero Trans Fat": "3355757",
    "Juice Lemon Pasteurized Ultra Premium": "4063095",
    "Potato Baking Russet 40 Count Fresh": "1543164",
    "Chicken Breast Boneless Skinless": "5231238",
    "Pan Spray All Purpose": "6914451",
    "Cheese Cheddar Jack Shredded": "2822383",
    "Salt Kosher Coarse": "4564894",
    "Cilantro Fresh": "7078475",
  }
};

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
      // Merge: seed first, then saved (saved overrides seed if conflict)
      matchCache = {
        rd: { ...CACHE_SEED.rd, ...(saved.rd || {}) },
        sysco: { ...CACHE_SEED.sysco, ...(saved.sysco || {}) },
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
  { id: "5231238", name: "Chicken Breast Boneless Skinless",              pack: "2/10 LB" },
  { id: "6914451", name: "Pan Spray All Purpose",                           pack: "6/17 OZ"  },
  { id: "2822383", name: "Cheese Cheddar Jack Shredded",                    pack: "4/5 LB"   },
  { id: "4564894", name: "Salt Kosher Coarse",                              pack: "1/50 LB"  },
  { id: "7078475", name: "Cilantro Fresh",                                  pack: "1 CS"     },
];

// ── Cross-vendor map: Sysco UPC → RD Item ID ─────────────────────────────────
// Seeded with known mappings, then auto-expanded by AI after each scrape
const SYSCO_TO_RD_SEED = {
  "1048222": "42545",   "8053456": "77682",   "4418117": "77670",
  "1803287": "77670",   "0868459": "77658",   "8379251": "2061212",
  "4002325": "860044",  "6935464": "1530438", "4676306": "370496",
  "4119079": "1020075", "5087572": "21051",   "4518403": "1020077",
  "3355757": "1020152", "4063095": "55523",   "1543164": "42725",
  "5231238": "77232",   // Chicken Breast Boneless Skinless → Boneless Skinless Chicken Breasts
  "6914451": "12728",   // Pan Spray → All Purpose Pan Spray
  "2822383": "1440203", // Cheddar Jack Shredded → Fancy Shredded Cheddar Jack
  "4564894": "1070496", // Salt Kosher → Purex Salt 50lb
  "7078475": "42566",   // Cilantro Fresh → Bagged Cilantro
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
      console.log("✅ History loaded: " + count + " items");
    }
  } catch(e) { console.log("History load error:", e.message); }
}

function saveHistory() {
  try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(priceHistory)); }
  catch(e) { console.log("History save error:", e.message); }
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

  const prompt = `You are linking grocery products between two wholesale vendors (Sysco and Restaurant Depot) for the same restaurant.

SYSCO ITEMS (need RD equivalent):
${syscoCtx}

RESTAURANT DEPOT ITEMS:
${rdCtx}

For each Sysco item, find the Restaurant Depot item that is the SAME product (same food, similar pack size). Different brand names are OK as long as it's the same product type.

Examples of valid matches:
- "Onion Yellow Jumbo Bag 1/25LB" = "Jumbo Spanish Onions - 50 lbs" (both are bulk yellow onions)
- "Cream Heavy 40% 12/32OZ" = "James Farm - Heavy Cream 40% - 64 oz" (both are 40% heavy cream)

Only match if you are confident it is the same product. Skip if unclear.

Return ONLY JSON array:
[{"sysco_id":"SYSCO_UPC","rd_id":"RD_ITEM_ID","reason":"one line explanation"}]`;

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
                         rangeLine.match(/^\$([\d]+)-\$([\d]+)$/);
          if (rangeM) {
            const lo = parseInt(rangeM[1]) / 100;
            const hi = parseInt(rangeM[2]) / 100;
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
        items.push({ name: bestName, price: pl.price, raw: pl.raw });
        seen.add(bestName);
      } else {
        log("RD: no name for $" + pl.price + " | " + ctxLines.filter(isProductName).join(" / "));
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
        const keyword = item.name.split(" ").slice(0, 2).join(" ");
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

async function runScrape(source = "all") {
  if (source === "rd" || source === "all") {
    try {
      const result = await withTimeout(scrapeRD(), 180000, "RD");
      if (result.success && result.items.length > 0) {
        const matched = await matchWithAI(result.items, RD_ITEMS, "Restaurant Depot");
        matched.forEach(({ id, price }) => {
          if (!id || price <= 0) return;
          // Sanity check against known max prices — catches adjacent-item bleed
          const maxPrice = RD_PRICE_MAX[id];
          if (maxPrice && price > maxPrice) {
            log("RD: ⚠️ Skipping bad price for " + id + ": $" + price + " (max expected $" + maxPrice + ")");
            return;
          }
          // Also check single-unit items with generic $25 ceiling
          if (RD_SINGLE_UNIT.has(id) && !maxPrice && price > 25) {
            log("RD: ⚠️ Skipping suspicious single-unit price for " + id + ": $" + price);
            return;
          }
          priceStore.rd[id] = {
            price,
            date: new Date().toISOString(),
            unit: RD_SINGLE_UNIT.has(id) ? "each" : "case"
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
      } else { log("❌ RD: " + (result.error || "no items")); }
    } catch(e) { log("❌ RD: " + e.message); }
  }

  if (source === "sysco" || source === "all") {
    try {
      const result = await withTimeout(scrapeSysco(), 180000, "Sysco");
      if (result.success && result.items.length > 0) {
        const matched = await matchWithAI(result.items, SYSCO_ITEMS, "Sysco Nick List");
        let savedCount = 0;
        matched.forEach(({ id, price }) => {
          if (!id || price <= 0) return;
          // Save under Sysco UPC for reference
          priceStore.sysco[id] = { price, date: new Date().toISOString() };
          // ALSO save under RD equivalent ID for cross-vendor comparison
          const rdId = SYSCO_TO_RD[id];
          if (rdId) {
            priceStore.sysco[rdId] = { price, date: new Date().toISOString(), syscoUpc: id };
          }
          savedCount++;
        });
        // Build / expand cross-vendor map for any unmapped Sysco items
        await buildCrossVendorMap(matched, []);

        // Re-apply cross-vendor links now that map may have grown
        matched.forEach(({ id, price }) => {
          if (!id || price <= 0) return;
          const rdId = SYSCO_TO_RD[id];
          if (rdId && !priceStore.sysco[rdId]) {
            priceStore.sysco[rdId] = { price, date: new Date().toISOString(), syscoUpc: id };
          }
        });

        log("✅ Sysco: " + savedCount + " prices saved (" + result.items.length + " raw). Mapped: " +
          matched.filter(m => SYSCO_TO_RD[m.id]).map(m => m.id + "→" + SYSCO_TO_RD[m.id]).join(", "));
        savePrices();
      } else { log("❌ Sysco: " + (result.error || "no items")); }
    } catch(e) { log("❌ Sysco: " + e.message); }
  }
  priceStore.lastUpdated = new Date().toISOString();
  savePrices();
  recordHistory(); // record today's prices to history
  // Backup everything to GitHub after each full scrape
  backupToGitHub().catch(e => log("Backup error: " + e.message));
}

// ── API routes ────────────────────────────────────────────────────────────────
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
    const rdCtx = RD_ITEMS.map(i => {
      const p = priceStore.rd[i.id];
      return p ? i.name + ": $" + p.price + " (RD)" : null;
    }).filter(Boolean).join("\n");
    const scCtx = SYSCO_ITEMS.map(i => {
      // Try RD-mapped ID first (how Sysco prices are stored for comparison)
      const rdId = SYSCO_TO_RD[i.id];
      const p = (rdId && priceStore.sysco[rdId]) ? priceStore.sysco[rdId] : priceStore.sysco[i.id];
      return p ? i.name + " " + i.pack + ": $" + p.price + "/case (Sysco)" : null;
    }).filter(Boolean).join("\n");
    const prompt = `You are the purchasing assistant for Naan & Curry Las Vegas.

RD PRICES:
${rdCtx || "none"}

SYSCO PRICES:
${scCtx || "none"}

Order list:
${list}

Return a clean, minimal breakdown. Use SHORT common names only (e.g. "Russet Potato" not "Russet Potato - 50 lb Crtn, 90 cnt, US #1"). No markdown, no asterisks, no headers, no dashes in separators.

Strict format — follow exactly:

🟢 RESTAURANT DEPOT
Item Name — $price
Item Name (x2) — $price
RD Cart Total: $XX.XX

🔵 SYSCO
Item Name — $price
Sysco Cart Total: $XX.XX

⚠️ ORDER MANUALLY
Item name

💰 TOTAL ORDER COST: $XX.XX

Rules:
- Use shortest recognizable name for each item
- If quantity not specified assume 1 case
- Assign each item to the cheaper vendor when both carry it
- No explanations, no markdown formatting, no bold, no extra lines`;
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
