import { useState, useMemo, useEffect } from "react";

const ITEMS = [
  { id:"42545",   name:"Yellow Onions",        emoji:"🧅", cat:"Produce"  },
  { id:"42658",   name:"Red Onions",           emoji:"🧅", cat:"Produce"  },
  { id:"42725",   name:"Russet Potato",        emoji:"🥔", cat:"Produce"  },
  { id:"44146",   name:"Peeled Garlic",        emoji:"🧄", cat:"Produce"  },
  { id:"42513",   name:"Fresh Ginger",         emoji:"🫚", cat:"Produce"  },
  { id:"42566",   name:"Cilantro",             emoji:"🌿", cat:"Produce"  },
  { id:"44137",   name:"Serrano Peppers",      emoji:"🌶️", cat:"Produce"  },
  { id:"42504",   name:"Cucumbers",            emoji:"🥒", cat:"Produce"  },
  { id:"42570",   name:"Lemons",               emoji:"🍋", cat:"Produce"  },
  { id:"79152",   name:"Carrots",              emoji:"🥕", cat:"Produce"  },
  { id:"44211",   name:"Cleaned Spinach",      emoji:"🥬", cat:"Produce"  },
  { id:"1530438", name:"Heavy Cream",          emoji:"🥛", cat:"Dairy"    },
  { id:"370496",  name:"Whole Milk",           emoji:"🥛", cat:"Dairy"    },
  { id:"14785",   name:"Plain Yogurt",         emoji:"🫙", cat:"Dairy"    },
  { id:"1440528", name:"Paneer",               emoji:"🧀", cat:"Dairy"    },
  { id:"1440203", name:"Cheddar Jack Cheese",  emoji:"🧀", cat:"Dairy"    },
  { id:"77200",   name:"Chicken Wings",        emoji:"🍗", cat:"Meat"     },
  { id:"77670",   name:"Chicken Leg Quarters", emoji:"🍗", cat:"Meat"     },
  { id:"77658",   name:"Chicken Leg Meat",     emoji:"🍗", cat:"Meat"     },
  { id:"77682",   name:"Chicken Thighs",       emoji:"🍗", cat:"Meat"     },
  { id:"1810019", name:"Goat Bone-in",         emoji:"🥩", cat:"Meat"     },
  { id:"79042",   name:"Lamb Leg Halal",       emoji:"🥩", cat:"Meat"     },
  { id:"51457",   name:"Tilapia Fillets",      emoji:"🐟", cat:"Frozen"   },
  { id:"64046",   name:"Chopped Spinach",      emoji:"🥬", cat:"Frozen"   },
  { id:"64120",   name:"Broccoli Florets",     emoji:"🥦", cat:"Frozen"   },
  { id:"86527",   name:"Mixed Vegetables",     emoji:"🥦", cat:"Frozen"   },
  { id:"86525",   name:"Green Peas",           emoji:"🟢", cat:"Frozen"   },
  { id:"490266",  name:"Basmati Rice",         emoji:"🍚", cat:"Dry"      },
  { id:"53556",   name:"Atta Flour",           emoji:"🌾", cat:"Dry"      },
  { id:"2061212", name:"All Purpose Flour",    emoji:"🌾", cat:"Dry"      },
  { id:"21051",   name:"Sugar",                emoji:"🍬", cat:"Dry"      },
  { id:"1070496", name:"Salt",                 emoji:"🧂", cat:"Dry"      },
  { id:"29268",   name:"Baking Powder",        emoji:"🫙", cat:"Dry"      },
  { id:"2910159", name:"Cornstarch",           emoji:"🫙", cat:"Dry"      },
  { id:"16200",   name:"Garbanzo Beans",       emoji:"🫘", cat:"Dry"      },
  { id:"69810",   name:"Red Kidney Beans",     emoji:"🫘", cat:"Dry"      },
  { id:"860044",  name:"Tomato Sauce",         emoji:"🍅", cat:"Dry"      },
  { id:"860135",  name:"Diced Tomatoes",       emoji:"🍅", cat:"Dry"      },
  { id:"2620442", name:"Coconut Milk",         emoji:"🥥", cat:"Dry"      },
  { id:"13417",   name:"Sambal Oelek",         emoji:"🌶️", cat:"Dry"      },
  { id:"25267",   name:"Eggplant Pulp",        emoji:"🍆", cat:"Dry"      },
  { id:"1020152", name:"Liquid Butter Alt",    emoji:"🧈", cat:"Oils"     },
  { id:"55523",   name:"Lemon Juice",          emoji:"🍋", cat:"Oils"     },
  { id:"1020079", name:"Canola Oil",           emoji:"🫙", cat:"Oils"     },
  { id:"1020075", name:"Soybean Oil",          emoji:"🫙", cat:"Oils"     },
  { id:"1020077", name:"Fry Oil",              emoji:"🫙", cat:"Oils"     },
  { id:"45900",   name:"White Vinegar",        emoji:"🫙", cat:"Oils"     },
  { id:"2550014", name:"Red Food Color",       emoji:"🔴", cat:"Oils"     },
  { id:"12728",   name:"Pan Spray",            emoji:"🥫", cat:"Other"    },
  { id:"21039",   name:"Evian Water",          emoji:"💧", cat:"Other"    },
  { id:"440039",  name:"Diet Coke",            emoji:"🥤", cat:"Other"    },
  { id:"440040",  name:"Sprite",               emoji:"🥤", cat:"Other"    },
];

const CATS = ["All","Produce","Dairy","Meat","Frozen","Dry","Oils","Other"];
// No seed data — only show live scraped prices
const fmt = n => n!=null ? "$"+n.toFixed(2) : "—";
const ago = d => { if(!d) return ""; const h=(Date.now()-new Date(d))/3.6e6; if(h<1) return "just now"; if(h<24) return Math.floor(h)+"h ago"; return Math.floor(h/24)+"d ago"; };

export default function App() {
  const [rd, setRd] = useState({});
  const [sc, setSc] = useState({});
  const [view, setView] = useState("prices");
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [synced, setSynced] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    pull().finally(() => setLoading(false));
    const t = setInterval(pull, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  async function pull() {
    try {
      const r = await fetch("/api/prices"); if (!r.ok) return;
      const d = await r.json();
      if (d.rd && Object.keys(d.rd).length) setRd(p => ({ ...p, ...d.rd }));
      if (d.sysco && Object.keys(d.sysco).length) setSc(p => ({ ...p, ...d.sysco }));
      setSynced(new Date().toISOString());
    } catch {}
  }

  async function sync() {
    setSyncing(true);
    try { await fetch("/api/trigger"); } catch {}
    setTimeout(async () => { await pull(); setSyncing(false); }, 90000);
  }

  const filtered = useMemo(() =>
    ITEMS.filter(i =>
      (cat === "All" || i.cat === cat) &&
      (!q || i.name.toLowerCase().includes(q.toLowerCase()))
    ), [cat, q]);

  const both   = filtered.filter(i => rd[i.id] && sc[i.id]);
  const rdOnly = filtered.filter(i => rd[i.id] && !sc[i.id]);
  const noPrice = filtered.filter(i => !rd[i.id] && !sc[i.id]);

  return (
    <div style={{ background: "#F7F7F5", minHeight: "100vh", maxWidth: 430, margin: "0 auto", fontFamily: "'Inter', system-ui, sans-serif", paddingBottom: 80 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { display: none; }
        input, button, textarea { font-family: inherit; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        .fi { animation: fadeIn .2s ease both; }
      `}</style>

      {/* HEADER */}
      <div style={{ background: "#fff", borderBottom: "1px solid #EEEEE9", padding: "16px 16px 0", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#111", letterSpacing: -0.3 }}>🍛 Naan & Curry</div>
            <div style={{ fontSize: 11, color: "#999", marginTop: 1 }}>Price tracker · Las Vegas</div>
          </div>
          <button onClick={sync} style={{ background: "none", border: "1px solid #E0E0DB", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, color: synced ? "#22C55E" : "#999", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ display: "inline-block", animation: syncing ? "spin .7s linear infinite" : "none" }}>↻</span>
            {syncing ? "Syncing…" : synced ? ago(synced) : "Sync"}
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, marginBottom: 0 }}>
          {[["prices", "Prices"], ["compare", "Compare"], ["order", "Order Help"]].map(([id, lbl]) => (
            <button key={id} onClick={() => setView(id)} style={{ flex: 1, padding: "10px 0", border: "none", background: "none", fontSize: 12, fontWeight: 600, color: view === id ? "#111" : "#999", borderBottom: view === id ? "2px solid #111" : "2px solid transparent", cursor: "pointer", transition: "all .15s", letterSpacing: -0.1 }}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* PRICES VIEW */}
      {view === "prices" && (
        <div>
          {/* Search + categories */}
          <div style={{ background: "#fff", padding: "12px 16px", borderBottom: "1px solid #EEEEE9" }}>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…"
              style={{ width: "100%", background: "#F7F7F5", border: "none", borderRadius: 8, padding: "9px 14px", fontSize: 14, color: "#111", outline: "none", marginBottom: 10 }} />
            <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
              {CATS.map(c => (
                <button key={c} onClick={() => setCat(c)} style={{ flexShrink: 0, padding: "5px 14px", borderRadius: 99, border: "none", background: cat === c ? "#111" : "#F0F0EC", color: cat === c ? "#fff" : "#555", fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all .15s", whiteSpace: "nowrap" }}>
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div style={{ padding: "16px 12px 0" }}>

            {loading && (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "#999" }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Loading prices…</div>
              </div>
            )}

            {/* Compared items */}
            {!loading && both.length > 0 && (
              <>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#999", letterSpacing: .5, marginBottom: 8, paddingLeft: 4 }}>
                  COMPARING BOTH VENDORS
                </div>
                {both.map((item, i) => {
                  const r = rd[item.id].price, s = sc[item.id].price;
                  const rdBest = r <= s;
                  return (
                    <div key={item.id} className="fi" style={{ background: "#fff", borderRadius: 12, marginBottom: 6, overflow: "hidden", border: "1px solid #EEEEE9", animationDelay: i * 15 + "ms" }}>
                      {/* Top: item name */}
                      <div style={{ padding: "12px 14px 10px", display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 20 }}>{item.emoji}</span>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>{item.name}</div>
                        {/* Best vendor badge */}
                        <div style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 99, background: rdBest ? "#F0FDF4" : "#EFF6FF", color: rdBest ? "#16A34A" : "#2563EB" }}>
                          {rdBest ? "Buy at RD" : "Buy at Sysco"}
                        </div>
                      </div>
                      {/* Bottom: two prices */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderTop: "1px solid #F3F3EF" }}>
                        <div style={{ padding: "10px 14px", borderRight: "1px solid #F3F3EF", background: rdBest ? "#F7FEF9" : "transparent" }}>
                          <div style={{ fontSize: 10, fontWeight: 600, color: rdBest ? "#16A34A" : "#AAA", letterSpacing: .3, marginBottom: 3 }}>
                            {rdBest ? "✓ " : ""}Restaurant Depot
                          </div>
                          <div style={{ fontSize: 17, fontWeight: 700, color: rdBest ? "#16A34A" : "#555" }}>{fmt(r)}</div>
                        </div>
                        <div style={{ padding: "10px 14px", background: !rdBest ? "#F0F6FF" : "transparent" }}>
                          <div style={{ fontSize: 10, fontWeight: 600, color: !rdBest ? "#2563EB" : "#AAA", letterSpacing: .3, marginBottom: 3 }}>
                            {!rdBest ? "✓ " : ""}Sysco
                          </div>
                          <div style={{ fontSize: 17, fontWeight: 700, color: !rdBest ? "#2563EB" : "#555" }}>{fmt(s)}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {/* RD only */}
            {!loading && rdOnly.length > 0 && (
              <>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#999", letterSpacing: .5, margin: "16px 0 8px", paddingLeft: 4 }}>
                  RESTAURANT DEPOT ONLY
                </div>
                {rdOnly.map((item, i) => (
                  <div key={item.id} className="fi" style={{ background: "#fff", borderRadius: 12, marginBottom: 6, border: "1px solid #EEEEE9", display: "flex", alignItems: "center", padding: "12px 14px", gap: 10, animationDelay: i * 10 + "ms" }}>
                    <span style={{ fontSize: 20 }}>{item.emoji}</span>
                    <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "#111" }}>{item.name}</div>
                    <div style={{ fontSize: 17, fontWeight: 700, color: "#111" }}>{fmt(rd[item.id]?.price)}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#999", background: "#F0F0EC", borderRadius: 99, padding: "3px 10px" }}>RD</div>
                  </div>
                ))}
              </>
            )}

            {/* Items with no current pricing */}
            {!loading && noPrice.length > 0 && (
              <>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#C0BAB0", letterSpacing: .5, margin: "16px 0 8px", paddingLeft: 4, display: "flex", alignItems: "center", gap: 6 }}>
                  <span>⚠️</span> NO CURRENT PRICING
                </div>
                {noPrice.map((item, i) => (
                  <div key={item.id} style={{ background: "#fff", borderRadius: 12, marginBottom: 6, border: "1px dashed #E0E0D8", display: "flex", alignItems: "center", padding: "12px 14px", gap: 10, opacity: 0.6 }}>
                    <span style={{ fontSize: 20 }}>{item.emoji}</span>
                    <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "#888" }}>{item.name}</div>
                    <div style={{ fontSize: 11, color: "#BBB", fontWeight: 500 }}>Not scraped yet</div>
                  </div>
                ))}
              </>
            )}

            {!loading && both.length === 0 && rdOnly.length === 0 && noPrice.length === 0 && (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "#999" }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>🔍</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#555" }}>Nothing found</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* COMPARE VIEW */}
      {view === "compare" && <CompareView rd={rd} sc={sc} />}

      {/* ORDER VIEW */}
      {view === "order" && <OrderView rd={rd} sc={sc} />}

      {/* BOTTOM NAV */}
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, background: "#fff", borderTop: "1px solid #EEEEE9", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", zIndex: 100 }}>
        {[["prices", "📊", "Prices"], ["compare", "⚖️", "Compare"], ["order", "🛒", "Order"]].map(([id, icon, lbl]) => (
          <button key={id} onClick={() => setView(id)} style={{ padding: "12px 8px 16px", border: "none", background: "none", color: view === id ? "#111" : "#AAA", cursor: "pointer", transition: "color .15s" }}>
            <div style={{ fontSize: 18, marginBottom: 2 }}>{icon}</div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: .3 }}>{lbl}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function CompareView({ rd, sc }) {
  const [list, setList] = useState("");
  const [result, setResult] = useState(null);

  function analyze() {
    if (!list.trim()) return;

    // Parse the list into item names
    const lines = list.split("\n").map(l => l.trim()).filter(l => l.length > 2);

    // Match each line to our known items (fuzzy match on name)
    const matched = [];
    const unmatched = [];

    lines.forEach(line => {
      // Strip leading numbers/bullets/dashes
      const clean = line.replace(/^[\d\-•*\.x]+\s*/i, "").toLowerCase().trim();
      if (!clean) return;

      // Find best matching item
      let best = null, bestScore = 0;
      ITEMS.forEach(item => {
        const itemWords = item.name.toLowerCase().split(" ");
        const lineWords = clean.split(" ");
        let score = 0;
        itemWords.forEach(w => { if (w.length > 2 && clean.includes(w)) score += w.length; });
        lineWords.forEach(w => { if (w.length > 2 && item.name.toLowerCase().includes(w)) score += w.length; });
        if (score > bestScore) { bestScore = score; best = item; }
      });

      if (best && bestScore >= 4) {
        matched.push({ line, item: best });
      } else {
        unmatched.push(line);
      }
    });

    // Calculate totals
    let rdTotal = 0, scTotal = 0;
    const rdRows = [], scRows = [], rdOnlyRows = [], scOnlyRows = [], neitherRows = [];

    matched.forEach(({ line, item }) => {
      const rdP = rd[item.id]?.price;
      const scP = sc[item.id]?.price;

      if (rdP) rdTotal += rdP;
      if (scP) scTotal += scP;

      if (rdP && scP) {
        rdRows.push({ name: item.name, emoji: item.emoji, price: rdP });
        scRows.push({ name: item.name, emoji: item.emoji, price: scP });
      } else if (rdP) {
        rdTotal += 0; // already added
        rdOnlyRows.push({ name: item.name, emoji: item.emoji, price: rdP });
        scTotal += rdP; // hypothetical: assume same price if buying from RD
      } else if (scP) {
        scOnlyRows.push({ name: item.name, emoji: item.emoji, price: scP });
        rdTotal += scP; // hypothetical
      } else {
        neitherRows.push({ name: item.name, emoji: item.emoji });
      }
    });

    // Recalculate properly - pure totals for each vendor
    let purRD = 0, purSC = 0;
    const rdItems = [], scItems = [], noDataItems = [];

    matched.forEach(({ line, item }) => {
      const rdP = rd[item.id]?.price;
      const scP = sc[item.id]?.price;
      if (rdP) { purRD += rdP; rdItems.push({ ...item, price: rdP }); }
      else rdItems.push({ ...item, price: null });
      if (scP) { purSC += scP; scItems.push({ ...item, price: scP }); }
      else scItems.push({ ...item, price: null });
      if (!rdP && !scP) noDataItems.push(item);
    });

    setResult({ rdItems, scItems, purRD, purSC, unmatched, noDataItems });
  }

  const fmt2 = n => n != null ? "$" + n.toFixed(2) : "—";

  return (
    <div style={{ padding: "16px 12px 0" }}>
      {/* Explainer */}
      <div style={{ background: "#fff", borderRadius: 12, padding: "14px", border: "1px solid #EEEEE9", marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#111", marginBottom: 4 }}>⚖️ Vendor Cost Comparison</div>
        <div style={{ fontSize: 13, color: "#777", lineHeight: 1.6 }}>
          Paste your order list. We'll calculate the <strong>total cost</strong> if you bought everything from Restaurant Depot vs everything from Sysco — so you can see which vendor wins for your full order.
        </div>
      </div>

      <textarea value={list} onChange={e => setList(e.target.value)}
        placeholder="Paste your order list: Chicken leg quarters, Yellow onions, Heavy cream, Russet potato, Liquid butter, Sugar..."
        style={{ width: "100%", minHeight: 160, background: "#fff", border: "1px solid #EEEEE9", borderRadius: 12, padding: "12px 14px", color: "#111", fontSize: 14, lineHeight: 1.7, resize: "none", outline: "none" }} />

      <button onClick={analyze} disabled={!list.trim()} style={{ width: "100%", marginTop: 8, padding: "14px", border: "none", borderRadius: 12, background: !list.trim() ? "#F0F0EC" : "#111", color: !list.trim() ? "#AAA" : "#fff", fontSize: 14, fontWeight: 600, cursor: !list.trim() ? "default" : "pointer", transition: "all .2s" }}>
        Compare Vendor Totals →
      </button>

      {result && (
        <div style={{ marginTop: 14 }}>
          {/* BIG TOTALS */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            <div style={{ background: result.purRD <= result.purSC ? "#F0FDF4" : "#fff", border: result.purRD <= result.purSC ? "2px solid #16A34A" : "1px solid #EEEEE9", borderRadius: 14, padding: "16px 12px", textAlign: "center" }}>
              {result.purRD <= result.purSC && <div style={{ fontSize: 10, fontWeight: 700, color: "#16A34A", letterSpacing: .5, marginBottom: 4 }}>✓ CHEAPER</div>}
              <div style={{ fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 6 }}>🏪 Restaurant Depot</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: result.purRD <= result.purSC ? "#16A34A" : "#111", lineHeight: 1 }}>{fmt2(result.purRD)}</div>
              <div style={{ fontSize: 10, color: "#999", marginTop: 4 }}>all items total</div>
            </div>
            <div style={{ background: result.purSC < result.purRD ? "#EFF6FF" : "#fff", border: result.purSC < result.purRD ? "2px solid #2563EB" : "1px solid #EEEEE9", borderRadius: 14, padding: "16px 12px", textAlign: "center" }}>
              {result.purSC < result.purRD && <div style={{ fontSize: 10, fontWeight: 700, color: "#2563EB", letterSpacing: .5, marginBottom: 4 }}>✓ CHEAPER</div>}
              <div style={{ fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 6 }}>🚚 Sysco</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: result.purSC < result.purRD ? "#2563EB" : "#111", lineHeight: 1 }}>{fmt2(result.purSC)}</div>
              <div style={{ fontSize: 10, color: "#999", marginTop: 4 }}>all items total</div>
            </div>
          </div>

          {/* Savings callout */}
          {result.purRD > 0 && result.purSC > 0 && (
            <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 12, padding: "12px 14px", marginBottom: 14, textAlign: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#92400E" }}>
                {result.purRD <= result.purSC
                  ? `Buy from Restaurant Depot and save $${(result.purSC - result.purRD).toFixed(2)}`
                  : `Buy from Sysco and save $${(result.purRD - result.purSC).toFixed(2)}`
                }
              </div>
            </div>
          )}

          {/* RD itemized */}
          <div style={{ fontSize: 11, fontWeight: 600, color: "#999", letterSpacing: .5, marginBottom: 8, paddingLeft: 4 }}>🏪 RESTAURANT DEPOT — ITEM PRICES</div>
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #EEEEE9", overflow: "hidden", marginBottom: 14 }}>
            {result.rdItems.map((item, i) => (
              <div key={item.id} style={{ display: "flex", alignItems: "center", padding: "10px 14px", borderBottom: i < result.rdItems.length - 1 ? "1px solid #F3F3EF" : "none", gap: 10 }}>
                <span style={{ fontSize: 16 }}>{item.emoji}</span>
                <div style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "#111" }}>{item.name}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: item.price ? "#111" : "#CCC" }}>{fmt2(item.price)}</div>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 14px", background: "#F7FEF9", borderTop: "2px solid #D1FAE5" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#16A34A" }}>RD Total</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#16A34A" }}>{fmt2(result.purRD)}</div>
            </div>
          </div>

          {/* Sysco itemized */}
          <div style={{ fontSize: 11, fontWeight: 600, color: "#999", letterSpacing: .5, marginBottom: 8, paddingLeft: 4 }}>🚚 SYSCO — ITEM PRICES</div>
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #EEEEE9", overflow: "hidden", marginBottom: 14 }}>
            {result.scItems.map((item, i) => (
              <div key={item.id} style={{ display: "flex", alignItems: "center", padding: "10px 14px", borderBottom: i < result.scItems.length - 1 ? "1px solid #F3F3EF" : "none", gap: 10 }}>
                <span style={{ fontSize: 16 }}>{item.emoji}</span>
                <div style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "#111" }}>{item.name}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: item.price ? "#111" : "#CCC" }}>{fmt2(item.price)}</div>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 14px", background: "#EFF6FF", borderTop: "2px solid #BFDBFE" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#2563EB" }}>Sysco Total</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#2563EB" }}>{fmt2(result.purSC)}</div>
            </div>
          </div>

          {/* Unmatched */}
          {result.unmatched.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#C0BAB0", letterSpacing: .5, marginBottom: 8, paddingLeft: 4 }}>⚠️ NOT RECOGNIZED</div>
              <div style={{ background: "#fff", borderRadius: 12, border: "1px dashed #E0E0D8", marginBottom: 14 }}>
                {result.unmatched.map((line, i) => (
                  <div key={i} style={{ padding: "10px 14px", fontSize: 13, color: "#888", borderBottom: i < result.unmatched.length - 1 ? "1px solid #F3F3EF" : "none" }}>
                    {line}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}


function OrderView({ rd, sc }) {
  const [list, setList] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);

  async function go() {
    if (!list.trim()) return;
    setLoading(true); setResult("");
    try {
      const r = await fetch("/api/grocery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ list }) });
      const d = await r.json();
      setResult(d.result || "Something went wrong");
    } catch (e) { setResult("Error: " + e.message); }
    setLoading(false);
  }

  const top = ITEMS.filter(i => rd[i.id] && sc[i.id]).sort((a, b) =>
    Math.abs(rd[b.id].price - sc[b.id].price) - Math.abs(rd[a.id].price - sc[a.id].price)
  ).slice(0, 8);

  return (
    <div style={{ padding: "16px 12px 0" }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: "14px", border: "1px solid #EEEEE9", marginBottom: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#111", marginBottom: 4 }}>Order Breakdown</div>
        <div style={{ fontSize: 13, color: "#777", lineHeight: 1.6 }}>Paste your shopping list and we'll tell you exactly which vendor to use for each item.</div>
      </div>

      <textarea value={list} onChange={e => setList(e.target.value)}
        placeholder="Type your order... e.g. chicken leg quarters, yellow onions, heavy cream"
        style={{ width: "100%", minHeight: 140, background: "#fff", border: "1px solid #EEEEE9", borderRadius: 12, padding: "12px 14px", color: "#111", fontSize: 14, lineHeight: 1.7, resize: "none", outline: "none" }} />

      <button onClick={go} disabled={loading || !list.trim()} style={{ width: "100%", marginTop: 8, padding: "14px", border: "none", borderRadius: 12, background: loading || !list.trim() ? "#F0F0EC" : "#111", color: loading || !list.trim() ? "#AAA" : "#fff", fontSize: 14, fontWeight: 600, cursor: loading || !list.trim() ? "default" : "pointer", transition: "all .2s" }}>
        {loading ? "Analyzing…" : "Get Breakdown →"}
      </button>

      {result && (
        <div style={{ marginTop: 10, background: "#fff", border: "1px solid #EEEEE9", borderRadius: 12, padding: "14px" }}>
          <div style={{ fontSize: 13, lineHeight: 1.9, whiteSpace: "pre-wrap", color: "#111" }}>{result}</div>
        </div>
      )}

      {top.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#999", letterSpacing: .5, margin: "20px 0 8px", paddingLeft: 4 }}>QUICK REFERENCE</div>
          {top.map(item => {
            const r = rd[item.id].price, s = sc[item.id].price, rdBest = r <= s;
            return (
              <div key={item.id} style={{ background: "#fff", borderRadius: 12, padding: "11px 14px", marginBottom: 6, display: "flex", alignItems: "center", gap: 10, border: "1px solid #EEEEE9" }}>
                <span style={{ fontSize: 18 }}>{item.emoji}</span>
                <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#111" }}>{item.name}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: rdBest ? "#16A34A" : "#2563EB" }}>{fmt(Math.min(r, s))}</div>
                <div style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 99, background: rdBest ? "#F0FDF4" : "#EFF6FF", color: rdBest ? "#16A34A" : "#2563EB" }}>{rdBest ? "RD" : "Sysco"}</div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
