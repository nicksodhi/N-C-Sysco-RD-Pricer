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
  { id:"42606",   name:"Cauliflower",          emoji:"🥦", cat:"Produce"  },
  { id:"43431",   name:"Green Bell Peppers",   emoji:"🫑", cat:"Produce"  },
  { id:"42647",   name:"Mint",                 emoji:"🌿", cat:"Produce"  },
  { id:"55519",   name:"Orchid Flowers",       emoji:"💐", cat:"Produce"  },
  { id:"1530438", name:"Heavy Cream",          emoji:"🥛", cat:"Dairy"    },
  { id:"370496",  name:"Whole Milk",           emoji:"🥛", cat:"Dairy"    },
  { id:"14785",   name:"Plain Yogurt",         emoji:"🫙", cat:"Dairy"    },
  { id:"1440528", name:"Paneer",               emoji:"🧀", cat:"Dairy"    },
  { id:"1440203", name:"Cheddar Jack Cheese",  emoji:"🧀", cat:"Dairy"    },
  { id:"77200",   name:"Chicken Wings",        emoji:"🍗", cat:"Meat"     },
  { id:"77670",   name:"Chicken Leg Quarters", emoji:"🍗", cat:"Meat"     },
  { id:"77658",   name:"Chicken Leg Meat",     emoji:"🍗", cat:"Meat"     },
  { id:"77682",   name:"Chicken Thighs",       emoji:"🍗", cat:"Meat"     },
  { id:"77232",   name:"Chicken Breast",       emoji:"🍗", cat:"Meat"     },
  { id:"1810019", name:"Goat Bone-in",         emoji:"🥩", cat:"Meat"     },
  { id:"79042",   name:"Lamb Leg Halal",       emoji:"🥩", cat:"Meat"     },
  { id:"51457",   name:"Tilapia Fillets",      emoji:"🐟", cat:"Frozen"   },
  { id:"64046",   name:"Chopped Spinach",      emoji:"🥬", cat:"Frozen"   },
  { id:"64120",   name:"Broccoli Florets",     emoji:"🥦", cat:"Frozen"   },
  { id:"86527",   name:"Mixed Vegetables",     emoji:"🥦", cat:"Frozen"   },
  { id:"86525",   name:"Green Peas",           emoji:"🟢", cat:"Frozen"   },
  { id:"490266",  name:"Basmati Rice",         emoji:"🍚", cat:"Dry"      },
  { id:"490219",  name:"Sela Basmati Rice",    emoji:"🍚", cat:"Dry"      },
  { id:"53556",   name:"Atta Flour",           emoji:"🌾", cat:"Dry"      },
  { id:"2061212", name:"All Purpose Flour",    emoji:"🌾", cat:"Dry"      },
  { id:"21051",   name:"Granulated Sugar",     emoji:"🍬", cat:"Dry"      },
  { id:"1070496", name:"Salt",                 emoji:"🧂", cat:"Dry"      },
  { id:"29268",   name:"Baking Powder",        emoji:"🫙", cat:"Dry"      },
  { id:"2910159", name:"Cornstarch",           emoji:"🫙", cat:"Dry"      },
  { id:"16200",   name:"Garbanzo Beans",       emoji:"🫘", cat:"Dry"      },
  { id:"69810",   name:"Red Kidney Beans",     emoji:"🫘", cat:"Dry"      },
  { id:"860044",  name:"Tomato Sauce",         emoji:"🍅", cat:"Dry"      },
  { id:"860135",  name:"Diced Tomatoes",       emoji:"🍅", cat:"Dry"      },
  { id:"860043",  name:"Tomato Puree",         emoji:"🍅", cat:"Dry"      },
  { id:"2620442", name:"Coconut Milk",         emoji:"🥥", cat:"Dry"      },
  { id:"13417",   name:"Sambal Oelek",         emoji:"🌶️", cat:"Dry"      },
  { id:"25267",   name:"Eggplant Pulp",        emoji:"🍆", cat:"Dry"      },
  { id:"1020152", name:"Liquid Butter Alt",    emoji:"🧈", cat:"Liquids"  },
  { id:"55523",   name:"Lemon Juice",          emoji:"🍋", cat:"Liquids"  },
  { id:"1020079", name:"Canola Oil",           emoji:"🫙", cat:"Liquids"  },
  { id:"1020075", name:"Soybean Oil",          emoji:"🫙", cat:"Liquids"  },
  { id:"1020077", name:"Fry Oil",              emoji:"🫙", cat:"Liquids"  },
  { id:"45900",   name:"White Vinegar",        emoji:"🫙", cat:"Liquids"  },
  { id:"2550014", name:"Red Food Color",       emoji:"🔴", cat:"Liquids"  },
  { id:"2550012", name:"Yellow Food Color",    emoji:"🟡", cat:"Liquids"  },
  { id:"12728",   name:"Pan Spray",            emoji:"🥫", cat:"Other"    },
  { id:"21039",   name:"Evian Water",          emoji:"💧", cat:"Other"    },
  { id:"440039",  name:"Diet Coke 24pk",       emoji:"🥤", cat:"Other"    },
  { id:"440040",  name:"Sprite 4pk",           emoji:"🥤", cat:"Other"    },
  { id:"440038",  name:"Coca-Cola 24pk",       emoji:"🥤", cat:"Other"    },
];

const CATS = ["All","Produce","Dairy","Meat","Frozen","Dry","Liquids","Other"];

const NOW = new Date().toISOString();
const SEED_RD = {"14785":36.24,"370496":16.12,"1530438":43.95,"1440528":86.76,"1020077":36.68,"490266":57.62,"1020152":36.17,"21039":16.99,"79042":272.39,"44146":90.50,"77200":57.20,"1810019":77.47,"21051":19.07,"440039":17.94,"1020079":37.72,"42545":18.95,"42658":13.25,"42725":43.02,"42570":29.28,"79152":56.30,"55523":66.78,"2061212":32.81,"53556":39.10,"51457":32.23,"77670":86.76,"77658":32.81,"860044":31.51,"860135":26.18,"16200":41.47,"69810":36.05,"2910159":30.67,"29268":89.43,"25267":55.25,"64046":23.45,"64120":31.34,"86525":38.20,"86527":31.34,"44211":47.86,"12728":32.87,"2550014":17.32,"13417":39.29,"42566":15.11,"42513":29.75,"42504":40.25,"44137":39.29,"860043":41.47,"490219":39.10,"1440203":29.14,"2620442":64.32,"45900":88.37,"440038":17.32,"440040":23.45,"1070496":56.30,"2550012":47.86};
const SEED_SC = {"42545":11.31,"77682":76.30,"77670":26.05,"77658":61.67,"2061212":8.38,"860044":29.99,"1530438":43.87,"370496":16.48,"1020075":37.25,"21051":17.71,"1020077":35.51,"1020152":29.99,"55523":34.27,"42725":10.48};

function seedMap(s) { const m={}; for(const [id,price] of Object.entries(s)) m[id]={price,date:NOW}; return m; }
const fmt = n => n!=null ? "$"+n.toFixed(2) : "—";
const ago = d => { if(!d) return ""; const h=(Date.now()-new Date(d))/3600000; if(h<1) return "just now"; if(h<24) return Math.floor(h)+"h ago"; return Math.floor(h/24)+"d ago"; };
const STORE = {
  async get(k){try{const r=await window.storage.get(k,true);return r?.value?JSON.parse(r.value):null;}catch{return null;}},
  async set(k,v){try{await window.storage.set(k,JSON.stringify(v),true);}catch{}}
};

export default function App() {
  const [rd, setRd] = useState(seedMap(SEED_RD));
  const [sc, setSc] = useState(seedMap(SEED_SC));
  const [tab, setTab] = useState("compare");
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [lastSync, setLastSync] = useState(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    (async () => {
      const [a,b] = await Promise.all([STORE.get("nc_rd3"),STORE.get("nc_sc3")]);
      if(a) setRd(a); if(b) setSc(b);
      fetchServer();
    })();
    const t = setInterval(fetchServer, 5*60*1000);
    return () => clearInterval(t);
  }, []);

  async function fetchServer() {
    try {
      const r = await fetch("/api/prices"); if(!r.ok) return;
      const data = await r.json();
      if(data.rd && Object.keys(data.rd).length>0) setRd(prev=>{const m={...prev,...data.rd};STORE.set("nc_rd3",m);return m;});
      if(data.sysco && Object.keys(data.sysco).length>0) setSc(prev=>{const m={...prev,...data.sysco};STORE.set("nc_sc3",m);return m;});
      setLastSync(new Date().toISOString());
    } catch {}
  }

  async function triggerSync() {
    setSyncing(true);
    try { await fetch("/api/trigger"); } catch {}
    setTimeout(async()=>{ await fetchServer(); setSyncing(false); }, 90000);
  }

  const filtered = useMemo(() => ITEMS.filter(i => (cat==="All"||i.cat===cat) && (!q||i.name.toLowerCase().includes(q.toLowerCase()))), [cat,q]);

  const { compared, rdOnly } = useMemo(() => {
    const compared=[], rdOnly=[];
    filtered.forEach(item => {
      const r=rd[item.id]?.price, s=sc[item.id]?.price;
      if(!r&&!s) return;
      if(r&&s) compared.push(item); else if(r) rdOnly.push(item);
    });
    compared.sort((a,b)=>Math.abs((rd[b.id]?.price||0)-(sc[b.id]?.price||0))-Math.abs((rd[a.id]?.price||0)-(sc[a.id]?.price||0)));
    return {compared,rdOnly};
  },[filtered,rd,sc]);

  const rdWins = compared.filter(i=>(rd[i.id]?.price||Infinity)<=(sc[i.id]?.price||Infinity)).length;
  const scWins = compared.length-rdWins;
  const totalDiff = compared.reduce((s,i)=>s+Math.abs((rd[i.id]?.price||0)-(sc[i.id]?.price||0)),0);

  const S = {
    wrap:{ minHeight:"100vh", background:"#080810", color:"#f0ece4", fontFamily:"'DM Sans',system-ui,sans-serif", maxWidth:480, margin:"0 auto", paddingBottom:90 },
    header:{ padding:"20px 16px 0", position:"sticky", top:0, background:"rgba(8,8,16,.96)", backdropFilter:"blur(20px)", zIndex:50 },
    statBox:(color)=>({ background:`rgba(${color},.1)`, border:`1px solid rgba(${color},.2)`, borderRadius:12, padding:"10px 8px", textAlign:"center" }),
    card:{ background:"#0f0f1a", border:"1px solid #1a1a2e", borderRadius:16, padding:"14px", marginBottom:8, transition:"transform .15s" },
    vendorBox:(win)=>({ flex:1, background:win?"rgba(74,222,128,.08)":"rgba(255,255,255,.03)", border:win?"1px solid rgba(74,222,128,.2)":"1px solid rgba(255,255,255,.06)", borderRadius:12, padding:"12px 10px", position:"relative" }),
    vendorBoxSc:(win)=>({ flex:1, background:win?"rgba(96,165,250,.08)":"rgba(255,255,255,.03)", border:win?"1px solid rgba(96,165,250,.2)":"1px solid rgba(255,255,255,.06)", borderRadius:12, padding:"12px 10px", position:"relative" }),
  };

  return (
    <div style={S.wrap}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Syne:wght@700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{display:none;}
        input,button,textarea{font-family:inherit;}
        @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        .fu{animation:fadeUp .25s ease both;}
        @keyframes spin{to{transform:rotate(360deg)}}
        .spin{display:inline-block;animation:spin .8s linear infinite;}
      `}</style>

      {/* HEADER */}
      <div style={S.header}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div>
            <div style={{fontFamily:"Syne",fontSize:20,fontWeight:800,letterSpacing:-0.5,lineHeight:1}}>🍛 Naan & Curry</div>
            <div style={{fontSize:10,color:"rgba(240,236,228,.35)",marginTop:3,letterSpacing:1}}>PRICE INTELLIGENCE · LAS VEGAS</div>
          </div>
          <button onClick={triggerSync} style={{background:"rgba(240,236,228,.06)",border:"1px solid rgba(240,236,228,.1)",color:lastSync?"#4ade80":"rgba(240,236,228,.4)",borderRadius:10,padding:"8px 12px",fontSize:11,fontWeight:700,cursor:"pointer",letterSpacing:.5}}>
            {syncing ? <span className="spin">⟳</span> : "⟳"} {syncing?"Syncing…":lastSync?"Synced":"Sync"}
          </button>
        </div>

        {/* Stats */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
          <div style={S.statBox("74,222,128")}>
            <div style={{fontFamily:"Syne",fontSize:22,fontWeight:800,color:"#4ade80",lineHeight:1}}>{rdWins}</div>
            <div style={{fontSize:9,color:"rgba(74,222,128,.6)",letterSpacing:.5,marginTop:2,fontWeight:700}}>RD WINS</div>
          </div>
          <div style={S.statBox("96,165,250")}>
            <div style={{fontFamily:"Syne",fontSize:22,fontWeight:800,color:"#60a5fa",lineHeight:1}}>{scWins}</div>
            <div style={{fontSize:9,color:"rgba(96,165,250,.6)",letterSpacing:.5,marginTop:2,fontWeight:700}}>SYSCO WINS</div>
          </div>
          <div style={S.statBox("251,191,36")}>
            <div style={{fontFamily:"Syne",fontSize:22,fontWeight:800,color:"#fbbf24",lineHeight:1}}>${totalDiff.toFixed(0)}</div>
            <div style={{fontSize:9,color:"rgba(251,191,36,.6)",letterSpacing:.5,marginTop:2,fontWeight:700}}>DIFF $</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{display:"flex",background:"rgba(255,255,255,.04)",borderRadius:10,padding:3,marginBottom:12}}>
          {[["compare","⚖️  Compare"],["order","🛒  Order List"]].map(([id,lbl])=>(
            <button key={id} onClick={()=>setTab(id)} style={{flex:1,padding:"9px",border:"none",background:tab===id?"rgba(240,236,228,.1)":"transparent",color:tab===id?"#f0ece4":"rgba(240,236,228,.4)",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer",letterSpacing:.5,transition:"all .15s"}}>{lbl}</button>
          ))}
        </div>

        {/* Search */}
        {tab==="compare" && (
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="🔍  Search items…"
            style={{width:"100%",background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",borderRadius:12,padding:"11px 16px",color:"#f0ece4",fontSize:14,outline:"none",marginBottom:4}} />
        )}
        <div style={{height:4}} />
      </div>

      {/* COMPARE TAB */}
      {tab==="compare" && (
        <div style={{padding:"0 12px"}}>
          {/* Category pills */}
          <div style={{display:"flex",gap:6,overflowX:"auto",padding:"12px 0 10px",scrollbarWidth:"none"}}>
            {CATS.map(c=>(
              <button key={c} onClick={()=>setCat(c)} style={{whiteSpace:"nowrap",padding:"6px 14px",borderRadius:99,border:"none",background:cat===c?"#f0ece4":"rgba(255,255,255,.07)",color:cat===c?"#080810":"rgba(240,236,228,.55)",fontSize:12,fontWeight:700,cursor:"pointer",letterSpacing:.3,transition:"all .15s",flexShrink:0}}>{c}</button>
            ))}
          </div>

          {/* Compared items */}
          {compared.length>0 && (
            <>
              <div style={{fontSize:9,color:"rgba(240,236,228,.3)",letterSpacing:1.5,fontWeight:700,marginBottom:10,marginTop:2}}>⚖️  HEAD-TO-HEAD · {compared.length} ITEMS</div>
              {compared.map((item,i)=>{
                const r=rd[item.id]?.price, s=sc[item.id]?.price;
                const rdWin=r<=s, diff=Math.abs(r-s), pct=Math.round(diff/Math.max(r,s)*100);
                return (
                  <div key={item.id} className="fu" style={{...S.card,animationDelay:i*25+"ms"}}>
                    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                      <span style={{fontSize:22}}>{item.emoji}</span>
                      <div style={{flex:1}}>
                        <div style={{fontSize:14,fontWeight:700}}>{item.name}</div>
                        {diff>0&&<div style={{fontSize:11,color:"#fbbf24",marginTop:1,fontWeight:600}}>Save ${diff.toFixed(2)} · {pct}% cheaper at {rdWin?"RD":"Sysco"}</div>}
                      </div>
                      <div style={{fontSize:10,fontWeight:700,padding:"4px 10px",borderRadius:99,background:rdWin?"rgba(74,222,128,.15)":"rgba(96,165,250,.15)",color:rdWin?"#4ade80":"#60a5fa",letterSpacing:.5}}>{rdWin?"🏪 RD":"🚚 SYSCO"}</div>
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      <div style={S.vendorBox(rdWin)}>
                        {rdWin&&<div style={{position:"absolute",top:5,right:8,fontSize:8,color:"#4ade80",fontWeight:800,letterSpacing:.5}}>✓ BEST</div>}
                        <div style={{fontSize:9,color:"rgba(240,236,228,.4)",fontWeight:700,letterSpacing:.5,marginBottom:4}}>🏪 REST. DEPOT</div>
                        <div style={{fontFamily:"Syne",fontSize:24,fontWeight:800,color:rdWin?"#4ade80":"#f0ece4",lineHeight:1}}>{fmt(r)}</div>
                        <div style={{fontSize:9,color:"rgba(240,236,228,.3)",marginTop:3}}>case price · in-store</div>
                      </div>
                      <div style={S.vendorBoxSc(!rdWin)}>
                        {!rdWin&&<div style={{position:"absolute",top:5,right:8,fontSize:8,color:"#60a5fa",fontWeight:800,letterSpacing:.5}}>✓ BEST</div>}
                        <div style={{fontSize:9,color:"rgba(240,236,228,.4)",fontWeight:700,letterSpacing:.5,marginBottom:4}}>🚚 SYSCO</div>
                        <div style={{fontFamily:"Syne",fontSize:24,fontWeight:800,color:!rdWin?"#60a5fa":"#f0ece4",lineHeight:1}}>{fmt(s)}</div>
                        <div style={{fontSize:9,color:"rgba(240,236,228,.3)",marginTop:3}}>case price · CS</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* RD Only */}
          {rdOnly.length>0 && (
            <>
              <div style={{fontSize:9,color:"rgba(240,236,228,.3)",letterSpacing:1.5,fontWeight:700,margin:"16px 0 10px"}}>🟢  RESTAURANT DEPOT ONLY · {rdOnly.length} ITEMS</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                {rdOnly.map((item,i)=>(
                  <div key={item.id} className="fu" style={{background:"#0f0f1a",border:"1px solid #1a1a2e",borderRadius:14,padding:"14px 12px",animationDelay:i*20+"ms"}}>
                    <div style={{fontSize:22,marginBottom:6}}>{item.emoji}</div>
                    <div style={{fontSize:13,fontWeight:600,lineHeight:1.25,marginBottom:8,color:"rgba(240,236,228,.9)"}}>{item.name}</div>
                    <div style={{fontFamily:"Syne",fontSize:20,fontWeight:800,color:"#4ade80"}}>{fmt(rd[item.id]?.price)}</div>
                    <div style={{fontSize:9,color:"rgba(74,222,128,.5)",marginTop:2,fontWeight:700,letterSpacing:.5}}>RD ONLY</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {compared.length===0&&rdOnly.length===0&&(
            <div style={{textAlign:"center",padding:"60px 20px",color:"rgba(240,236,228,.3)"}}>
              <div style={{fontSize:48,marginBottom:12}}>🔍</div>
              <div style={{fontSize:16,fontWeight:700}}>No items found</div>
              <div style={{fontSize:13,marginTop:6,color:"rgba(240,236,228,.2)"}}>Try a different search or category</div>
            </div>
          )}
        </div>
      )}

      {/* ORDER TAB */}
      {tab==="order" && <OrderTab rd={rd} sc={sc} />}

      {/* BOTTOM NAV */}
      <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,background:"rgba(8,8,16,.97)",backdropFilter:"blur(24px)",borderTop:"1px solid #1a1a2e",display:"flex",zIndex:100,paddingBottom:"env(safe-area-inset-bottom)"}}>
        {[["compare","⚖️","Compare"],["order","🛒","Order"]].map(([id,icon,lbl])=>(
          <button key={id} onClick={()=>setTab(id)} style={{flex:1,padding:"12px 8px 14px",border:"none",background:"transparent",color:tab===id?"#f0ece4":"rgba(240,236,228,.3)",cursor:"pointer",transition:"color .15s"}}>
            <div style={{fontSize:22,marginBottom:2}}>{icon}</div>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:.5}}>{lbl}</div>
          </button>
        ))}
      </div>

      {lastSync && <div style={{textAlign:"center",fontSize:10,color:"rgba(240,236,228,.2)",padding:"6px 0 16px",letterSpacing:.5}}>Prices updated {ago(lastSync)}</div>}
    </div>
  );
}

function OrderTab({ rd, sc }) {
  const [list, setList] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);

  async function run() {
    if(!list.trim()) return;
    setLoading(true); setResult("");
    try {
      const r = await fetch("/api/grocery",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({list})});
      const d = await r.json();
      setResult(d.result||"Error");
    } catch(e) { setResult("❌ "+e.message); }
    setLoading(false);
  }

  const compared = ITEMS.filter(i=>rd[i.id]&&sc[i.id]).slice(0,10);

  return (
    <div style={{padding:"16px 16px 0"}}>
      <div style={{fontFamily:"Syne",fontSize:20,fontWeight:800,marginBottom:4}}>Order Breakdown</div>
      <div style={{fontSize:13,color:"rgba(240,236,228,.45)",marginBottom:18,lineHeight:1.6}}>Paste your order list — we'll split it by vendor and show you where to save.</div>

      <textarea value={list} onChange={e=>setList(e.target.value)}
        placeholder={"Type or paste your order:\n\n5 cases chicken leg quarters\n3 yellow onions\n2 heavy cream\n10 russet potato..."}
        style={{width:"100%",minHeight:150,background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",borderRadius:14,padding:"14px",color:"#f0ece4",fontSize:14,lineHeight:1.6,resize:"vertical",outline:"none",fontFamily:"inherit"}}
      />

      <button onClick={run} disabled={loading||!list.trim()} style={{width:"100%",marginTop:10,padding:"15px",border:"none",borderRadius:14,background:loading||!list.trim()?"rgba(255,255,255,.07)":"#f0ece4",color:loading||!list.trim()?"rgba(240,236,228,.3)":"#080810",fontSize:15,fontWeight:700,cursor:loading||!list.trim()?"default":"pointer",transition:"all .2s",letterSpacing:.3}}>
        {loading?"⟳ Analyzing…":"🛒 Get Vendor Breakdown"}
      </button>

      {result && (
        <div style={{marginTop:16,background:"#0f0f1a",border:"1px solid #1a1a2e",borderRadius:14,padding:"16px"}}>
          <div style={{fontSize:13,lineHeight:1.9,whiteSpace:"pre-wrap",color:"rgba(240,236,228,.9)"}}>{result}</div>
        </div>
      )}

      {/* Quick wins */}
      <div style={{marginTop:24}}>
        <div style={{fontSize:9,color:"rgba(240,236,228,.3)",letterSpacing:1.5,fontWeight:700,marginBottom:12}}>💡 QUICK PRICE REFERENCE</div>
        {compared.map(item=>{
          const r=rd[item.id]?.price, s=sc[item.id]?.price, rdWin=r<=s;
          return (
            <div key={item.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:"#0f0f1a",border:"1px solid #1a1a2e",borderRadius:11,marginBottom:6}}>
              <span style={{fontSize:18}}>{item.emoji}</span>
              <div style={{flex:1,fontSize:13,fontWeight:600}}>{item.name}</div>
              <div style={{fontSize:10,fontWeight:700,padding:"3px 9px",borderRadius:99,background:rdWin?"rgba(74,222,128,.12)":"rgba(96,165,250,.12)",color:rdWin?"#4ade80":"#60a5fa"}}>{rdWin?"🏪 RD":"🚚 SYSCO"}</div>
              <div style={{fontFamily:"Syne",fontSize:15,fontWeight:800,color:rdWin?"#4ade80":"#60a5fa",minWidth:52,textAlign:"right"}}>{fmt(Math.min(r,s))}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
