import { useState, useMemo, useRef, useEffect } from "react";

// ── ITEMS IN EXACT AISLE ORDER ────────────────────────────────────────────────
const RD_DATA = [
  // AISLE 1 — PRODUCE
  { id: "42599",    description: "Russet Potatoes",              unit: "case",   aisle: 1, category: "PRODUCE"    },
  { id: "44146",    description: "Peeled Garlic",                unit: "case",   aisle: 1, category: "PRODUCE"    },
  { id: "42513",    description: "Fresh Ginger",                 unit: "case",   aisle: 1, category: "PRODUCE"    },
  { id: "1440528",  description: "Paneer",                       unit: "case",   aisle: 1, category: "PRODUCE"    },
  { id: "P-CAULIF", description: "Cauliflower",                  unit: "case",   aisle: 1, category: "PRODUCE"    },
  { id: "P-GRNON",  description: "Green Onion",                  unit: "bags",   aisle: 1, category: "PRODUCE"    },
  { id: "P-FSPN",   description: "Fresh Spinach",                unit: "case",   aisle: 1, category: "PRODUCE"    },
  { id: "P-GBELL",  description: "Green Bell Pepper",            unit: "case",   aisle: 1, category: "PRODUCE"    },
  { id: "P-LEMON",  description: "Lemons",                       unit: "case",   aisle: 1, category: "PRODUCE"    },
  { id: "42566",    description: "Cilantro",                     unit: "case",   aisle: 1, category: "PRODUCE"    },
  { id: "P-MINT",   description: "Mint",                         unit: "bags",   aisle: 1, category: "PRODUCE"    },
  { id: "44137",    description: "Serrano Peppers",              unit: "case",   aisle: 1, category: "PRODUCE"    },
  { id: "42658",    description: "Red Onions",                   unit: "case",   aisle: 1, category: "PRODUCE"    },
  { id: "42545",    description: "Yellow Onions",                unit: "case",   aisle: 1, category: "PRODUCE"    },
  { id: "42504",    description: "Cucumbers",                    unit: "case",   aisle: 1, category: "PRODUCE"    },

  // AISLE 2 — DAIRY
  { id: "1530438",  description: "Heavy Cream",                  unit: "case",   aisle: 2, category: "DAIRY"      },
  { id: "370496",   description: "Whole Milk",                   unit: "case",   aisle: 2, category: "DAIRY"      },
  { id: "14785",    description: "Plain Yogurt",                 unit: "bucket", aisle: 2, category: "DAIRY"      },
  { id: "1440204",  description: "Cheddar Jack Cheese Blend",    unit: "case",   aisle: 2, category: "DAIRY"      },

  // AISLE 3 — MEAT
  { id: "77200",    description: "Chicken Wings",                unit: "case",   aisle: 3, category: "MEAT"       },
  { id: "77670",    description: "Chicken Leg Quarters",         unit: "case",   aisle: 3, category: "MEAT"       },
  { id: "77682",    description: "Chicken Thighs Boneless",      unit: "case",   aisle: 3, category: "MEAT"       },
  { id: "1810019",  description: "Goat Bone-in Cubed",           unit: "case",   aisle: 3, category: "MEAT"       },
  { id: "79042",    description: "Lamb Leg Boneless Halal",      unit: "case",   aisle: 3, category: "MEAT"       },

  // AISLE 4 — FROZEN
  { id: "77595",    description: "Chicken Thigh Meat Frozen",    unit: "case",   aisle: 4, category: "FROZEN"     },
  { id: "77597",    description: "Chicken Leg Meat Frozen Marinated", unit: "case", aisle: 4, category: "FROZEN"  },
  { id: "51457",    description: "Tilapia Fillets Frozen",       unit: "case",   aisle: 4, category: "FROZEN"     },
  { id: "64046",    description: "Chopped Spinach Frozen",       unit: "case",   aisle: 4, category: "FROZEN"     },
  { id: "64120",    description: "Broccoli Florets Frozen",      unit: "case",   aisle: 4, category: "FROZEN"     },
  { id: "86527",    description: "Mixed Vegetables Frozen",      unit: "case",   aisle: 4, category: "FROZEN"     },
  { id: "86525",    description: "Green Peas Frozen",            unit: "case",   aisle: 4, category: "FROZEN"     },

  // AISLE 5 — DRY GOODS / CANNED
  { id: "2910159",  description: "Cornstarch",                   unit: "case",   aisle: 5, category: "DRY GOODS"  },
  { id: "16200",    description: "Garbanzo Beans 6pk",           unit: "case",   aisle: 5, category: "DRY GOODS"  },
  { id: "69810",    description: "Red Kidney Beans 6pk",         unit: "case",   aisle: 5, category: "DRY GOODS"  },
  { id: "F-TOMPURE",description: "Tomato Puree 6pk",             unit: "case",   aisle: 5, category: "DRY GOODS"  },
  { id: "860044",   description: "Tomato Sauce 6pk",             unit: "case",   aisle: 5, category: "DRY GOODS"  },
  { id: "860135",   description: "Petite Diced Tomatoes 6pk",    unit: "case",   aisle: 5, category: "DRY GOODS"  },
  { id: "490266",   description: "Basmati Rice Extra Long Grain", unit: "case",  aisle: 5, category: "DRY GOODS"  },
  { id: "490219",   description: "Sela Basmati Rice",            unit: "case",   aisle: 5, category: "DRY GOODS"  },
  { id: "21051",    description: "Granulated Sugar",             unit: "case",   aisle: 5, category: "DRY GOODS"  },
  { id: "1070496",  description: "Salt",                         unit: "case",   aisle: 5, category: "DRY GOODS"  },
  { id: "29268",    description: "Baking Powder",                unit: "case",   aisle: 5, category: "DRY GOODS"  },
  { id: "53556",    description: "Atta Flour Durum Wheat",       unit: "case",   aisle: 5, category: "DRY GOODS"  },

  // AISLE 6 — LIQUIDS / OILS
  { id: "L-WHTVIN", description: "White Vinegar 4pk",            unit: "case",   aisle: 6, category: "LIQUIDS"    },
  { id: "1020152",  description: "Liquid Butter Alt",            unit: "case",   aisle: 6, category: "LIQUIDS"    },
  { id: "L-LEMJC",  description: "Lemon Juice 4pk",              unit: "case",   aisle: 6, category: "LIQUIDS"    },
  { id: "13417",    description: "Sambal Oelek Chili Paste",     unit: "case",   aisle: 6, category: "LIQUIDS"    },
  { id: "1020079",  description: "Canola Oil",                   unit: "case",   aisle: 6, category: "LIQUIDS"    },
  { id: "1020075",  description: "Soybean Oil",                  unit: "case",   aisle: 6, category: "LIQUIDS"    },
  { id: "1020077",  description: "Fry Oil",                      unit: "case",   aisle: 6, category: "LIQUIDS"    },

  // AISLE 7 — SPECIALTY / COLOR
  { id: "2550014",  description: "Red Food Coloring 4gal",       unit: "case",   aisle: 7, category: "SPECIALTY"  },
  { id: "S-YELCOL", description: "Egg Yellow Food Coloring 4gal",unit: "case",   aisle: 7, category: "SPECIALTY"  },
  { id: "25267",    description: "Roasted Eggplant Pulp",        unit: "case",   aisle: 7, category: "SPECIALTY"  },

  // AISLE 8 — NON-FOOD
  { id: "NF-PAPER", description: "Printer Paper Roll",           unit: "case",   aisle: 8, category: "NON-FOOD"   },
  { id: "12728",    description: "Pan Spray",                    unit: "case",   aisle: 8, category: "NON-FOOD"   },
];

const AISLE_LABELS = {
  1: "PRODUCE", 2: "DAIRY", 3: "MEAT", 4: "FROZEN",
  5: "DRY GOODS", 6: "LIQUIDS & OILS", 7: "SPECIALTY", 8: "NON-FOOD",
};

const CATS = ["ALL","PRODUCE","DAIRY","MEAT","FROZEN","DRY GOODS","LIQUIDS","SPECIALTY","NON-FOOD"];

// ── SEED DATA (sample prices) ─────────────────────────────────────────────────
const SEED_DATE_RD = new Date(Date.now() - 5 * 86400000).toISOString();
const SEED_DATE_SC = new Date(Date.now() - 2 * 86400000).toISOString();
const SEED_RD = {
  "42599":62.99,"44146":38.99,"42513":28.99,"1440528":89.99,"42566":18.99,
  "44137":24.99,"42658":32.99,"42545":29.99,"42504":22.99,
  "1530438":69.99,"370496":34.99,"14785":62.99,"1440204":54.99,
  "77200":89.99,"77670":74.99,"77682":109.99,"1810019":139.99,"79042":179.99,
  "77595":119.99,"77597":124.99,"51457":79.99,"64046":38.99,"64120":32.99,
  "86527":28.99,"86525":26.99,
  "2910159":34.99,"16200":54.99,"69810":52.99,"860044":48.99,"860135":51.99,
  "490266":38.99,"490219":36.99,"21051":24.99,"1070496":14.99,"29268":32.99,"53556":44.99,
  "1020152":62.99,"13417":44.99,"1020079":89.99,"1020075":82.99,"1020077":91.99,
  "2550014":44.99,"12728":32.99,
};
const SEED_SC = {
  "42599":68.99,"44146":34.99,"42513":31.99,"1440528":94.99,"42566":21.99,
  "44137":27.99,"42658":36.99,"42545":27.49,"42504":25.99,
  "1530438":74.99,"370496":31.99,"14785":67.99,"1440204":51.99,
  "77200":94.99,"77670":71.99,"77682":114.99,"1810019":149.99,"79042":169.99,
  "77595":124.99,"77597":129.99,"51457":84.99,"64046":41.99,"64120":29.99,
  "86527":31.99,"86525":24.99,
  "2910159":37.99,"16200":58.99,"69810":49.99,"860044":51.99,"860135":48.99,
  "490266":41.99,"490219":39.99,"21051":27.99,"1070496":12.99,"29268":35.99,"53556":48.99,
  "1020152":67.99,"13417":48.99,"1020079":94.99,"1020075":86.99,"1020077":88.99,
  "2550014":47.99,"12728":35.99,
};

function initPriceMap(seed, date) {
  const m = {};
  for (const [id, price] of Object.entries(seed)) m[id] = { price, date };
  return m;
}
function initHistory(rdM, scM) {
  const h = {};
  for (const id of new Set([...Object.keys(rdM), ...Object.keys(scM)])) {
    h[id] = [];
    if (rdM[id]) h[id].push({ price: rdM[id].price, date: rdM[id].date, source: "rd" });
    if (scM[id]) h[id].push({ price: scM[id].price, date: scM[id].date, source: "sysco" });
  }
  return h;
}
function friendlyDate(iso) {
  if (!iso) return null;
  const d = Math.floor((Date.now() - new Date(iso)) / 86400000);
  if (d === 0) return "today"; if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`; if (d < 30) return `${Math.floor(d/7)}w ago`;
  return `${Math.floor(d/30)}mo ago`;
}
function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]); r.onerror = rej;
    r.readAsDataURL(file);
  });
}
function fuzzyMatch(name) {
  const n = name.toLowerCase(); let best = null, bestScore = 0;
  for (const item of RD_DATA) {
    const words = item.description.toLowerCase().split(" "), nw = n.split(" ");
    let hits = 0;
    for (const w of nw) if (w.length > 2 && words.some(iw => iw.includes(w) || w.includes(iw))) hits++;
    const score = hits / Math.max(nw.length, 1);
    if (score > bestScore) { bestScore = score; best = item; }
  }
  return bestScore > 0.3 ? best : null;
}
function parseCSVText(text) {
  const results = [];
  for (const line of text.trim().split("\n")) {
    const cols = line.split(",").map(c => c.replace(/^"|"$/g, "").trim());
    const priceCol = cols.find(c => /^\$?[\d]+\.[\d]{2}$/.test(c.replace("$", "")));
    const price = priceCol ? parseFloat(priceCol.replace("$", "")) : null;
    const desc = cols.find(c => c.length > 4 && !/^\d+\.?\d*$/.test(c) && !c.startsWith("$"));
    if (price && desc) results.push({ description: desc, price });
  }
  return results;
}
async function scanImagesWithAI(files, source) {
  const imgs = await Promise.all(files.map(async f => ({
    type: "image", source: { type: "base64", media_type: f.type || "image/jpeg", data: await fileToBase64(f) }
  })));
  const list = RD_DATA.map(i => `${i.id}: ${i.description}`).join("\n");
  const prompt = `Scan these ${source === "rd" ? "Restaurant Depot" : "Sysco"} price labels/receipts/screenshots.
Extract ALL items with visible prices. Match each to this list:
${list}
Return ONLY valid JSON array:
[{"id":"ID_OR_NULL","description":"match","price":0.00,"confidence":"high|medium|low","raw":"text seen"}]`;
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000,
      messages: [{ role: "user", content: [...imgs, { type: "text", text: prompt }] }] })
  });
  const data = await resp.json();
  const txt = data.content?.find(b => b.type === "text")?.text || "[]";
  try { return JSON.parse(txt.replace(/```json|```/g, "").trim()); } catch { return []; }
}

// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab] = useState("home");
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);

  const [rdMap, setRdMap] = useState({});
  const [scMap, setScMap] = useState({});
  const [history, setHistory] = useState({});
  const [hiddenItems, setHiddenItems] = useState(new Set());

  // ── Load all shared data on mount, then poll every 60s ──
  async function loadFromStorage() {
    setSyncing(true);
    try {
      const [rdRes, scRes, histRes, hiddenRes] = await Promise.all([
        window.storage.get("nc_rd", true).catch(() => null),
        window.storage.get("nc_sc", true).catch(() => null),
        window.storage.get("nc_history", true).catch(() => null),
        window.storage.get("nc_hidden", true).catch(() => null),
      ]);
      setRdMap(rdRes ? JSON.parse(rdRes.value) : initPriceMap(SEED_RD, SEED_DATE_RD));
      setScMap(scRes ? JSON.parse(scRes.value) : initPriceMap(SEED_SC, SEED_DATE_SC));
      setHistory(histRes ? JSON.parse(histRes.value) : initHistory(initPriceMap(SEED_RD, SEED_DATE_RD), initPriceMap(SEED_SC, SEED_DATE_SC)));
      setHiddenItems(hiddenRes ? new Set(JSON.parse(hiddenRes.value)) : new Set());
      setLastSync(new Date());
    } catch (e) {
      // fallback to seed if storage unavailable
      setRdMap(initPriceMap(SEED_RD, SEED_DATE_RD));
      setScMap(initPriceMap(SEED_SC, SEED_DATE_SC));
      setHistory(initHistory(initPriceMap(SEED_RD, SEED_DATE_RD), initPriceMap(SEED_SC, SEED_DATE_SC)));
    }
    setSyncing(false);
    setLoaded(true);
  }

  useEffect(() => {
    loadFromStorage();
    const interval = setInterval(loadFromStorage, 60000); // refresh every 60s
    return () => clearInterval(interval);
  }, []);

  // ── Save helpers — write shared so all users see it ──
  async function saveRd(newMap) { try { await window.storage.set("nc_rd", JSON.stringify(newMap), true); } catch {} }
  async function saveSc(newMap) { try { await window.storage.set("nc_sc", JSON.stringify(newMap), true); } catch {} }
  async function saveHistory(newHist) { try { await window.storage.set("nc_history", JSON.stringify(newHist), true); } catch {} }
  async function saveHidden(newSet) { try { await window.storage.set("nc_hidden", JSON.stringify([...newSet]), true); } catch {} }
  const [storeMode, setStoreMode] = useState(null);
  const [homeCat, setHomeCat] = useState("ALL");
  const [homeSearch, setHomeSearch] = useState("");
  const [scanSrc, setScanSrc] = useState("rd");
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState(null);
  const [scanErr, setScanErr] = useState("");
  const [histItem, setHistItem] = useState(null);
  const [histRange, setHistRange] = useState("month");
  const [showHidden, setShowHidden] = useState(false);
  const fileRef = useRef();

  function hideItem(id) {
    const newSet = new Set([...hiddenItems, id]);
    setHiddenItems(newSet); saveHidden(newSet);
  }
  function unhideItem(id) {
    const newSet = new Set(hiddenItems); newSet.delete(id);
    setHiddenItems(newSet); saveHidden(newSet);
  }

  function recordPrice(id, price, src) {
    const entry = { price, date: new Date().toISOString() };
    const histEntry = { ...entry, source: src };
    if (src === "rd") {
      const newMap = { ...rdMap, [id]: entry };
      setRdMap(newMap); saveRd(newMap);
    } else {
      const newMap = { ...scMap, [id]: entry };
      setScMap(newMap); saveSc(newMap);
    }
    const newHist = { ...history, [id]: [...(history[id] || []), histEntry] };
    setHistory(newHist); saveHistory(newHist);
  }
  function onFiles(e) {
    const fs = Array.from(e.target.files); if (!fs.length) return;
    setFiles(fs); setPreviews(fs.map(f => URL.createObjectURL(f)));
    setScanResults(null); setScanErr(""); e.target.value = "";
  }
  async function runScan() {
    setScanning(true); setScanErr(""); setScanResults(null);
    try { setScanResults(await scanImagesWithAI(files, scanSrc)); }
    catch { setScanErr("Scan failed — check connection and try again."); }
    setScanning(false);
  }
  function applyAllScan() {
    let n = 0;
    for (const r of (scanResults || [])) if (r.id && r.price > 0) { recordPrice(r.id, r.price, scanSrc); n++; }
    setFiles([]); setPreviews([]); setScanResults(null);
    alert(`✓ Saved ${n} prices.`);
  }
  function handleCSV(e, src) {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const rows = parseCSVText(ev.target.result); let n = 0;
      for (const row of rows) { const item = fuzzyMatch(row.description); if (item) { recordPrice(item.id, row.price, src); n++; } }
      alert(`✓ Matched ${n} of ${rows.length} items.`);
    };
    reader.readAsText(f); e.target.value = "";
  }

  function getBest(id) {
    const rd = rdMap[id]?.price, sc = scMap[id]?.price;
    if (!rd && !sc) return null; if (!rd) return "sysco"; if (!sc) return "rd";
    if (rd < sc) return "rd"; if (sc < rd) return "sysco"; return "tie";
  }
  function getSav(id) {
    const rd = rdMap[id]?.price, sc = scMap[id]?.price;
    return (rd && sc) ? Math.abs(rd - sc) : 0;
  }

  // Group items by aisle for the RD shopping mode
  const aisleGroups = useMemo(() => {
    const filtered = RD_DATA.filter(item => {
      if (hiddenItems.has(item.id)) return false;
      const b = getBest(item.id);
      if (storeMode === "rd" && b !== "rd") return false;
      if (storeMode === "sysco" && b !== "sysco") return false;
      if (homeCat !== "ALL" && item.category !== homeCat) return false;
      if (homeSearch && !item.description.toLowerCase().includes(homeSearch.toLowerCase())) return false;
      return true;
    });

    if (storeMode === "rd") {
      // Group by aisle for in-store shopping
      const groups = {};
      for (const item of filtered) {
        if (!groups[item.aisle]) groups[item.aisle] = [];
        groups[item.aisle].push(item);
      }
      return groups;
    }
    return null;
  }, [storeMode, homeCat, homeSearch, rdMap, scMap, hiddenItems]);

  const flatFiltered = useMemo(() => {
    if (storeMode === "rd") return null; // use aisleGroups instead
    return RD_DATA.filter(item => {
      if (hiddenItems.has(item.id)) return false;
      const b = getBest(item.id);
      if (storeMode === "sysco" && b !== "sysco") return false;
      if (homeCat !== "ALL" && item.category !== homeCat) return false;
      if (homeSearch && !item.description.toLowerCase().includes(homeSearch.toLowerCase())) return false;
      return true;
    }).sort((a, b) => getSav(b.id) - getSav(a.id));
  }, [storeMode, homeCat, homeSearch, rdMap, scMap, hiddenItems]);

  const rdWins = useMemo(() => RD_DATA.filter(i => getBest(i.id) === "rd").length, [rdMap, scMap]);
  const scWins = useMemo(() => RD_DATA.filter(i => getBest(i.id) === "sysco").length, [rdMap, scMap]);
  const totalSav = useMemo(() => RD_DATA.reduce((s, i) => s + getSav(i.id), 0), [rdMap, scMap]);

  const overallNewest = useMemo(() => {
    const all = Object.values(history).flat();
    return all.length ? new Date(Math.max(...all.map(e => new Date(e.date)))) : null;
  }, [history]);

  function histEntries(id) {
    const days = histRange === "week" ? 7 : histRange === "month" ? 30 : 365;
    const cut = new Date(Date.now() - days * 86400000);
    return (history[id] || []).filter(e => new Date(e.date) >= cut);
  }

  const winColor = storeMode === "rd" ? "#4ade80" : storeMode === "sysco" ? "#60a5fa" : "#e85d2f";
  const NAV = [
    { id: "home", icon: "⚡", label: "HOME" },
    { id: "scan", icon: "📷", label: "SCAN" },
    { id: "upload", icon: "📄", label: "UPLOAD" },
    { id: "history", icon: "📈", label: "HISTORY" },
  ];

  // ── ITEM CARD ────────────────────────────────────────────────────────────────
  function ItemCard({ item, compact = false }) {
    const rd = rdMap[item.id], sc = scMap[item.id];
    const b = getBest(item.id);
    const wc = b === "rd" ? "#4ade80" : b === "sysco" ? "#60a5fa" : "#555";
    const cardBg = b === "rd"
      ? "linear-gradient(135deg,#0d1f12,#0f2318)"
      : b === "sysco"
      ? "linear-gradient(135deg,#0d1525,#0f1a2e)"
      : "#111318";
    const cardBorder = b === "rd" ? "#1a3d20" : b === "sysco" ? "#1a2d4a" : "#161820";
    const sav = getSav(item.id);
    const rdAge = rd?.date ? friendlyDate(rd.date) : null;
    const scAge = sc?.date ? friendlyDate(sc.date) : null;

    // In RD store mode — simpler list style showing just RD price + savings vs Sysco
    if (storeMode === "rd") {
      return (
        <div style={{ background: cardBg, border: `1px solid ${cardBorder}`, borderRadius: 7,
          padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, cursor: "pointer" }} onClick={() => { setHistItem(item); setTab("history"); }}>
            <div style={{ fontSize: 12, color: "#e8e4dc", lineHeight: 1.2 }}>{item.description}</div>
            <div style={{ fontSize: 9, color: "#555", marginTop: 2 }}>{item.unit}</div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0, cursor: "pointer" }} onClick={() => { setHistItem(item); setTab("history"); }}>
            <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 22, color: "#4ade80", lineHeight: 1 }}>
              {rd ? `$${rd.price.toFixed(2)}` : "—"}
            </div>
            {sav > 0 && <div style={{ fontSize: 9, color: "#4ade80" }}>save ${sav.toFixed(2)} vs Sysco</div>}
            {rdAge && <div style={{ fontSize: 8, color: rdAge === "today" || rdAge === "yesterday" ? "#4ade80" : "#444" }}>{rdAge}</div>}
          </div>
          <button onClick={() => hideItem(item.id)} title="Hide item"
            style={{ background: "none", border: "1px solid #2a2d3a", color: "#444", width: 26, height: 26, borderRadius: 4, cursor: "pointer", fontSize: 12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>
      );
    }

    // In Sysco mode — show Sysco price + savings vs RD
    if (storeMode === "sysco") {
      return (
        <div style={{ background: cardBg, border: `1px solid ${cardBorder}`, borderRadius: 7,
          padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, cursor: "pointer" }} onClick={() => { setHistItem(item); setTab("history"); }}>
            <div style={{ fontSize: 12, color: "#e8e4dc", lineHeight: 1.2 }}>{item.description}</div>
            <div style={{ fontSize: 9, color: "#555", marginTop: 2 }}>{item.unit}</div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0, cursor: "pointer" }} onClick={() => { setHistItem(item); setTab("history"); }}>
            <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 22, color: "#60a5fa", lineHeight: 1 }}>
              {sc ? `$${sc.price.toFixed(2)}` : "—"}
            </div>
            {sav > 0 && <div style={{ fontSize: 9, color: "#60a5fa" }}>save ${sav.toFixed(2)} vs RD</div>}
            {scAge && <div style={{ fontSize: 8, color: scAge === "today" || scAge === "yesterday" ? "#4ade80" : "#444" }}>{scAge}</div>}
          </div>
          <button onClick={() => hideItem(item.id)} title="Hide item"
            style={{ background: "none", border: "1px solid #2a2d3a", color: "#444", width: 26, height: 26, borderRadius: 4, cursor: "pointer", fontSize: 12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>
      );
    }

    // All items — 2-col grid card
    return (
      <div style={{ background: cardBg, border: `1px solid ${cardBorder}`, borderRadius: 8, padding: "11px 12px", position: "relative" }}>
        {/* Hide button */}
        <button onClick={() => hideItem(item.id)}
          style={{ position: "absolute", top: 7, right: 7, background: "none", border: "none", color: "#333", fontSize: 13, cursor: "pointer", lineHeight: 1, padding: 2 }}
          title="Hide this item">✕</button>

        <div style={{ cursor: "pointer" }} onClick={() => { setHistItem(item); setTab("history"); }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5, paddingRight: 16 }}>
            <div style={{ fontSize: 9, color: wc, letterSpacing: 2 }}>
              {b === "rd" ? "BUY AT RD" : b === "sysco" ? "ORDER SYSCO" : b === "tie" ? "SAME" : "NO DATA"}
            </div>
            {sav > 0 && <div style={{ fontSize: 9, color: wc, background: `${wc}18`, padding: "1px 6px", borderRadius: 10 }}>save ${sav.toFixed(2)}</div>}
          </div>
          <div style={{ fontSize: 11, color: "#d0ccc4", lineHeight: 1.3, marginBottom: 8, minHeight: 24 }}>{item.description}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 8, color: b === "rd" ? "#4ade80" : "#444", letterSpacing: 1 }}>RD</span>
                {rdAge && <span style={{ fontSize: 8, color: rdAge === "today" || rdAge === "yesterday" ? "#4ade80" : "#444" }}>{rdAge}</span>}
              </div>
              <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 22, lineHeight: 1, color: b === "rd" ? "#4ade80" : rd ? "#e8e4dc" : "#222" }}>
                {rd ? `$${rd.price.toFixed(2)}` : "—"}
              </div>
            </div>
            <div style={{ width: 1, background: "#1e2130" }} />
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 8, color: b === "sysco" ? "#60a5fa" : "#444", letterSpacing: 1 }}>SYSCO</span>
                {scAge && <span style={{ fontSize: 8, color: scAge === "today" || scAge === "yesterday" ? "#4ade80" : "#444" }}>{scAge}</span>}
              </div>
              <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 22, lineHeight: 1, color: b === "sysco" ? "#60a5fa" : sc ? "#e8e4dc" : "#222" }}>
                {sc ? `$${sc.price.toFixed(2)}` : "—"}
              </div>
            </div>
          </div>
          {b && b !== "tie" && <div style={{ marginTop: 7, height: 2, background: `linear-gradient(90deg,${wc}70,transparent)`, borderRadius: 1 }} />}
        </div>
      </div>
    );
  }

  // ── RENDER ───────────────────────────────────────────────────────────────────
  if (!loaded) return (
    <div style={{ minHeight: "100vh", background: "#0c0e13", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "'DM Mono',monospace", gap: 16 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap');`}</style>
      <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 32, letterSpacing: 4, color: "#e85d2f" }}>NAAN & CURRY</div>
      <div style={{ fontSize: 11, color: "#555", letterSpacing: 2 }}>LOADING LIVE PRICES...</div>
      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
        {[0,1,2].map(i => (
          <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "#e85d2f", opacity: 0.3, animation: `pulse 1.2s ${i*0.2}s ease-in-out infinite` }} />
        ))}
      </div>
      <style>{`@keyframes pulse { 0%,100%{opacity:.3} 50%{opacity:1} }`}</style>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#0c0e13", color: "#e8e4dc", fontFamily: "'DM Mono','Courier New',monospace", paddingBottom: 70 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Bebas+Neue&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-thumb{background:#e85d2f;border-radius:2px;}
        input:focus,select:focus{outline:none;}
        .pill{background:none;border:1px solid #1e2130;color:#555;padding:5px 11px;cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;border-radius:20px;transition:all .15s;letter-spacing:1px;white-space:nowrap;}
        .pill:hover{border-color:#777;color:#e8e4dc;}
        .zone{border:2px dashed #1e2130;border-radius:8px;padding:28px;text-align:center;cursor:pointer;transition:all .2s;}
        .zone:hover{border-color:#e85d2f;background:rgba(232,93,47,0.03);}
        .nav-btn{background:none;border:none;color:#444;font-family:'DM Mono',monospace;font-size:9px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 0;flex:1;transition:color .15s;letter-spacing:1px;}
        .nav-btn.on{color:#e85d2f;}
        .sinp{background:#0c0e13;border:1px solid #e85d2f;color:#e8e4dc;padding:3px 7px;font-family:'DM Mono',monospace;font-size:12px;border-radius:3px;width:70px;}
        .conf-high{color:#4ade80;}.conf-medium{color:#facc15;}.conf-low{color:#f87171;}
        .aisle-header{display:flex;align-items:center;gap:10px;margin:16px 0 8px;}
        .aisle-line{flex:1;height:1px;background:#1e2130;}
        .store-btn{padding:8px 14px;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;border-radius:6px;letter-spacing:1px;transition:all .15s;}
      `}</style>

      {/* TOP BAR */}
      <div style={{ background: "#0c0e13", borderBottom: "1px solid #1a1d27", padding: "12px 16px 0", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div>
            <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 22, letterSpacing: 3, color: "#e85d2f", lineHeight: 1 }}>NAAN & CURRY</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
              {syncing
                ? <div style={{ fontSize: 9, color: "#e85d2f", letterSpacing: 1 }}>⟳ syncing...</div>
                : lastSync
                  ? <div style={{ fontSize: 9, color: "#333", letterSpacing: 1 }}>● live · {lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                  : null}
              <button onClick={loadFromStorage} title="Refresh prices"
                style={{ background: "none", border: "none", color: "#333", fontSize: 12, cursor: "pointer", padding: "0 2px", lineHeight: 1 }}>↻</button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 14 }}>
            {[["#4ade80","RD WINS",rdWins],["#60a5fa","SYSCO WINS",scWins],["#e85d2f","SAVINGS",`$${totalSav.toFixed(0)}`]].map(([c,l,v]) => (
              <div key={l} style={{ textAlign: "right" }}>
                <div style={{ fontSize: 8, color: c, letterSpacing: 1 }}>{l}</div>
                <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 22, color: c, lineHeight: 1 }}>{v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Store mode buttons */}
        {tab === "home" && (
          <div style={{ display: "flex", gap: 8, paddingBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
            {[
              [null, "⚡ ALL", "#e85d2f", "#1a1d27"],
              ["rd", "🟢 AT DEPOT", "#4ade80", "#0d1f12"],
              ["sysco", "🔵 AT SYSCO", "#60a5fa", "#0d1525"],
            ].map(([mode, label, color, bg]) => (
              <button key={String(mode)} className="store-btn"
                onClick={() => setStoreMode(m => m === mode ? (mode === null ? null : null) : mode)}
                style={storeMode === mode
                  ? { background: bg, border: `2px solid ${color}`, color }
                  : { background: "none", border: "2px solid #1e2130", color: "#555" }}>
                {label}
              </button>
            ))}

          </div>
        )}
      </div>

      <div style={{ padding: "12px 14px" }}>

        {/* ══ HOME ══ */}
        {tab === "home" && (
          <>
            {/* Active store banner */}
            {storeMode && (
              <div style={{
                background: storeMode === "rd" ? "#0d1f12" : "#0d1525",
                border: `1px solid ${storeMode === "rd" ? "#1a3d20" : "#1a2d4a"}`,
                borderRadius: 8, padding: "10px 14px", marginBottom: 12,
                display: "flex", justifyContent: "space-between", alignItems: "center"
              }}>
                <div>
                  <div style={{ fontSize: 9, color: winColor, letterSpacing: 2 }}>
                    {storeMode === "rd" ? "YOUR SHOPPING LIST AT" : "ORDER THESE FROM"}
                  </div>
                  <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 22, color: winColor, letterSpacing: 2, lineHeight: 1 }}>
                    {storeMode === "rd" ? "RESTAURANT DEPOT" : "SYSCO"}
                  </div>
                  <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>
                    {storeMode === "rd" ? "In aisle order — work top to bottom" : "Items cheaper than Restaurant Depot"}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 9, color: "#555" }}>ITEMS</div>
                  <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 36, color: winColor, lineHeight: 1 }}>
                    {storeMode === "rd"
                      ? Object.values(aisleGroups || {}).flat().length
                      : flatFiltered?.length || 0}
                  </div>
                </div>
              </div>
            )}

            {!storeMode && (
              <div style={{ display: "flex", gap: 12, marginBottom: 10, fontSize: 10, color: "#555" }}>
                <span><span style={{ color: "#4ade80" }}>■</span> Buy at RD</span>
                <span><span style={{ color: "#60a5fa" }}>■</span> Buy at Sysco</span>
                <span><span style={{ color: "#333" }}>■</span> Same / No data</span>
              </div>
            )}

            <input value={homeSearch} onChange={e => setHomeSearch(e.target.value)} placeholder="🔍 Quick search..."
              style={{ width: "100%", background: "#13151d", border: "1px solid #1e2130", color: "#e8e4dc", padding: "9px 13px", fontFamily: "'DM Mono',monospace", fontSize: 13, borderRadius: 6, marginBottom: 10 }} />

            {/* Category pills */}
            <div style={{ display: "flex", gap: 6, flexWrap: "nowrap", overflowX: "auto", marginBottom: 14, paddingBottom: 4 }}>
              {CATS.map(c => (
                <button key={c} className="pill"
                  style={homeCat === c ? { borderColor: winColor, color: winColor } : {}}
                  onClick={() => setHomeCat(c)}>{c}</button>
              ))}
            </div>

            {/* RD mode: aisle-grouped list */}
            {storeMode === "rd" && aisleGroups && (
              <div>
                {Object.entries(aisleGroups).map(([aisleNum, items]) => (
                  items.length === 0 ? null : (
                    <div key={aisleNum}>
                      <div className="aisle-header">
                        <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 13, color: "#4ade80", letterSpacing: 2, whiteSpace: "nowrap" }}>
                          AISLE {aisleNum} · {AISLE_LABELS[aisleNum]}
                        </div>
                        <div className="aisle-line" />
                        <div style={{ fontSize: 10, color: "#555", whiteSpace: "nowrap" }}>{items.length} items</div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                        {items.map(item => <ItemCard key={item.id} item={item} />)}
                      </div>
                    </div>
                  )
                ))}
                {Object.values(aisleGroups).flat().length === 0 && (
                  <div style={{ color: "#444", fontSize: 13, padding: "40px 0", textAlign: "center" }}>No items cheaper at Restaurant Depot right now.</div>
                )}
              </div>
            )}

            {/* Sysco mode or All mode: grid */}
            {storeMode !== "rd" && (
              <div style={storeMode === "sysco" ? { display: "flex", flexDirection: "column", gap: 8 } : { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {(flatFiltered || []).map(item => <ItemCard key={item.id} item={item} />)}
                {(flatFiltered || []).length === 0 && (
                  <div style={{ color: "#444", fontSize: 13, padding: "40px 0", textAlign: "center", gridColumn: "1/-1" }}>
                    {storeMode === "sysco" ? "No items are cheaper at Sysco in this category." : "No items match."}
                  </div>
                )}
              </div>
            )}

            {/* Hidden items restore button — bottom of list */}
            {hiddenItems.size > 0 && (
              <div style={{ display: "flex", justifyContent: "center", marginTop: 24, paddingBottom: 4 }}>
                <button onClick={() => setShowHidden(true)}
                  style={{ background: "none", border: "1px solid #2a2d3a", color: "#555", padding: "9px 22px", cursor: "pointer", fontFamily: "'DM Mono',monospace", fontSize: 11, borderRadius: 8, letterSpacing: 1, display: "flex", alignItems: "center", gap: 8 }}>
                  🚫 {hiddenItems.size} hidden item{hiddenItems.size !== 1 ? "s" : ""} — tap to restore
                </button>
              </div>
            )}

            {/* Hidden items drawer */}
            {showHidden && hiddenItems.size > 0 && (
              <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                {/* Backdrop */}
                <div onClick={() => setShowHidden(false)}
                  style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)" }} />
                {/* Sheet */}
                <div style={{ position: "relative", background: "#13151d", borderRadius: "16px 16px 0 0", border: "1px solid #2a2d3a", borderBottom: "none", maxHeight: "75vh", display: "flex", flexDirection: "column" }}>
                  {/* Handle */}
                  <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}>
                    <div style={{ width: 36, height: 4, background: "#2a2d3a", borderRadius: 2 }} />
                  </div>
                  {/* Header */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 20px 14px" }}>
                    <div>
                      <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 20, letterSpacing: 2, color: "#e8e4dc" }}>HIDDEN ITEMS</div>
                      <div style={{ fontSize: 10, color: "#555" }}>Tap + SHOW to restore any item</div>
                    </div>
                    <button onClick={() => setShowHidden(false)}
                      style={{ background: "#1a1d27", border: "1px solid #2a2d3a", color: "#888", width: 32, height: 32, borderRadius: "50%", cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                  </div>
                  {/* List */}
                  <div style={{ overflowY: "auto", padding: "0 16px 80px", display: "flex", flexDirection: "column", gap: 8 }}>
                    {RD_DATA.filter(item => hiddenItems.has(item.id)).map(item => {
                      const rd = rdMap[item.id], sc = scMap[item.id];
                      const b = getBest(item.id);
                      const wc = b === "rd" ? "#4ade80" : b === "sysco" ? "#60a5fa" : "#555";
                      return (
                        <div key={item.id} style={{ background: "#0f1117", border: "1px solid #1e2130", borderRadius: 8, padding: "11px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, color: "#888" }}>{item.description}</div>
                            <div style={{ fontSize: 10, color: "#444", marginTop: 2 }}>{item.category} · {item.unit}</div>
                            {(rd || sc) && (
                              <div style={{ display: "flex", gap: 12, marginTop: 5 }}>
                                {rd && <span style={{ fontSize: 11, color: b === "rd" ? "#4ade80" : "#555" }}>RD ${rd.price.toFixed(2)}</span>}
                                {sc && <span style={{ fontSize: 11, color: b === "sysco" ? "#60a5fa" : "#555" }}>SC ${sc.price.toFixed(2)}</span>}
                              </div>
                            )}
                          </div>
                          <button onClick={() => { unhideItem(item.id); if (hiddenItems.size === 1) setShowHidden(false); }}
                            style={{ background: "#1a2e1a", border: "1px solid #4ade80", color: "#4ade80", padding: "6px 14px", cursor: "pointer", fontFamily: "'DM Mono',monospace", fontSize: 11, borderRadius: 5, letterSpacing: 1, whiteSpace: "nowrap" }}>
                            + SHOW
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ══ SCAN ══ */}
        {tab === "scan" && (
          <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 9, color: "#555", letterSpacing: 2, marginBottom: 8 }}>SCANNING PRICES FOR</div>
              <div style={{ display: "flex", gap: 8 }}>
                {[["rd","🟢 Restaurant Depot","#4ade80","#0d1f12"],["sysco","🔵 Sysco","#60a5fa","#0d1525"]].map(([src,lbl,color,bg]) => (
                  <button key={src} onClick={() => setScanSrc(src)} className="store-btn"
                    style={scanSrc === src ? { background: bg, border: `2px solid ${color}`, color } : { background: "none", border: "2px solid #1e2130", color: "#555" }}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
            {!files.length ? (
              <>
                <div className="zone" onClick={() => fileRef.current.click()}>
                  <div style={{ fontSize: 38, marginBottom: 10 }}>📸</div>
                  <div style={{ fontSize: 14, color: "#e8e4dc", marginBottom: 6 }}>Tap to take a photo or browse</div>
                  <div style={{ fontSize: 11, color: "#555", lineHeight: 1.8 }}>Shelf price tags · Receipts · Order guide screenshots<br />Multiple images at once</div>
                  <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={onFiles} />
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                  <button style={{ background: "#e85d2f", border: "none", color: "#fff", padding: "10px 18px", cursor: "pointer", fontFamily: "'DM Mono',monospace", fontSize: 12, borderRadius: 4, letterSpacing: 1 }} onClick={() => fileRef.current.click()}>📷 CAMERA</button>
                  <button style={{ background: "none", border: "1px solid #2a2d3a", color: "#aaa", padding: "10px 18px", cursor: "pointer", fontFamily: "'DM Mono',monospace", fontSize: 12, borderRadius: 4, letterSpacing: 1 }} onClick={() => fileRef.current.click()}>🖼 BROWSE</button>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                  {previews.map((src, i) => <img key={i} src={src} style={{ width: 76, height: 76, objectFit: "cover", borderRadius: 4, border: "1px solid #2a2d3a" }} alt="" />)}
                  <div className="zone" style={{ width: 76, height: 76, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }} onClick={() => fileRef.current.click()}>+
                    <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={onFiles} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button style={{ background: "#e85d2f", border: "none", color: "#fff", padding: "10px 20px", cursor: "pointer", fontFamily: "'DM Mono',monospace", fontSize: 12, borderRadius: 4, letterSpacing: 1 }} onClick={runScan} disabled={scanning}>{scanning ? "⏳  READING..." : "🔍  SCAN NOW"}</button>
                  <button style={{ background: "none", border: "1px solid #2a2d3a", color: "#aaa", padding: "10px 16px", cursor: "pointer", fontFamily: "'DM Mono',monospace", fontSize: 12, borderRadius: 4 }} onClick={() => { setFiles([]); setPreviews([]); setScanResults(null); }}>CLEAR</button>
                </div>
              </>
            )}
            {scanErr && <div style={{ marginTop: 12, color: "#f87171", fontSize: 13 }}>{scanErr}</div>}
            {scanResults && (
              <div style={{ marginTop: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: "#777" }}><span style={{ color: "#e8e4dc" }}>{scanResults.length}</span> found · <span style={{ color: "#4ade80" }}>{scanResults.filter(r => r.id).length} matched</span></div>
                  <button style={{ background: "#4ade80", border: "none", color: "#0a1a0a", padding: "8px 16px", cursor: "pointer", fontFamily: "'DM Mono',monospace", fontSize: 11, borderRadius: 4, fontWeight: 500 }} onClick={applyAllScan}>✓ SAVE ALL</button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {scanResults.map((r, i) => {
                    const m = RD_DATA.find(x => x.id === r.id);
                    return (
                      <div key={i} style={{ background: "#13151d", border: "1px solid #1e2130", borderRadius: 6, padding: "10px 12px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                          <div>
                            <div style={{ fontSize: 10, color: "#555", marginBottom: 2 }}>{r.raw}</div>
                            <div style={{ fontSize: 12, color: m ? "#4ade80" : "#f87171" }}>{m ? m.description : "No match"}</div>
                          </div>
                          <span className={`conf-${r.confidence}`} style={{ fontSize: 10 }}>{r.confidence}</span>
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <input className="sinp" value={r.price || ""} type="number" step="0.01"
                            onChange={e => setScanResults(prev => prev.map((x, j) => j === i ? { ...x, price: parseFloat(e.target.value) } : x))} />
                          {r.id && r.price > 0
                            ? <button style={{ background: "#4ade80", border: "none", color: "#0a1a0a", padding: "4px 10px", cursor: "pointer", fontFamily: "'DM Mono',monospace", fontSize: 10, borderRadius: 3, fontWeight: 500 }} onClick={() => { recordPrice(r.id, r.price, scanSrc); setScanResults(p => p.filter((_, j) => j !== i)); }}>SAVE</button>
                            : <span style={{ fontSize: 10, color: "#444" }}>SKIP</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ UPLOAD ══ */}
        {tab === "upload" && (
          <div style={{ maxWidth: 480, margin: "0 auto" }}>
            <div style={{ background: "#13151d", border: "1px solid #1e2130", borderRadius: 6, padding: 14, marginBottom: 14, fontSize: 12, color: "#555", lineHeight: 1.9 }}>
              Prices stay until you update them. Only upload when a price actually changes.
            </div>
            {[["rd","Restaurant Depot","#4ade80",null],["sysco","Sysco","#60a5fa","Portal → My Account → Order Guide → Export CSV"]].map(([src,label,color,hint]) => (
              <div key={src} style={{ background: "#13151d", border: "1px solid #1e2130", borderRadius: 6, padding: 16, marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />
                  <span style={{ fontSize: 11, letterSpacing: 2, color }}>{label.toUpperCase()}</span>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <label style={{ background: "#0c0e13", border: `1px solid ${color}`, color, padding: "8px 14px", cursor: "pointer", fontFamily: "'DM Mono',monospace", fontSize: 11, borderRadius: 4, letterSpacing: 1 }}>
                    📸 Photos / Screenshots
                    <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={e => { setScanSrc(src); onFiles(e); setTab("scan"); }} />
                  </label>
                  <label style={{ background: "none", border: "1px solid #2a2d3a", color: "#888", padding: "8px 14px", cursor: "pointer", fontFamily: "'DM Mono',monospace", fontSize: 11, borderRadius: 4, letterSpacing: 1 }}>
                    📄 CSV Export
                    <input type="file" accept=".csv,.txt" style={{ display: "none" }} onChange={e => handleCSV(e, src)} />
                  </label>
                </div>
                {hint && <div style={{ marginTop: 8, fontSize: 10, color: "#333" }}>{hint}</div>}
              </div>
            ))}
          </div>
        )}

        {/* ══ HISTORY ══ */}
        {tab === "history" && (
          <div style={{ maxWidth: 560, margin: "0 auto" }}>
            <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 9, color: "#555", letterSpacing: 2, marginBottom: 6 }}>ITEM</div>
                <select value={histItem?.id || ""} onChange={e => setHistItem(RD_DATA.find(x => x.id === e.target.value) || null)}
                  style={{ width: "100%", background: "#13151d", border: "1px solid #1e2130", color: "#e8e4dc", padding: "8px 10px", fontFamily: "'DM Mono',monospace", fontSize: 12, borderRadius: 4 }}>
                  <option value="">— select an item —</option>
                  {RD_DATA.filter(item => (history[item.id] || []).length > 0).map(item => (
                    <option key={item.id} value={item.id}>{item.description}</option>
                  ))}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 9, color: "#555", letterSpacing: 2, marginBottom: 6 }}>RANGE</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {["week","month","year"].map(r => (
                    <button key={r} className="pill" style={histRange === r ? { borderColor: "#e85d2f", color: "#e85d2f" } : {}} onClick={() => setHistRange(r)}>{r}</button>
                  ))}
                </div>
              </div>
            </div>
            {!histItem
              ? <div style={{ color: "#555", fontSize: 13 }}>Select an item above — or tap any card on the home screen.</div>
              : (() => {
                  const entries = histEntries(histItem.id);
                  const b = getBest(histItem.id);
                  const wc2 = b === "rd" ? "#4ade80" : b === "sysco" ? "#60a5fa" : "#888";
                  return (
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                        <div style={{ fontSize: 14, color: "#e8e4dc" }}>{histItem.description}</div>
                        {b && b !== "tie" && <div style={{ fontSize: 10, color: wc2, letterSpacing: 1 }}>BUY AT {b === "rd" ? "RD" : "SYSCO"}</div>}
                      </div>
                      <div style={{ fontSize: 10, color: "#444", marginBottom: 16 }}>{entries.length} records · {histRange}</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                        {[["RESTAURANT DEPOT","rd","#4ade80"],["SYSCO","sysco","#60a5fa"]].map(([lbl,src,c]) => {
                          const cur = src === "rd" ? rdMap[histItem.id] : scMap[histItem.id];
                          const ps = entries.filter(e => e.source === src).map(x => x.price);
                          return (
                            <div key={src} style={{ background: "#13151d", border: "1px solid #1e2130", borderRadius: 6, padding: 14 }}>
                              <div style={{ fontSize: 8, color: c, letterSpacing: 2, marginBottom: 8 }}>{lbl}</div>
                              {!cur ? <div style={{ color: "#333", fontSize: 12 }}>No data</div> : (
                                <>
                                  <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 32, color: c, lineHeight: 1 }}>${cur.price.toFixed(2)}</div>
                                  <div style={{ fontSize: 9, color: "#444", marginTop: 3 }}>updated {friendlyDate(cur.date)}</div>
                                  {ps.length > 1 && (
                                    <div style={{ display: "flex", gap: 12, marginTop: 8, borderTop: "1px solid #1e2130", paddingTop: 8 }}>
                                      {[["LOW",Math.min(...ps)],["HIGH",Math.max(...ps)]].map(([l,v]) => (
                                        <div key={l}>
                                          <div style={{ fontSize: 8, color: "#444", letterSpacing: 1 }}>{l}</div>
                                          <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 18, color: "#777" }}>${v.toFixed(2)}</div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {entries.length > 0 && (
                        <div style={{ background: "#13151d", border: "1px solid #1e2130", borderRadius: 6, padding: 14 }}>
                          <div style={{ fontSize: 9, color: "#555", letterSpacing: 2, marginBottom: 10 }}>TIMELINE</div>
                          {[...entries].sort((a, b2) => new Date(b2.date) - new Date(a.date)).map((e, i) => (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", borderBottom: "1px solid #1a1d27" }}>
                              <div style={{ width: 6, height: 6, borderRadius: "50%", background: e.source === "rd" ? "#4ade80" : "#60a5fa", flexShrink: 0 }} />
                              <div style={{ fontSize: 10, color: "#444", flex: 1 }}>{new Date(e.date).toLocaleDateString()} {new Date(e.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                              <div style={{ fontSize: 9, color: e.source === "rd" ? "#4ade80" : "#60a5fa", width: 44 }}>{e.source === "rd" ? "RD" : "SYSCO"}</div>
                              <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 20, color: "#e8e4dc" }}>${e.price.toFixed(2)}</div>
                            </div>
                          ))}
                          <div style={{ marginTop: 10, display: "flex", gap: 14, fontSize: 9, color: "#444" }}>
                            <span><span style={{ color: "#4ade80" }}>●</span> Restaurant Depot</span>
                            <span><span style={{ color: "#60a5fa" }}>●</span> Sysco</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
          </div>
        )}

      </div>

      {/* BOTTOM NAV */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#0c0e13", borderTop: "1px solid #1a1d27", display: "flex", zIndex: 20 }}>
        {NAV.map(n => (
          <button key={n.id} className={`nav-btn ${tab === n.id ? "on" : ""}`} onClick={() => setTab(n.id)}>
            <span style={{ fontSize: 18 }}>{n.icon}</span>{n.label}
          </button>
        ))}
      </div>
    </div>
  );
}
