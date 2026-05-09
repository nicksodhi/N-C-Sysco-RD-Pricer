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
          {[["prices", "Prices"], ["order", "Order Help"]].map(([id, lbl]) => (
            <button key={id} onClick={() => setView(id)} style={{ flex: 1, padding: "10px 0", border: "none", background: "none", fontSize: 13, fontWeight: 600, color: view === id ? "#111" : "#999", borderBottom: view === id ? "2px solid #111" : "2px solid transparent", cursor: "pointer", transition: "all .15s", letterSpacing: -0.1 }}>
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

      {/* ORDER VIEW */}
      {view === "order" && <OrderView rd={rd} sc={sc} />}

      {/* BOTTOM NAV */}
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, background: "#fff", borderTop: "1px solid #EEEEE9", display: "grid", gridTemplateColumns: "1fr 1fr", zIndex: 100 }}>
        {[["prices", "📊", "Prices"], ["order", "🛒", "Order"]].map(([id, icon, lbl]) => (
          <button key={id} onClick={() => setView(id)} style={{ padding: "12px 8px 16px", border: "none", background: "none", color: view === id ? "#111" : "#AAA", cursor: "pointer", transition: "color .15s" }}>
            <div style={{ fontSize: 18, marginBottom: 2 }}>{icon}</div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: .3 }}>{lbl}</div>
          </button>
        ))}
      </div>
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
        placeholder={"Type your order...\n\nExamples:\n5 cases chicken leg quarters\nyellow onions\nheavy cream\nrusset potatoes"}
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
