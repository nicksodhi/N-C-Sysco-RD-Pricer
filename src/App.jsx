import { useState, useMemo, useEffect } from "react";

// Items where case VOLUMES genuinely differ between vendors — price not directly comparable
const DIFFERENT_CASE_SIZES = new Set([
  "55523",   // Lemon Juice: RD 4gal vs Sysco 3gal
  "12728",   // Pan Spray: RD 102oz vs Sysco 84oz
  "44146",   // Peeled Garlic: RD 30lb vs Sysco 20lb
  "86525",   // Peas: RD 2.5lb vs Sysco 30lb
  "2620442", // Coconut Milk: RD 4800ml vs Sysco 9720ml
  "64120",   // Broccoli: RD 2lb vs Sysco 24lb
  "86527",   // Mixed Veg: RD 25lb vs Sysco 30lb
  "1440528", // Paneer: RD 20lb vs Sysco 10lb
  "2910159", // Cornstarch: RD 3lb vs Sysco 24lb
  "44211",   // Fresh Spinach: RD 10lb vs Sysco 4lb
  "40138",   // Green Onions: RD 16lb (4 bunches) vs Sysco 2lb pack
  "42706",   // Green Bell Pepper: RD 5lb bag vs Sysco 22-25lb case
]);

const ITEMS = [
  // ── Produce ──────────────────────────────────────────────────────────────────
  { id:"42545",   name:"Yellow Onions",       cat:"Produce"  },
  { id:"42658",   name:"Red Onions",           cat:"Produce"  },
  { id:"42725",   name:"Russet Potato",        cat:"Produce"  },
  { id:"44146",   name:"Peeled Garlic",        cat:"Produce"  },
  { id:"42513",   name:"Ginger",               cat:"Produce"  },
  { id:"1440528", name:"Paneer",               cat:"Dairy"    },
  { id:"55519",   name:"Flowers",              cat:"Produce"  },
  { id:"42606",   name:"Cauliflower",          cat:"Produce"  },
  { id:"40138",   name:"Green Onions",          cat:"Produce"  },
  { id:"79152",   name:"Carrots",              cat:"Produce"  },
  { id:"44211",   name:"Fresh Spinach",        cat:"Produce"  },
  { id:"42706",   name:"Green Bell Pepper",     cat:"Produce"  },
  { id:"42570",   name:"Lemons",               cat:"Produce"  },
  { id:"42647",   name:"Mint",                 cat:"Produce"  },
  { id:"42566",   name:"Cilantro",             cat:"Produce"  },
  { id:"44137",   name:"Green Chilies",        cat:"Produce"  },
  { id:"42504",   name:"Cucumbers",            cat:"Produce"  },
  // ── Dairy ────────────────────────────────────────────────────────────────────
  { id:"1530438", name:"Heavy Cream",          cat:"Dairy"    },
  { id:"370496",  name:"Whole Milk",           cat:"Dairy"    },
  // ── Meat ─────────────────────────────────────────────────────────────────────
  { id:"77232",   name:"Chicken Breast",       cat:"Meat"     },
  { id:"77670",   name:"Chicken Leg Quarters", cat:"Meat"     },
  { id:"77200",   name:"Chicken Wings",        cat:"Meat"     },
  { id:"77658",   name:"Chicken Leg Meat",     cat:"Meat"     },
  { id:"79042",   name:"Lamb Leg Boneless",    cat:"Meat"     },
  { id:"1810019", name:"Goat Cubes",           cat:"Meat"     },
  { id:"1440203", name:"Cheese Blend",         cat:"Dairy"    },
  { id:"14785",   name:"Plain Yogurt",         cat:"Dairy"    },
  // ── Seafood ──────────────────────────────────────────────────────────────────
  { id:"40212",   name:"Shrimp 16-20",         cat:"Seafood"  },
  { id:"51457",   name:"Fish (Tilapia)",        cat:"Seafood"  },
  // ── Frozen ───────────────────────────────────────────────────────────────────
  { id:"64046",   name:"Frozen Spinach",       cat:"Frozen"   },
  { id:"86525",   name:"Frozen Peas",          cat:"Frozen"   },
  { id:"64120",   name:"Frozen Broccoli",      cat:"Frozen"   },
  { id:"86527",   name:"Frozen 4-Way Mix",     cat:"Frozen"   },
  { id:"25267",   name:"Eggplant Pulp",        cat:"Dry"      },
  // ── Oils & Vinegar ───────────────────────────────────────────────────────────
  { id:"45900",   name:"White Vinegar",        cat:"Oils"     },
  { id:"1020152", name:"Liquid Butter",        cat:"Oils"     },
  { id:"12728",   name:"Pan Spray",            cat:"Oils"     },
  { id:"1020079", name:"Canola Salad Oil",     cat:"Oils"     },
  { id:"1020075", name:"Soybean Oil",          cat:"Oils"     },
  { id:"1020077", name:"Fryer Oil",            cat:"Oils"     },
  { id:"55523",   name:"Lemon Juice",          cat:"Oils"     },
  // ── Dry Goods ────────────────────────────────────────────────────────────────
  { id:"53556",   name:"Roti Atta",            cat:"Dry"      },
  { id:"13417",   name:"Sambal Chili",         cat:"Dry"      },
  { id:"2620442", name:"Coconut Milk",         cat:"Dry"      },
  { id:"2061212", name:"All Purpose Flour",    cat:"Dry"      },
  { id:"29268",   name:"Baking Powder",        cat:"Dry"      },
  { id:"2910159", name:"Cornstarch",           cat:"Dry"      },
  { id:"490266",  name:"Rice – Royal",         cat:"Dry"      },
  { id:"2550014", name:"Red Food Color",       cat:"Dry"      },
  { id:"2550012", name:"Egg Yellow Color",     cat:"Dry"      },
  { id:"16200",   name:"Garbanzo Beans",       cat:"Dry"      },
  { id:"69810",   name:"Red Kidney Beans",     cat:"Dry"      },
  { id:"1070496", name:"Salt",                 cat:"Dry"      },
  { id:"21051",   name:"Sugar",                cat:"Dry"      },
  { id:"2010066", name:"Ketchup",              cat:"Dry"      },
  { id:"860043",  name:"Tomato Puree",         cat:"Dry"      },
  { id:"860044",  name:"Tomato Sauce",         cat:"Dry"      },
  { id:"860135",  name:"Petite Diced Tomato",  cat:"Dry"      },
  // ── Beverages & Other ────────────────────────────────────────────────────────
  { id:"21039",   name:"Water",                cat:"Other"    },
  { id:"440038",  name:"Coca-Cola",            cat:"Other"    },
  { id:"440039",  name:"Diet Coke",            cat:"Other"    },
  { id:"440040",  name:"Sprite",               cat:"Other"    },
  { id:"50103",   name:"Printer Paper Roll",   cat:"Other"    },
];

const CATS = ["All","Produce","Dairy","Meat","Seafood","Frozen","Dry","Oils","Other"];
// No seed data — only show live scraped prices
const fmt = n => n!=null ? "$"+n.toFixed(2) : "—";
const ago = d => { if(!d) return ""; const h=(Date.now()-new Date(d))/3.6e6; if(h<1) return "just now"; if(h<24) return Math.floor(h)+"h ago"; return Math.floor(h/24)+"d ago"; };

export default function App() {
  const [rd, setRd] = useState({});
  const [sc, setSc] = useState({});
  const [oos, setOos] = useState({ rd: [], sysco: [] });
  const [view, setView] = useState("prices");
  const [pricesView, setPricesView] = useState("list"); // list | history | oos
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [synced, setSynced] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const [loading, setLoading] = useState(true);
  const [auditItem, setAuditItem] = useState(null);
  const [unitCompare, setUnitCompare] = useState(null);   // { item, loading, result, error }

  async function fetchUnitCompare(item) {
    const rdP = rd[item.id]?.price;
    const scP = sc[item.id]?.price;
    if (!rdP || !scP) return; // need both prices
    setUnitCompare({ item, loading: true, result: null, error: null });
    try {
      const r = await fetch("/api/unit-compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, itemName: item.name, rdPrice: rdP, scPrice: scP }),
      });
      const data = await r.json();
      if (data.error) setUnitCompare(p => ({ ...p, loading: false, error: data.error }));
      else setUnitCompare(p => ({ ...p, loading: false, result: data }));
    } catch(e) {
      setUnitCompare(p => ({ ...p, loading: false, error: e.message }));
    }
  }
  const [history, setHistory] = useState({}); // { itemId: [{date, rd, sc}] }

  useEffect(() => {
    Promise.all([pull(), fetchHistory()]).finally(() => setLoading(false));
    const t = setInterval(() => { pull(); fetchHistory(); }, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  async function fetchHistory() {
    try {
      const r = await fetch("/api/history");
      if (!r.ok) return;
      const json = await r.json();
      // Handle both old format (plain object) and new format ({data, lastRecorded})
      const data = json.data || json;
      if (data && Object.keys(data).length > 0) setHistory(data);
    } catch {}
  }

  async function pull() {
    try {
      const r = await fetch("/api/prices"); if (!r.ok) return;
      const d = await r.json();
      if (d.rd && Object.keys(d.rd).length) setRd(p => ({ ...p, ...d.rd }));
      if (d.sysco && Object.keys(d.sysco).length) setSc(p => ({ ...p, ...d.sysco }));
      if (d.oos) setOos(d.oos);
      setSynced(new Date().toISOString());
      // Always re-fetch history after prices update so today shows immediately
      fetchHistory();
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

  const confColor = c => c==="high"?"#16A34A":c==="medium"?"#CA8A04":"#DC2626";

  // Unit price comparison modal — shows per-unit/lb/oz breakdown via Claude
  const UnitCompareModal = () => {
    if (!unitCompare) return null;
    const { item, loading, result, error } = unitCompare;
    const rdP = rd[item.id]?.price;
    const scP = sc[item.id]?.price;
    const fmt2 = n => "$" + (n||0).toFixed(2);
    const cheaperColor = v => v === "rd" ? "#16A34A" : v === "sysco" ? "#2563EB" : "#888";
    const cheaperLabel = v => v === "rd" ? "Restaurant Depot" : v === "sysco" ? "Sysco" : "Same price";

    return (
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.55)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setUnitCompare(null)}>
        <div style={{background:"#fff",borderRadius:20,padding:22,maxWidth:400,width:"100%"}} onClick={e=>e.stopPropagation()}>
          <div style={{fontSize:17,fontWeight:700,marginBottom:4}}>{item.name}</div>
          <div style={{fontSize:12,color:"#888",marginBottom:16}}>Unit price comparison</div>

          {loading && (
            <div style={{textAlign:"center",padding:"32px 0",color:"#888"}}>
              <div style={{fontSize:24,marginBottom:8}}>⏳</div>
              <div style={{fontSize:13}}>Claude is calculating...</div>
            </div>
          )}

          {error && <div style={{color:"#DC2626",fontSize:13,padding:"16px 0"}}>{error}</div>}

          {result && (<>
            {/* Per-unit comparison */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
              {[["Restaurant Depot","#F8F8F6","#111",result.rdPerUnit,result.rdPack,result.cheaper==="rd"],
                ["Sysco","#EFF6FF","#2563EB",result.scPerUnit,result.scPack,result.cheaper==="sysco"]
              ].map(([vendor,bg,color,perUnit,pack,isCheaper])=>(
                <div key={vendor} style={{background:bg,borderRadius:12,padding:12,border:isCheaper?"2px solid "+color:"1px solid #eee"}}>
                  <div style={{fontSize:11,fontWeight:600,color:isCheaper?color:"#888",marginBottom:6}}>{vendor}{isCheaper?" ✓":""}</div>
                  <div style={{fontSize:11,color:"#666",marginBottom:6}}>{pack}</div>
                  <div style={{fontSize:22,fontWeight:700,color:isCheaper?color:"#555"}}>{fmt2(perUnit)}</div>
                  <div style={{fontSize:10,color:"#999"}}>per {result.unit}</div>
                  <div style={{fontSize:12,fontWeight:600,color:"#888",marginTop:4}}>Case: {fmt2(vendor==="Restaurant Depot" ? rd[item.id]?.price : sc[item.id]?.price)}</div>
                </div>
              ))}
            </div>

            {/* Savings callout */}
            {result.cheaper !== "same" && (
              <div style={{background:result.cheaper==="rd"?"#F0FDF4":"#EFF6FF",borderRadius:12,padding:"10px 14px",marginBottom:12,display:"flex",alignItems:"center",gap:8}}>
                <div style={{fontSize:18}}>💰</div>
                <div>
                  <div style={{fontSize:12,fontWeight:700,color:cheaperColor(result.cheaper)}}>{cheaperLabel(result.cheaper)} saves {result.savingsPct}% per {result.unit}</div>
                  <div style={{fontSize:11,color:"#666"}}>{fmt2(result.savingsPerUnit)} cheaper per {result.unit}</div>
                </div>
              </div>
            )}


          </>)}

          <button onClick={()=>setUnitCompare(null)} style={{marginTop:14,width:"100%",padding:11,border:"none",borderRadius:10,background:"#111",color:"#fff",fontWeight:600,cursor:"pointer",fontSize:13}}>Close</button>
        </div>
      </div>
    );
  };

  const AuditModal = () => {
    if (!auditItem) return null;
    const rdE = rd[auditItem.id]; const scE = sc[auditItem.id];
    return (
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.55)",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setAuditItem(null)}>
        <div style={{background:"#fff",borderRadius:16,padding:20,maxWidth:460,width:"100%",maxHeight:"80vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
          <div style={{fontSize:16,fontWeight:700,marginBottom:12}}>{auditItem.name} — Audit Trail</div>
          {[["Restaurant Depot","#F8F8F6",rdE],["Sysco","#F0F6FF",scE]].filter(([,,e])=>e).map(([label,bg,entry])=>(
            <div key={label} style={{background:bg,borderRadius:8,padding:10,marginBottom:10,fontSize:11}}>
              <div style={{fontWeight:700,marginBottom:4}}>{label}</div>
              <div>Price: <b>${entry.price}</b> · Confidence: <b style={{color:confColor(entry.confidence)}}>{entry.confidence||"unknown"}</b></div>
              <div>Source: {entry.source||"unknown"}</div>
              {entry.scrapedAt&&<div>Scraped: {new Date(entry.scrapedAt).toLocaleString()}</div>}
              {entry.prevPrice&&<div>Previous: ${entry.prevPrice}</div>}
              {entry.crossValidationFlag&&<div style={{color:"#DC2626",marginTop:4}}>🚨 {entry.crossValidationFlag}</div>}
              {entry.stale&&<div style={{color:"#CA8A04",marginTop:4}}>⚠️ Stale: {entry.staleReason}</div>}
              {entry.auditLog?.length>0&&<>
                <div style={{fontWeight:600,marginTop:6,marginBottom:2}}>Audit log:</div>
                {entry.auditLog.slice().reverse().map((e,i)=>(
                  <div key={i} style={{color:"#666"}}>{new Date(e.date).toLocaleDateString()} · ${e.price} · {e.confidence} · {e.source||e.event||""}</div>
                ))}
              </>}
            </div>
          ))}
          <button onClick={()=>setAuditItem(null)} style={{width:"100%",padding:10,border:"none",borderRadius:8,background:"#111",color:"#fff",fontWeight:600,cursor:"pointer"}}>Close</button>
        </div>
      </div>
    );
  };

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
          {[["prices", "Prices"], ["compare", "Compare"], ["order", "Breakdown"]].map(([id, lbl]) => (
            <button key={id} onClick={() => setView(id)} style={{ flex: 1, padding: "10px 0", border: "none", background: "none", fontSize: 12, fontWeight: 600, color: view === id ? "#111" : "#999", borderBottom: view === id ? "2px solid #111" : "2px solid transparent", cursor: "pointer", transition: "all .15s", letterSpacing: -0.1 }}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* PRICES VIEW */}
      {view === "prices" && (
        <PricesView
          rd={rd} sc={sc} loading={loading}
          cat={cat} setCat={setCat} q={q} setQ={setQ}
          history={history} synced={synced}
          pricesView={pricesView} setPricesView={setPricesView}
          both={both} rdOnly={rdOnly} noPrice={noPrice}
          oos={oos} setAuditItem={setAuditItem} onUnitCompare={fetchUnitCompare}
        />
      )}

      {/* COMPARE VIEW */}
      {view === "compare" && <CompareView rd={rd} sc={sc} />}

      {/* ORDER VIEW */}
      {view === "order" && <OrderView rd={rd} sc={sc} />}

      {/* BOTTOM NAV */}
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, background: "#fff", borderTop: "1px solid #EEEEE9", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", zIndex: 100 }}>
        {[["prices", "Prices"], ["compare", "Compare"], ["order", "Breakdown"]].map(([id, lbl]) => (
          <button key={id} onClick={() => setView(id)} style={{ padding: "14px 8px 16px", border: "none", background: "none", color: view === id ? "#111" : "#AAA", cursor: "pointer", transition: "color .15s" }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: .5 }}>{lbl}</div>
            <div style={{ height: 2, borderRadius: 1, background: view === id ? "#111" : "transparent", marginTop: 4 }} />
          </button>
        ))}
      </div>
      <UnitCompareModal />
      <AuditModal />
    </div>
  );
}

// ── PricesView ────────────────────────────────────────────────────────────────
function PricesView({ rd, sc, loading, cat, setCat, q, setQ, history, synced, pricesView, setPricesView, both, rdOnly, noPrice, oos, setAuditItem, onUnitCompare }) {
  const [historySearch, setHistorySearch] = useState("");
  const [selectedItem, setSelectedItem] = useState(null);

  // PDF export
  function exportPDF() {
    const date = new Date().toLocaleDateString("en-US", { weekday:"long", year:"numeric", month:"long", day:"numeric" });
    const rows = ITEMS.map(item => {
      const rdP = rd[item.id]?.price;
      const scP = sc[item.id]?.price;
      if (!rdP && !scP) return null;
      const rdBest = rdP && scP ? rdP <= scP : !!rdP;
      return { name: item.name, rdP, scP, rdBest };
    }).filter(Boolean);

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Naan & Curry Price Report</title>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 700px; margin: 0 auto; padding: 32px; color: #111; }
  h1 { font-size: 22px; font-weight: 800; margin-bottom: 4px; }
  .sub { font-size: 13px; color: #666; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 8px 10px; background: #f5f5f5; border-bottom: 2px solid #ddd; font-size: 11px; letter-spacing: .5px; }
  td { padding: 9px 10px; border-bottom: 1px solid #eee; }
  tr:hover td { background: #fafafa; }
  .green { color: #16A34A; font-weight: 700; }
  .blue { color: #2563EB; font-weight: 700; }
  .gray { color: #aaa; }
  .badge { font-size: 10px; padding: 2px 8px; border-radius: 99px; font-weight: 700; }
  .badge-rd { background: #F0FDF4; color: #16A34A; }
  .badge-sc { background: #EFF6FF; color: #2563EB; }
  .footer { margin-top: 32px; font-size: 11px; color: #999; text-align: center; }
</style>
</head>
<body>
<h1>🍛 Naan & Curry — Price Report</h1>
<div class="sub">${date} · Las Vegas</div>
<table>
<thead><tr><th>ITEM</th><th>RESTAURANT DEPOT</th><th>SYSCO</th><th>BUY AT</th></tr></thead>
<tbody>
${rows.map(r => `<tr>
  <td>${r.name}</td>
  <td class="${r.rdP ? (r.rdBest ? "green" : "") : "gray"}">${r.rdP ? "$" + r.rdP.toFixed(2) : "—"}</td>
  <td class="${r.scP ? (!r.rdBest ? "blue" : "") : "gray"}">${r.scP ? "$" + r.scP.toFixed(2) : "—"}</td>
  <td><span class="badge ${r.rdBest ? "badge-rd" : "badge-sc"}">${r.rdBest ? "RD" : "Sysco"}</span></td>
</tr>`).join("")}
</tbody>
</table>
<div class="footer">Generated by Naan & Curry Price Tracker · ${new Date().toISOString()}</div>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "naan-curry-prices-" + new Date().toISOString().slice(0,10) + ".html";
    a.click();
    URL.revokeObjectURL(url);
  }

  // History search results
  const historyResults = historySearch.length > 1
    ? ITEMS.filter(i => i.name.toLowerCase().includes(historySearch.toLowerCase()) && history[i.id]?.length > 0)
    : [];

  // Out of stock — driven by actual scraper flags from server
  const rdOosIds = new Set((oos?.rd || []));
  const scOosIds = new Set((oos?.sysco || []));

  // Items flagged OOS by scraper
  const oosItems = ITEMS.filter(item => rdOosIds.has(item.id) || scOosIds.has(item.id));

  // Also include items missing price from one vendor that have been seen before
  const missingItems = ITEMS.filter(item => {
    // Keep OOS items in main list — they show last confirmed price with OOS badge
    // if (rdOosIds.has(item.id) || scOosIds.has(item.id)) return false;
    const rdP = rd[item.id]?.price;
    const scP = sc[item.id]?.price;
    const hasHistory = history[item.id]?.length > 1;
    return hasHistory && (!rdP || !scP);
  });

  return (
    <div>
      {/* Sub-nav: List | History | Out of Stock */}
      <div style={{ background: "#fff", borderBottom: "1px solid #EEEEE9", padding: "10px 16px", display: "flex", gap: 8, alignItems: "center" }}>
        {[["list","📋 Prices"], ["history","📈 History"], ["oos","⚠️ Out of Stock"]].map(([id, lbl]) => (
          <button key={id} onClick={() => setPricesView(id)} style={{ padding: "6px 12px", borderRadius: 99, border: "none", background: pricesView === id ? "#111" : "#F0F0EC", color: pricesView === id ? "#fff" : "#555", fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all .15s", whiteSpace: "nowrap" }}>
            {lbl}
          </button>
        ))}
        <button onClick={exportPDF} style={{ marginLeft: "auto", padding: "6px 12px", borderRadius: 99, border: "1px solid #E0E0DB", background: "#fff", color: "#555", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}>
          ↓ PDF
        </button>
      </div>

      {/* PRICE LIST */}
      {pricesView === "list" && (
        <div>
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
            {loading && <div style={{ textAlign: "center", padding: "60px 20px", color: "#999", fontSize: 13, fontWeight: 500 }}>Loading prices…</div>}

            {!loading && both.length > 0 && (
              <>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#999", letterSpacing: .5, marginBottom: 8, paddingLeft: 4 }}>COMPARING BOTH VENDORS</div>
                {both.map((item, i) => {
                  const r = rd[item.id].price, s = sc[item.id].price, rdBest = r <= s;
                  return (
                    <div key={item.id} className="fi" onClick={()=>setAuditItem&&setAuditItem(item)} style={{ background: "#fff", borderRadius: 12, marginBottom: 6, overflow: "hidden", border: "1px solid #EEEEE9", animationDelay: i * 15 + "ms", cursor:"pointer" }}>
                      <div style={{ padding: "12px 14px 10px", display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 20 }}></span>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "#111", flex: 1 }}>
                          {item.name}
                          {(rdOosIds.has(item.id) || scOosIds.has(item.id)) && (
                            <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 99, background: "#FEF2F2", color: "#DC2626", verticalAlign: "middle" }}>
                              {rdOosIds.has(item.id) && scOosIds.has(item.id) ? "BOTH OOS" : rdOosIds.has(item.id) ? "RD OOS" : "SYSCO OOS"}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 99,
                          background: rdBest ? "#F0FDF4" : "#EFF6FF",
                          color: rdBest ? "#16A34A" : "#2563EB",
                          border: DIFFERENT_CASE_SIZES.has(item.id) ? "1.5px dashed " + (rdBest ? "#16A34A" : "#2563EB") : "1.5px solid transparent",
                          title: DIFFERENT_CASE_SIZES.has(item.id) ? "Case sizes differ — tap Compare for details" : ""
                        }}>
                          {rdBest ? "Buy at RD" : "Buy at Sysco"}
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderTop: "1px solid #F3F3EF" }}>
                        <div style={{ padding: "10px 14px", borderRight: "1px solid #F3F3EF", background: rdOosIds.has(item.id) ? "#FFFBFB" : rdBest ? "#F7FEF9" : "transparent", opacity: rdOosIds.has(item.id) ? 0.7 : 1 }}>
                          <div style={{ fontSize: 10, fontWeight: 600, color: rdOosIds.has(item.id) ? "#DC2626" : rdBest ? "#16A34A" : "#AAA", letterSpacing: .3, marginBottom: 3 }}>{rdOosIds.has(item.id) ? "⚠ OOS" : rdBest ? "✓ " : ""}Restaurant Depot</div>
                          <div style={{ fontSize: 17, fontWeight: 700, color: rdOosIds.has(item.id) ? "#999" : rdBest ? "#16A34A" : "#555" }}>{fmt(r)}</div>
                          <div style={{ fontSize: 9, color: rdOosIds.has(item.id) ? "#DC2626" : "#AAA", marginTop: 2 }}>{rdOosIds.has(item.id) ? "last known price" : rd[item.id]?.unit === "each" ? "per unit" : "per case"}</div>
                        </div>
                        <div style={{ padding: "10px 14px", background: scOosIds.has(item.id) ? "#FFFBFB" : !rdBest ? "#F0F6FF" : "transparent", opacity: scOosIds.has(item.id) ? 0.7 : 1 }}>
                          <div style={{ fontSize: 10, fontWeight: 600, color: scOosIds.has(item.id) ? "#DC2626" : !rdBest ? "#2563EB" : "#AAA", letterSpacing: .3, marginBottom: 3 }}>{scOosIds.has(item.id) ? "⚠ OOS" : !rdBest ? "✓ " : ""}Sysco</div>
                          <div style={{ fontSize: 17, fontWeight: 700, color: scOosIds.has(item.id) ? "#999" : !rdBest ? "#2563EB" : "#555" }}>{fmt(s)}</div>
                          {scOosIds.has(item.id) && <div style={{ fontSize: 9, color: "#DC2626", marginTop: 2 }}>last known price</div>}
                        </div>
                      </div>
                      {onUnitCompare && (
                        <button onClick={e=>{e.stopPropagation();onUnitCompare(item);}} style={{width:"100%",padding:"7px 0",border:"none",borderTop:"1px solid #F3F3EF",background:"#FAFAF8",color:"#666",fontSize:11,fontWeight:600,cursor:"pointer",letterSpacing:.3}}>
                          📦 COMPARE BY UNIT / WEIGHT
                        </button>
                      )}
                    </div>
                  );
                })}
              </>
            )}

            {!loading && rdOnly.length > 0 && (
              <>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#999", letterSpacing: .5, margin: "16px 0 8px", paddingLeft: 4 }}>RESTAURANT DEPOT ONLY</div>
                {rdOnly.map((item, i) => (
                  <div key={item.id} className="fi" onClick={()=>setAuditItem&&setAuditItem(item)} style={{ background: "#fff", borderRadius: 12, marginBottom: 6, border: "1px solid #EEEEE9", display: "flex", alignItems: "center", padding: "12px 14px", gap: 10, animationDelay: i * 10 + "ms", cursor:"pointer" }}>
                    <span style={{ fontSize: 20 }}></span>
                    <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "#111" }}>{item.name}</div>
                    <div style={{ fontSize: 17, fontWeight: 700, color: "#111" }}>{fmt(rd[item.id]?.price)}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#999", background: "#F0F0EC", borderRadius: 99, padding: "3px 10px" }}>RD</div>
                  </div>
                ))}
              </>
            )}

            {!loading && noPrice.length > 0 && (()=> {
              const rdOosSet = new Set(oos?.rd || []);
              const oosHere = noPrice.filter(i => rdOosSet.has(i.id));
              const unscraped = noPrice.filter(i => !rdOosSet.has(i.id));
              return (<>
                {oosHere.length > 0 && (<>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#DC2626", letterSpacing: .5, margin: "16px 0 8px", paddingLeft: 4 }}>
                    🔴 OUT OF STOCK AT RD
                  </div>
                  {oosHere.map(item => (
                    <div key={item.id} style={{ background: "#fff", borderRadius: 12, marginBottom: 6, border: "1px solid #FEE2E2", display: "flex", alignItems: "center", padding: "12px 14px", gap: 10 }}>
                      <span style={{ fontSize: 20 }}></span>
                      <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "#111" }}>{item.name}</div>
                      {sc[item.id] && <div style={{ fontSize: 13, fontWeight: 700, color: "#2563EB" }}>{fmt(sc[item.id].price)}</div>}
                      {sc[item.id]
                        ? <div style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 99, background: "#EFF6FF", color: "#2563EB" }}>Sysco</div>
                        : <div style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 99, background: "#FEF2F2", color: "#DC2626" }}>OOS</div>}
                    </div>
                  ))}
                </>)}
                {unscraped.length > 0 && (<>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#C0BAB0", letterSpacing: .5, margin: "16px 0 8px", paddingLeft: 4, display: "flex", alignItems: "center", gap: 6 }}>
                    <span>⚠️</span> NO CURRENT PRICING
                  </div>
                  {unscraped.map(item => (
                    <div key={item.id} style={{ background: "#fff", borderRadius: 12, marginBottom: 6, border: "1px dashed #E0E0D8", display: "flex", alignItems: "center", padding: "12px 14px", gap: 10, opacity: 0.6 }}>
                      <span style={{ fontSize: 20 }}></span>
                      <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "#888" }}>{item.name}</div>
                      <div style={{ fontSize: 11, color: "#BBB", fontWeight: 500 }}>Not scraped yet</div>
                    </div>
                  ))}
                </>)}
              </>);
            })()}

            {!loading && both.length === 0 && rdOnly.length === 0 && noPrice.length === 0 && (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "#999" }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>🔍</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#555" }}>Nothing found</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* PRICE HISTORY */}
      {pricesView === "history" && (
        <div style={{ padding: "16px 12px 0" }}>
          <input value={historySearch} onChange={e => { setHistorySearch(e.target.value); setSelectedItem(null); }}
            placeholder="Search item…"
            style={{ width: "100%", background: "#fff", border: "1px solid #EEEEE9", borderRadius: 10, padding: "10px 14px", fontSize: 14, color: "#111", outline: "none", marginBottom: 12 }} />

          {historySearch.length > 1 && historyResults.length === 0 && (
            <div style={{ textAlign: "center", padding: "30px 20px", color: "#999", fontSize: 13 }}>No history found</div>
          )}

          {/* Render list — search results or all items */}
          {(historySearch.length > 1 ? historyResults : ITEMS.filter(i => history[i.id]?.length > 0)).map(item => {
            const entries = history[item.id] || [];
            const last7  = entries.slice(-7).reverse();
            const last30 = entries.slice(-30).reverse();
            const latest = entries[entries.length - 1];
            const prev   = entries[entries.length - 2];
            const rdChange = prev?.rd && latest?.rd ? latest.rd - prev.rd : null;
            const isOpen = selectedItem?.id === item.id;
            const [view7, setView7] = [selectedItem?.view7, (v) => setSelectedItem(s => ({ ...s, view7: v }))];

            return (
              <div key={item.id} style={{ marginBottom: 8 }}>
                {/* Row button */}
                <button onClick={() => setSelectedItem(isOpen ? null : { ...item, view7: true })}
                  style={{ width: "100%", background: "#fff", border: isOpen ? "1px solid #111" : "1px solid #EEEEE9", borderRadius: isOpen ? "12px 12px 0 0" : 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", textAlign: "left", borderBottom: isOpen ? "none" : undefined }}>
                  <span style={{ fontSize: 18 }}></span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>{item.name}</div>
                    <div style={{ fontSize: 11, color: "#999", marginTop: 1 }}>{entries.length} day{entries.length !== 1 ? "s" : ""} of data</div>
                  </div>
                  {rdChange !== null && (
                    <div style={{ fontSize: 11, fontWeight: 700, color: rdChange > 0.005 ? "#DC2626" : rdChange < -0.005 ? "#16A34A" : "#999" }}>
                      {rdChange > 0.005 ? "↑" : rdChange < -0.005 ? "↓" : "="} ${Math.abs(rdChange).toFixed(2)}
                    </div>
                  )}
                  <div style={{ fontSize: 13, color: "#999", transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }}>›</div>
                </button>

                {/* Expanded panel */}
                {isOpen && (
                  <div style={{ background: "#fff", border: "1px solid #111", borderTop: "none", borderRadius: "0 0 12px 12px", overflow: "hidden", marginBottom: 2 }}>
                    {/* 7d / 30d toggle */}
                    <div style={{ display: "flex", borderBottom: "1px solid #EEEEE9", padding: "8px 14px", gap: 8 }}>
                      {[["7d","Last 7 Days"], ["30d","Last 30 Days"]].map(([key, lbl]) => (
                        <button key={key} onClick={() => setSelectedItem(s => ({ ...s, view7: key === "7d" }))}
                          style={{ padding: "4px 12px", borderRadius: 99, border: "none", background: (selectedItem?.view7 !== false) === (key === "7d") ? "#111" : "#F0F0EC", color: (selectedItem?.view7 !== false) === (key === "7d") ? "#fff" : "#555", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                          {lbl}
                        </button>
                      ))}
                    </div>
                    {/* Column headers */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 70px 70px", padding: "7px 14px", background: "#F7F7F5", borderBottom: "1px solid #EEEEE9" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#999", letterSpacing: .5 }}>DATE</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#16A34A", letterSpacing: .5, textAlign: "right" }}>RD</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#2563EB", letterSpacing: .5, textAlign: "right" }}>SYSCO</div>
                    </div>
                    {(selectedItem?.view7 !== false ? last7 : last30).map((entry, i, arr) => {
                      const nextEntry = arr[i + 1];
                      const rdDiff = nextEntry?.rd && entry.rd ? entry.rd - nextEntry.rd : null;
                      return (
                        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 70px 70px", padding: "9px 14px", borderBottom: i < arr.length - 1 ? "1px solid #F3F3EF" : "none", alignItems: "center" }}>
                          <div style={{ fontSize: 12, color: "#555" }}>{new Date(entry.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: entry.rd ? "#111" : "#CCC" }}>{entry.rd ? "$" + entry.rd.toFixed(2) : "—"}</div>
                            {rdDiff !== null && Math.abs(rdDiff) > 0.005 && (
                              <div style={{ fontSize: 10, color: rdDiff > 0 ? "#DC2626" : "#16A34A" }}>{rdDiff > 0 ? "↑" : "↓"}${Math.abs(rdDiff).toFixed(2)}</div>
                            )}
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: entry.sc ? "#111" : "#CCC", textAlign: "right" }}>{entry.sc ? "$" + entry.sc.toFixed(2) : "—"}</div>
                        </div>
                      );
                    })}
                    {(selectedItem?.view7 !== false ? last7 : last30).length === 0 && (
                      <div style={{ padding: "14px", textAlign: "center", fontSize: 12, color: "#BBB" }}>No data for this period</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {historySearch.length <= 1 && ITEMS.filter(i => history[i.id]?.length > 0).length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#999" }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>No history yet</div>
              <div style={{ fontSize: 12, marginTop: 6, color: "#BBB" }}>Prices are recorded daily after the 6am scrape</div>
            </div>
          )}
        </div>
      )}

      {/* OUT OF STOCK */}
      {pricesView === "oos" && (
        <div style={{ padding: "16px 12px 0" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#999", letterSpacing: .5, marginBottom: 10, paddingLeft: 2 }}>
            ITEMS MISSING FROM ONE VENDOR
          </div>
          {oosItems.length === 0 && missingItems.length === 0 && (
            <div style={{ textAlign: "center", padding: "50px 20px", color: "#999" }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>✅</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#555" }}>No stock issues detected</div>
              <div style={{ fontSize: 12, marginTop: 6, color: "#BBB" }}>Run a sync to get latest stock status</div>
            </div>
          )}

          {/* Confirmed out of stock from scraper */}
          {oosItems.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#DC2626", letterSpacing: .5, marginBottom: 8, paddingLeft: 2 }}>
                🔴 OUT OF STOCK
              </div>
              {oosItems.map((item) => {
                const rdOos = rdOosIds.has(item.id);
                const scOos = scOosIds.has(item.id);
                const rdP = rd[item.id]?.price;
                const scP = sc[item.id]?.price;
                return (
                  <div key={item.id} style={{ background: "#fff", borderRadius: 12, marginBottom: 6, border: "1px solid #FEE2E2", padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 20 }}></span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>{item.name}</div>
                      <div style={{ fontSize: 11, marginTop: 3, display: "flex", gap: 8 }}>
                        <span style={{ color: rdOos ? "#DC2626" : "#16A34A", fontWeight: 600 }}>
                          {rdOos ? "RD — out of stock" : "RD ✓ " + fmt(rdP)}
                        </span>
                        <span style={{ color: scOos ? "#DC2626" : "#2563EB", fontWeight: 600 }}>
                          {scOos ? "Sysco — out of stock" : scP ? "Sysco ✓ " + fmt(scP) : "Sysco — no price"}
                        </span>
                      </div>
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 99, background: "#FEF2F2", color: "#DC2626" }}>OOS</div>
                  </div>
                );
              })}
            </>
          )}

          {/* Items missing from one vendor based on history */}
          {missingItems.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#999", letterSpacing: .5, margin: "16px 0 8px", paddingLeft: 2 }}>
                ⚠️ MISSING VENDOR PRICE
              </div>
              {missingItems.map((item) => {
                const rdP = rd[item.id]?.price;
                const scP = sc[item.id]?.price;
                return (
                  <div key={item.id} style={{ background: "#fff", borderRadius: 12, marginBottom: 6, border: "1px solid #EEEEE9", padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 20 }}></span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>{item.name}</div>
                      <div style={{ fontSize: 11, marginTop: 3, display: "flex", gap: 8 }}>
                        <span style={{ color: rdP ? "#16A34A" : "#F59E0B", fontWeight: 600 }}>{rdP ? "RD ✓ " + fmt(rdP) : "RD — no current price"}</span>
                        <span style={{ color: scP ? "#2563EB" : "#F59E0B", fontWeight: 600 }}>{scP ? "Sysco ✓ " + fmt(scP) : "Sysco — no current price"}</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 99, background: "#FFFBEB", color: "#D97706" }}>CHECK</div>
                  </div>
                );
              })}
            </>
          )}

          {/* Also show items with zero history and no current price */}
          {ITEMS.filter(i => !rd[i.id] && !sc[i.id] && !history[i.id]?.length).length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#C0BAB0", letterSpacing: .5, margin: "16px 0 8px", paddingLeft: 2 }}>NEVER SCRAPED</div>
              {ITEMS.filter(i => !rd[i.id] && !sc[i.id] && !history[i.id]?.length).map(item => (
                <div key={item.id} style={{ background: "#fff", borderRadius: 12, marginBottom: 6, border: "1px dashed #E0E0D8", display: "flex", alignItems: "center", padding: "12px 14px", gap: 10, opacity: 0.6 }}>
                  <span style={{ fontSize: 20 }}></span>
                  <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "#888" }}>{item.name}</div>
                  <div style={{ fontSize: 11, color: "#BBB" }}>No data</div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}


function CompareView({ rd, sc }) {
  const [list, setList] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  async function analyze() {
    if (!list.trim()) return;
    setLoading(true);

    const catalog = ITEMS.map(item => ({
      id: item.id,
      name: item.name,
      rdPrice: rd[item.id]?.price || null,
      scPrice: sc[item.id]?.price || null,
    }));

    try {
      const prompt = `Match each line of this restaurant order list to a product catalog item, and extract the quantity.

ORDER LIST:
${list}

PRODUCT CATALOG (id: name | RD price | Sysco price):
${catalog.map(i => i.id + ": " + i.name + " | RD: " + (i.rdPrice ? "$"+i.rdPrice : "N/A") + " | Sysco: " + (i.scPrice ? "$"+i.scPrice : "N/A")).join("\n")}

Rules:
- Match abbreviations and casual names ("chx breast"=chicken breast, "LQ"=leg quarters, "WM"=whole milk)
- Extract quantity from each line (e.g. "2 milks" → qty:2, "3x chicken" → qty:3, "chicken" → qty:1)
- Quantities apply to cases unless otherwise stated
- If no reasonable product match exists, put in unmatched

Return ONLY this JSON structure:
{"matched":[{"line":"original line","id":"CATALOG_ID","qty":1}],"unmatched":["lines with no match"]}`;

      const res = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max_tokens: 1500, messages: [{ role: "user", content: prompt }] })
      });
      const data = await res.json();
      const txt = data.content?.find(b => b.type === "text")?.text || "{}";
      const jsonM = txt.match(/\{[\s\S]*\}/);
      const parsed = jsonM ? JSON.parse(jsonM[0]) : { matched: [], unmatched: [] };

      const bothItems = [], skipped = [], unmatched = parsed.unmatched || [];
      (parsed.matched || []).forEach(({ line, id, qty }) => {
        const item = ITEMS.find(i => i.id === id);
        if (!item) { unmatched.push(line); return; }
        const rdP = rd[item.id]?.price, scP = sc[item.id]?.price;
        const q = Math.max(1, parseInt(qty) || 1);
        if (rdP && scP) bothItems.push({ ...item, rdPrice: rdP, scPrice: scP, qty: q, line, rdMult: rd[item.id]?.rdMult || 1 });
        else skipped.push({ ...item, rdPrice: rdP||null, scPrice: scP||null, qty: q, line,
          reason: !rdP&&!scP ? "No pricing from either vendor" : !rdP ? "No RD pricing" : "No Sysco pricing" });
      });

      const purRD = bothItems.reduce((s,i)=>s+(i.rdPrice * i.qty),0);
      const purSC = bothItems.reduce((s,i)=>s+(i.scPrice * i.qty),0);
      setResult({ bothItems, purRD, purSC, skipped, unmatched });
    } catch(e) {
      // Fallback to local fuzzy match
      const lines = list.split("\n").map(l=>l.trim()).filter(l=>l.length>2);
      const bothItems=[], skipped=[], unmatched=[];
      lines.forEach(line => {
        let clean = line.replace(/[^\w\s]/g,"").toLowerCase().trim();
        let best=null, bestScore=0;
        ITEMS.forEach(item => {
          const iName=item.name.toLowerCase(); let score=0;
          iName.split(" ").forEach(w=>{if(w.length>2&&clean.includes(w))score+=w.length*2;});
          clean.split(" ").forEach(w=>{if(w.length>2&&iName.includes(w))score+=w.length;});
          if(score>bestScore){bestScore=score;best=item;}
        });
        if(!best||bestScore<3){unmatched.push(line);return;}
        const rdP=rd[best.id]?.price, scP=sc[best.id]?.price;
        if(rdP&&scP)bothItems.push({...best,rdPrice:rdP,scPrice:scP});
        else skipped.push({...best,rdPrice:rdP||null,scPrice:scP||null,reason:"Missing one vendor"});
      });
      setResult({ bothItems, purRD:bothItems.reduce((s,i)=>s+i.rdPrice,0), purSC:bothItems.reduce((s,i)=>s+i.scPrice,0), skipped, unmatched });
    }
    setLoading(false);
  }

  const fmt2 = n => n != null ? "$" + n.toFixed(2) : "—";

  return (
    <div style={{ padding: "16px 12px 0" }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#111", marginBottom: 12 }}>Vendor Cost Comparison</div>
      <textarea value={list} onChange={e => setList(e.target.value)}
        placeholder="Paste list here..."
        style={{ width: "100%", minHeight: 160, background: "#fff", border: "1px solid #EEEEE9", borderRadius: 12, padding: "12px 14px", color: "#111", fontSize: 14, lineHeight: 1.7, resize: "none", outline: "none" }} />

      <button onClick={analyze} disabled={!list.trim() || loading} style={{ width: "100%", marginTop: 8, padding: "14px", border: "none", borderRadius: 12, background: !list.trim() || loading ? "#F0F0EC" : "#111", color: !list.trim() || loading ? "#AAA" : "#fff", fontSize: 14, fontWeight: 600, cursor: !list.trim() || loading ? "default" : "pointer", transition: "all .2s" }}>
        {loading ? "Analyzing with AI…" : "Compare Vendor Totals →"}
      </button>

      {result && (
        <div style={{ marginTop: 14 }}>

          {result.bothItems.length === 0 && (
            <div style={{ textAlign: "center", padding: "24px", color: "#999", background: "#fff", borderRadius: 12, border: "1px solid #EEEEE9", marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>No items with pricing from both vendors</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Check skipped items below</div>
            </div>
          )}

          {result.bothItems.length > 0 && (<>
            {/* Totals */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div style={{ background: result.purRD <= result.purSC ? "#F0FDF4" : "#fff", border: result.purRD <= result.purSC ? "2px solid #16A34A" : "1px solid #EEEEE9", borderRadius: 14, padding: "16px 12px", textAlign: "center" }}>
                {result.purRD <= result.purSC && <div style={{ fontSize: 10, fontWeight: 700, color: "#16A34A", letterSpacing: .5, marginBottom: 4 }}>✓ CHEAPER</div>}
                <div style={{ fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 6 }}>🏪 Restaurant Depot</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: result.purRD <= result.purSC ? "#16A34A" : "#111", lineHeight: 1 }}>{fmt2(result.purRD)}</div>
                <div style={{ fontSize: 10, color: "#999", marginTop: 4 }}>{result.bothItems.length} items compared</div>
              </div>
              <div style={{ background: result.purSC < result.purRD ? "#EFF6FF" : "#fff", border: result.purSC < result.purRD ? "2px solid #2563EB" : "1px solid #EEEEE9", borderRadius: 14, padding: "16px 12px", textAlign: "center" }}>
                {result.purSC < result.purRD && <div style={{ fontSize: 10, fontWeight: 700, color: "#2563EB", letterSpacing: .5, marginBottom: 4 }}>✓ CHEAPER</div>}
                <div style={{ fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 6 }}>🚚 Sysco</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: result.purSC < result.purRD ? "#2563EB" : "#111", lineHeight: 1 }}>{fmt2(result.purSC)}</div>
                <div style={{ fontSize: 10, color: "#999", marginTop: 4 }}>{result.bothItems.length} items compared</div>
              </div>
            </div>

            {/* Savings */}
            <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 12, padding: "11px 14px", marginBottom: 14, textAlign: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#92400E" }}>
                {result.purRD <= result.purSC
                  ? `Restaurant Depot saves you $${(result.purSC - result.purRD).toFixed(2)}`
                  : `Sysco saves you $${(result.purRD - result.purSC).toFixed(2)}`}
              </div>
            </div>

            {/* Item breakdown table */}
            <div style={{ fontSize: 11, fontWeight: 600, color: "#999", letterSpacing: .5, marginBottom: 8, paddingLeft: 4 }}>ITEM BREAKDOWN</div>
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #EEEEE9", overflow: "hidden", marginBottom: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 64px 64px", padding: "8px 14px", background: "#F7F7F5", borderBottom: "1px solid #EEEEE9" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#999", letterSpacing: .5 }}>ITEM</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#16A34A", letterSpacing: .5, textAlign: "right" }}>RD</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#2563EB", letterSpacing: .5, textAlign: "right" }}>SYSCO</div>
              </div>
              {result.bothItems.map((item, i) => {
                const rdWins = item.rdPrice <= item.scPrice;
                return (
                  <div key={item.id} style={{ display: "grid", gridTemplateColumns: "1fr 64px 64px", padding: "10px 14px", borderBottom: i < result.bothItems.length - 1 ? "1px solid #F3F3EF" : "none", alignItems: "center", gap: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 15 }}></span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: "#111" }}>{item.name}</div>
                        {item.qty > 1 && <div style={{ fontSize: 10, color: "#999" }}>×{item.qty} cases</div>}
                      </div>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: rdWins ? "#16A34A" : "#888", textAlign: "right" }}>
                      {fmt2(item.rdPrice * item.qty)}
                      {item.qty > 1 && <div style={{ fontSize: 9, color: "#AAA", fontWeight: 500 }}>{fmt2(item.rdPrice)} ea</div>}

                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: !rdWins ? "#2563EB" : "#888", textAlign: "right" }}>
                      {fmt2(item.scPrice * item.qty)}
                      {item.qty > 1 && <div style={{ fontSize: 9, color: "#AAA", fontWeight: 500 }}>{fmt2(item.scPrice)} ea</div>}
                    </div>
                  </div>
                );
              })}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 64px 64px", padding: "12px 14px", background: "#F7F7F5", borderTop: "2px solid #EEEEE9" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>Total</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: result.purRD <= result.purSC ? "#16A34A" : "#111", textAlign: "right" }}>{fmt2(result.purRD)}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: result.purSC < result.purRD ? "#2563EB" : "#111", textAlign: "right" }}>{fmt2(result.purSC)}</div>
              </div>
            </div>
          </>)}

          {/* Skipped — missing one vendor price */}
          {result.skipped.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#C0BAB0", letterSpacing: .5, marginBottom: 8, paddingLeft: 4 }}>⚠️ SKIPPED — MISSING VENDOR PRICING</div>
              <div style={{ background: "#fff", borderRadius: 12, border: "1px dashed #E0E0D8", overflow: "hidden", marginBottom: 14 }}>
                {result.skipped.map((item, i) => (
                  <div key={item.id} style={{ display: "flex", alignItems: "center", padding: "10px 14px", borderBottom: i < result.skipped.length - 1 ? "1px solid #F3F3EF" : "none", gap: 10, opacity: 0.7 }}>
                    <span style={{ fontSize: 15 }}></span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#555" }}>{item.name}</div>
                      <div style={{ fontSize: 11, color: "#AAA", marginTop: 1 }}>{item.reason}</div>
                    </div>
                    {item.rdPrice && <div style={{ fontSize: 11, color: "#16A34A", fontWeight: 600 }}>RD {fmt2(item.rdPrice)}</div>}
                    {item.scPrice && <div style={{ fontSize: 11, color: "#2563EB", fontWeight: 600 }}>Sysco {fmt2(item.scPrice)}</div>}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Not recognized */}
          {result.unmatched.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#C0BAB0", letterSpacing: .5, marginBottom: 8, paddingLeft: 4 }}>❓ NOT RECOGNIZED</div>
              <div style={{ background: "#fff", borderRadius: 12, border: "1px dashed #E0E0D8", marginBottom: 14 }}>
                {result.unmatched.map((line, i) => (
                  <div key={i} style={{ padding: "10px 14px", fontSize: 13, color: "#AAA", borderBottom: i < result.unmatched.length - 1 ? "1px solid #F3F3EF" : "none" }}>
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
  const [matched, setMatched] = useState([]);

  function matchList(text) {
    const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 1);
    const found = [];
    const seen = new Set();
    lines.forEach(line => {
      let clean = line
        .replace(/[\u{1F300}-\u{1FFFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "")
        .replace(/^[\d\s\-*\.x:\u2022]+/i, "")
        .replace(/[\d:]+\s*$/i, "")
        .toLowerCase().trim();
      if (!clean || clean.length < 2) return;
      let best = null, bestScore = 0;
      ITEMS.forEach(item => {
        const iName = item.name.toLowerCase();
        let score = 0;
        iName.split(" ").forEach(w => { if (w.length > 2 && clean.includes(w)) score += w.length * 2; });
        clean.split(" ").forEach(w => { if (w.length > 2 && iName.includes(w)) score += w.length; });
        if (iName.includes(clean) || clean.includes(iName.split(" ")[0])) score += 8;
        if (score > bestScore) { bestScore = score; best = item; }
      });
      if (best && bestScore >= 3 && !seen.has(best.id)) {
        seen.add(best.id);
        const rdP = rd[best.id]?.price;
        const scP = sc[best.id]?.price;
        if (rdP || scP) found.push({ ...best, rdPrice: rdP || null, scPrice: scP || null });
      }
    });
    return found;
  }

  async function go() {
    if (!list.trim()) return;
    setLoading(true); setResult(""); setMatched([]);
    setMatched(matchList(list));
    try {
      const r = await fetch("/api/grocery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ list }) });
      const d = await r.json();
      setResult(d.result || "Something went wrong");
    } catch (e) { setResult("Error: " + e.message); }
    setLoading(false);
  }

  // Parse the AI result into structured sections
  function parseResult(text) {
    if (!text) return null;
    const sections = { rd: [], sysco: [], manual: [], rdTotal: null, syscoTotal: null, orderTotal: null };
    let current = null;
    text.split("\n").forEach(line => {
      const l = line.trim();
      if (!l) return;
      if (l.startsWith("🟢")) { current = "rd"; return; }
      if (l.startsWith("🔵")) { current = "sysco"; return; }
      if (l.startsWith("⚠️")) { current = "manual"; return; }
      if (l.match(/RD Cart Total/i)) { sections.rdTotal = l.replace(/.*:\s*/, "").trim(); return; }
      if (l.match(/Sysco Cart Total/i)) { sections.syscoTotal = l.replace(/.*:\s*/, "").trim(); return; }
      if (l.match(/TOTAL ORDER/i)) { sections.orderTotal = l.replace(/.*:\s*/, "").trim(); return; }
      if (l.startsWith("-") && current) sections[current].push(l.replace(/^-\s*/, ""));
    });
    return sections;
  }

  const parsed = parseResult(result);

  return (
    <div style={{ padding: "16px 12px 0" }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#111", marginBottom: 12 }}>Vendor Cost Breakdown</div>
      <textarea value={list} onChange={e => setList(e.target.value)}
        placeholder="Paste your order list, one item per line..."
        style={{ width: "100%", minHeight: 130, background: "#fff", border: "1px solid #EEEEE9", borderRadius: 12, padding: "12px 14px", color: "#111", fontSize: 14, lineHeight: 1.7, resize: "none", outline: "none" }} />

      <button onClick={go} disabled={loading || !list.trim()} style={{ width: "100%", marginTop: 8, padding: "14px", border: "none", borderRadius: 12, background: loading || !list.trim() ? "#F0F0EC" : "#111", color: loading || !list.trim() ? "#AAA" : "#fff", fontSize: 14, fontWeight: 600, cursor: loading || !list.trim() ? "default" : "pointer", transition: "all .2s" }}>
        {loading ? "Analyzing your order…" : "Get Order Breakdown →"}
      </button>

      {parsed && (
        <div style={{ marginTop: 14 }}>

          {/* RD section */}
          {parsed.rd.length > 0 && (
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #EEEEE9", overflow: "hidden", marginBottom: 10 }}>
              <div style={{ padding: "12px 14px", borderBottom: "1px solid #F3F3EF", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14 }}>🏪</span>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>Restaurant Depot</div>
              </div>
              {parsed.rd.map((line, i) => (
                <div key={i} style={{ padding: "10px 14px", borderBottom: i < parsed.rd.length - 1 ? "1px solid #F3F3EF" : "none", fontSize: 13, color: "#333", lineHeight: 1.4 }}>
                  {line}
                </div>
              ))}
              {parsed.rdTotal && (
                <div style={{ padding: "11px 14px", background: "#F7FEF9", borderTop: "2px solid #D1FAE5", display: "flex", justifyContent: "space-between" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#16A34A" }}>RD Total</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#16A34A" }}>{parsed.rdTotal}</div>
                </div>
              )}
            </div>
          )}

          {/* Sysco section */}
          {parsed.sysco.length > 0 && (
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #EEEEE9", overflow: "hidden", marginBottom: 10 }}>
              <div style={{ padding: "12px 14px", borderBottom: "1px solid #F3F3EF", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14 }}>🚚</span>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>Sysco</div>
              </div>
              {parsed.sysco.map((line, i) => (
                <div key={i} style={{ padding: "10px 14px", borderBottom: i < parsed.sysco.length - 1 ? "1px solid #F3F3EF" : "none", fontSize: 13, color: "#333", lineHeight: 1.4 }}>
                  {line}
                </div>
              ))}
              {parsed.syscoTotal && (
                <div style={{ padding: "11px 14px", background: "#EFF6FF", borderTop: "2px solid #BFDBFE", display: "flex", justifyContent: "space-between" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#2563EB" }}>Sysco Total</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#2563EB" }}>{parsed.syscoTotal}</div>
                </div>
              )}
            </div>
          )}

          {/* Manual / not in system */}
          {parsed.manual.length > 0 && (
            <div style={{ background: "#fff", borderRadius: 12, border: "1px dashed #E0E0D8", overflow: "hidden", marginBottom: 10 }}>
              <div style={{ padding: "12px 14px", borderBottom: "1px solid #F3F3EF", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14 }}>⚠️</span>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#888" }}>Order Manually</div>
              </div>
              {parsed.manual.map((line, i) => (
                <div key={i} style={{ padding: "10px 14px", borderBottom: i < parsed.manual.length - 1 ? "1px solid #F3F3EF" : "none", fontSize: 13, color: "#888", lineHeight: 1.4 }}>
                  {line}
                </div>
              ))}
            </div>
          )}

          {/* Grand total */}
          {parsed.orderTotal && (
            <div style={{ background: "#111", borderRadius: 12, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>💰 Total Order Cost</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>{parsed.orderTotal}</div>
            </div>
          )}
        </div>
      )}

      {/* Raw fallback if parsing failed but result exists */}
      {result && !parsed?.rd.length && !parsed?.sysco.length && (
        <div style={{ marginTop: 10, background: "#fff", border: "1px solid #EEEEE9", borderRadius: 12, padding: "14px" }}>
          <div style={{ fontSize: 13, lineHeight: 1.9, whiteSpace: "pre-wrap", color: "#111" }}>{result}</div>
        </div>
      )}

      {/* Quick reference — items from pasted list */}
      {matched.length > 0 && (
        <div style={{ marginTop: 20, paddingBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#999", letterSpacing: .5, marginBottom: 8, paddingLeft: 2 }}>PRICE REFERENCE</div>
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #EEEEE9", overflow: "hidden" }}>
            {matched.map((item, i) => {
              const rdP = item.rdPrice, scP = item.scPrice;
              const rdBest = rdP && scP ? rdP <= scP : !!rdP;
              const vendor = rdP && scP ? (rdBest ? "RD" : "Sysco") : rdP ? "RD" : "Sysco";
              const green = "#16A34A", blue = "#2563EB";
              return (
                <div key={item.id} style={{ display: "flex", alignItems: "center", padding: "11px 14px", borderBottom: i < matched.length - 1 ? "1px solid #F3F3EF" : "none", gap: 10 }}>
                  <div style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "#111" }}>{item.name}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: rdBest ? green : "#CCC", width: 56, textAlign: "right" }}>{rdP ? fmt(rdP) : "—"}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: !rdBest && scP ? blue : "#CCC", width: 56, textAlign: "right" }}>{scP ? fmt(scP) : "—"}</div>
                </div>
              );
            })}
            {/* Column headers pinned to bottom */}
            <div style={{ display: "flex", padding: "8px 14px", borderTop: "1px solid #EEEEE9", background: "#F7F7F5" }}>
              <div style={{ flex: 1 }} />
              <div style={{ fontSize: 10, fontWeight: 700, color: "#16A34A", width: 56, textAlign: "right", letterSpacing: .3 }}>RD</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#2563EB", width: 56, textAlign: "right", letterSpacing: .3 }}>SYSCO</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
