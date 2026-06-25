
import { useState, useEffect, useCallback } from "react";

// ── STORAGE (localStorage for web export) ──────────────────────────────
const KEYS = {
  clientes:"sc_clientes",contratos:"sc_contratos",assinaturas:"sc_assinaturas",
  receber:"sc_receber",pagar:"sc_pagar",lancamentos:"sc_lancamentos",
  bancos:"sc_bancos",cartoes:"sc_cartoes"
};
const load = (k) => { try { const v = localStorage.getItem(KEYS[k]); return v ? JSON.parse(v) : []; } catch { return []; } };
const persist = (k, d) => { try { localStorage.setItem(KEYS[k], JSON.stringify(d)); } catch {} };

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);
const fmt = (v) => "R$ " + Number(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const today = () => new Date().toISOString().slice(0,10);

// ── THEME ──────────────────────────────────────────────────────────────
const css = `
  *{box-sizing:border-box;margin:0;padding:0}
  :root{
    --bg:#0d0d0d;--bg2:#141414;--bg3:#1a1a1a;--bg4:#222;
    --border:#2a2a2a;
    --orange:#E87520;--orange-d:#B85A10;--orange-l:#F5993A;
    --og:rgba(232,117,32,.12);--ob:rgba(232,117,32,.3);
    --text:#F0EDE8;--text2:#A09080;--text3:#6B5A4A;
    --green:#2ECC71;--red:#E74C3C;--blue:#5BA3E8;
  }
  body{font-family:system-ui,sans-serif;font-size:14px;color:var(--text);background:var(--bg);height:100vh;overflow:hidden}
  #root{height:100vh}
  .app{display:flex;height:100vh}
  /* SIDEBAR */
  .sb{width:220px;min-width:220px;background:var(--bg2);border-right:1px solid var(--ob);display:flex;flex-direction:column}
  .sb-logo{padding:16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px}
  .sb-logo img{width:32px;height:32px;object-fit:contain;filter:drop-shadow(0 0 6px rgba(232,117,32,.5))}
  .sb-name{font-size:13px;font-weight:500}
  .sb-sub{font-size:10px;color:var(--orange);text-transform:uppercase;letter-spacing:.5px}
  .nav-g{padding-top:4px}
  .nav-lbl{font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;padding:10px 14px 3px}
  .ni{display:flex;align-items:center;gap:8px;padding:7px 14px;cursor:pointer;font-size:12.5px;color:var(--text2);border:none;background:none;width:100%;text-align:left;border-left:2px solid transparent;transition:all .15s}
  .ni:hover{background:var(--og);color:var(--text);border-left-color:var(--orange-d)}
  .ni.act{background:var(--og);color:var(--orange-l);border-left-color:var(--orange);font-weight:500}
  /* MAIN */
  .main{flex:1;overflow-y:auto;padding:22px;background:var(--bg)}
  .ph{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;padding-bottom:14px;border-bottom:1px solid var(--border)}
  .pt{font-size:18px;font-weight:500}
  .pt span{color:var(--orange-l)}
  /* BUTTONS */
  .btn{display:inline-flex;align-items:center;gap:5px;padding:7px 14px;border-radius:6px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:12.5px;cursor:pointer;transition:all .15s}
  .btn:hover{border-color:var(--orange-d);background:var(--og);color:var(--orange-l)}
  .btn-p{background:var(--orange);border-color:var(--orange);color:#0d0d0d;font-weight:500}
  .btn-p:hover{background:var(--orange-l);border-color:var(--orange-l);color:#0d0d0d}
  .btn-d{border-color:#5a1a1a;background:rgba(231,76,60,.08);color:var(--red)}
  .btn-d:hover{background:rgba(231,76,60,.2)}
  .btn-s{border-color:#1a4a2a;background:rgba(46,204,113,.08);color:var(--green)}
  .btn-sm{padding:4px 8px;font-size:11px}
  /* CARDS */
  .card{background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:16px;position:relative;overflow:hidden}
  .card:before{content:"";position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--ob),transparent)}
  /* METRICS */
  .mgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:18px}
  .met{background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:14px}
  .met-l{font-size:10px;color:var(--text2);margin-bottom:5px;text-transform:uppercase;letter-spacing:.5px}
  .met-v{font-size:20px;font-weight:500}
  .c-green{color:var(--green)}.c-red{color:var(--red)}.c-orange{color:var(--orange-l)}.c-blue{color:var(--blue)}
  /* TABLE */
  table{width:100%;border-collapse:collapse}
  th{text-align:left;font-size:10px;font-weight:500;color:var(--text3);padding:8px 12px;border-bottom:1px solid var(--border);text-transform:uppercase;letter-spacing:.5px}
  td{padding:9px 12px;border-bottom:1px solid var(--border);font-size:12.5px;color:var(--text);vertical-align:middle}
  tr:last-child td{border-bottom:none}
  tr:hover td{background:var(--og)}
  .muted{color:var(--text2)}
  .tiny{font-size:11px;color:var(--text3)}
  /* BADGES */
  .bdg{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:500;border:1px solid}
  .bdg-g{background:rgba(46,204,113,.1);color:var(--green);border-color:rgba(46,204,113,.25)}
  .bdg-r{background:rgba(231,76,60,.1);color:var(--red);border-color:rgba(231,76,60,.25)}
  .bdg-a{background:rgba(232,117,32,.1);color:var(--orange-l);border-color:rgba(232,117,32,.25)}
  .bdg-b{background:rgba(91,163,232,.1);color:var(--blue);border-color:rgba(91,163,232,.25)}
  .bdg-x{background:rgba(160,144,128,.08);color:var(--text2);border-color:var(--border)}
  /* MODAL */
  .mover{position:fixed;inset:0;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;z-index:1000}
  .mbox{background:var(--bg2);border:1px solid var(--ob);border-radius:10px;padding:24px;width:540px;max-width:95vw;max-height:85vh;overflow-y:auto;box-shadow:0 0 40px rgba(232,117,32,.12)}
  .mtitle{font-size:15px;font-weight:500;margin-bottom:18px;color:var(--orange-l);display:flex;align-items:center;gap:8px}
  .mtitle:before{content:"";display:block;width:3px;height:16px;background:var(--orange);border-radius:2px}
  .fgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .fg{display:flex;flex-direction:column;gap:5px}
  .fg label{font-size:10px;color:var(--text2);font-weight:500;text-transform:uppercase;letter-spacing:.4px}
  .fg input,.fg select,.fg textarea{padding:8px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:13px;font-family:inherit;outline:none;transition:border .15s}
  .fg input:focus,.fg select:focus,.fg textarea:focus{border-color:var(--orange)}
  .fg select option{background:var(--bg3)}
  .fg textarea{resize:vertical;min-height:60px}
  .mact{display:flex;gap:8px;justify-content:flex-end;margin-top:18px;padding-top:14px;border-bottom:none;border-top:1px solid var(--border)}
  /* TABS */
  .tabs{display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:16px}
  .tab{padding:8px 16px;font-size:12.5px;cursor:pointer;color:var(--text2);border-bottom:2px solid transparent;background:none;border-top:none;border-left:none;border-right:none;transition:all .15s}
  .tab:hover{color:var(--text);background:var(--og)}
  .tab.act{color:var(--orange-l);border-bottom-color:var(--orange);font-weight:500}
  /* MISC */
  .two{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
  .stitle{font-size:13px;font-weight:500;margin-bottom:12px;display:flex;align-items:center;gap:6px}
  .pbar{background:var(--bg4);border-radius:999px;height:6px;overflow:hidden;border:1px solid var(--border)}
  .pfill{height:100%;border-radius:999px;background:var(--orange);transition:width .3s}
  .pfill-r{background:var(--red)}.pfill-a{background:var(--orange-d)}
  .empty{text-align:center;padding:36px;color:var(--text3)}
  .sbar{display:flex;align-items:center;gap:8px;margin-bottom:16px}
  .sbar input{flex:1;padding:8px 12px;border-radius:6px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:13px;outline:none}
  .sbar input:focus{border-color:var(--orange)}
  .cbrow{display:flex;align-items:center;gap:8px;font-size:12px;margin-bottom:8px}
  .cblbl{width:85px;text-align:right;font-size:11px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cbout{flex:1;background:var(--bg4);border-radius:999px;height:12px;overflow:hidden;border:1px solid var(--border)}
  .cbin{height:100%;border-radius:999px;background:var(--orange)}
  .cbval{width:80px;font-weight:500;font-size:11px}
  .actions{display:flex;gap:4px}
  .span2{grid-column:1/-1}
`;

// ── STATUS BADGE ───────────────────────────────────────────────────────
const badgeClass = {Ativo:"bdg-g",Ativa:"bdg-g",Pago:"bdg-g",Inativo:"bdg-x",Inativa:"bdg-x",Cancelado:"bdg-x",Cancelada:"bdg-x",Encerrado:"bdg-x",Pendente:"bdg-a",Prospect:"bdg-a","Em negociação":"bdg-a",Suspensa:"bdg-a",Pausado:"bdg-a",Vencido:"bdg-r",Inadimplente:"bdg-r"};
const Badge = ({s}) => <span className={`bdg ${badgeClass[s]||"bdg-x"}`}>{s}</span>;

// ── MODAL ──────────────────────────────────────────────────────────────
const Modal = ({title,onClose,children}) => (
  <div className="mover" onClick={e=>e.target.className==="mover"&&onClose()}>
    <div className="mbox">
      <div className="mtitle">{title}</div>
      {children}
    </div>
  </div>
);

// ── LOGO (SVG fallback, keeps the orange circle+target icon) ───────────
const LogoIcon = () => (
  <svg width="32" height="32" viewBox="0 0 100 100" fill="none">
    <circle cx="50" cy="45" r="38" stroke="#E87520" strokeWidth="7"/>
    <circle cx="50" cy="45" r="22" stroke="#F5993A" strokeWidth="6"/>
    <circle cx="50" cy="45" r="8" fill="#E87520"/>
    <line x1="50" y1="45" x2="78" y2="24" stroke="#F5993A" strokeWidth="6" strokeLinecap="round"/>
    <polygon points="78,14 84,30 68,24" fill="#E87520"/>
    <rect x="44" y="78" width="12" height="16" rx="3" fill="#E87520"/>
    <rect x="36" y="92" width="28" height="7" rx="3" fill="#B85A10"/>
  </svg>
);

// ── MAIN APP ───────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState("dashboard");
  const [db, setDb] = useState({ clientes:[], contratos:[], assinaturas:[], receber:[], pagar:[], lancamentos:[], bancos:[], cartoes:[] });
  const [modal, setModal] = useState(null); // {type, data}
  const [search, setSearch] = useState("");
  const [tabs, setTabs] = useState({receber:"todos",pagar:"todos",lanc:"todos"});

  useEffect(() => {
    setDb({ clientes:load("clientes"), contratos:load("contratos"), assinaturas:load("assinaturas"), receber:load("receber"), pagar:load("pagar"), lancamentos:load("lancamentos"), bancos:load("bancos"), cartoes:load("cartoes") });
  }, []);

  const update = (key, arr) => {
    setDb(d => { const n = {...d, [key]: arr}; persist(key, arr); return n; });
  };
  const upsert = (key, item) => {
    const arr = db[key];
    const i = arr.findIndex(x => x.id === item.id);
    const next = i >= 0 ? arr.map((x,j) => j===i ? item : x) : [...arr, item];
    update(key, next);
  };
  const del = (key, id) => { if(!confirm("Excluir?")) return; update(key, db[key].filter(x=>x.id!==id)); };
  const getCN = id => { const c = db.clientes.find(x=>x.id===id); return c?c.nome:id||"-"; };
  const getBN = id => { const b = db.bancos.find(x=>x.id===id); return b?b.nome:"-"; };

  const navItems = [
    {g:"Visão geral", items:[{id:"dashboard",icon:"ti-layout-dashboard",l:"Dashboard"},{id:"relatorios",icon:"ti-chart-bar",l:"Relatórios"}]},
    {g:"Cadastros", items:[{id:"clientes",icon:"ti-users",l:"Clientes"},{id:"contratos",icon:"ti-file-text",l:"Contratos"},{id:"assinaturas",icon:"ti-refresh",l:"Assinaturas CRM"}]},
    {g:"Financeiro", items:[{id:"receber",icon:"ti-arrow-down-circle",l:"Contas a receber"},{id:"pagar",icon:"ti-arrow-up-circle",l:"Contas a pagar"},{id:"lancamentos",icon:"ti-list",l:"Lançamentos"}]},
    {g:"Patrimônio", items:[{id:"bancos",icon:"ti-building-bank",l:"Contas bancárias"},{id:"cartoes",icon:"ti-credit-card",l:"Cartões"}]},
  ];

  return (
    <>
      <style>{css}</style>
      <div className="app">
        {/* SIDEBAR */}
        <nav className="sb">
          <div className="sb-logo">
            <LogoIcon/>
            <div><div className="sb-name">Scope Company</div><div className="sb-sub">Finance</div></div>
          </div>
          {navItems.map(({g,items}) => (
            <div className="nav-g" key={g}>
              <div className="nav-lbl">{g}</div>
              {items.map(({id,icon,l}) => (
                <button key={id} className={`ni${page===id?" act":""}`} onClick={()=>setPage(id)}>
                  <i className={`ti ${icon}`} aria-hidden="true"/>
                  {l}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* MAIN */}
        <main className="main">
          {page==="dashboard" && <Dashboard db={db} today={today} getCN={getCN} fmt={fmt}/>}
          {page==="clientes" && <Clientes db={db} del={del} upsert={upsert} update={update} search={search} setSearch={setSearch} modal={modal} setModal={setModal} fmt={fmt}/>}
          {page==="contratos" && <Contratos db={db} del={del} upsert={upsert} modal={modal} setModal={setModal} fmt={fmt} getCN={getCN}/>}
          {page==="assinaturas" && <Assinaturas db={db} del={del} upsert={upsert} modal={modal} setModal={setModal} fmt={fmt} getCN={getCN}/>}
          {page==="receber" && <Receber db={db} del={del} upsert={upsert} update={update} modal={modal} setModal={setModal} fmt={fmt} getCN={getCN} today={today} tabs={tabs} setTabs={setTabs}/>}
          {page==="pagar" && <Pagar db={db} del={del} upsert={upsert} modal={modal} setModal={setModal} fmt={fmt} today={today} tabs={tabs} setTabs={setTabs}/>}
          {page==="lancamentos" && <Lancamentos db={db} del={del} update={update} upsert={upsert} modal={modal} setModal={setModal} fmt={fmt} getBN={getBN} today={today} tabs={tabs} setTabs={setTabs}/>}
          {page==="bancos" && <Bancos db={db} del={del} upsert={upsert} modal={modal} setModal={setModal} fmt={fmt}/>}
          {page==="cartoes" && <Cartoes db={db} del={del} upsert={upsert} modal={modal} setModal={setModal} fmt={fmt}/>}
          {page==="relatorios" && <Relatorios db={db} fmt={fmt} getCN={getCN}/>}
        </main>
      </div>
    </>
  );
}

// ── DASHBOARD ──────────────────────────────────────────────────────────
function Dashboard({db,today,getCN,fmt}) {
  const t = today();
  const saldo = db.bancos.reduce((a,b)=>a+Number(b.saldo||0),0);
  const aRec = db.receber.filter(r=>r.status==="Pendente").reduce((a,b)=>a+Number(b.valor||0),0);
  const aPag = db.pagar.filter(r=>r.status==="Pendente").reduce((a,b)=>a+Number(b.valor||0),0);
  const mrr = db.assinaturas.filter(a=>a.status==="Ativa").reduce((a,b)=>a+Number(b.valor||0),0);
  const vR = db.receber.filter(r=>r.status==="Pendente"&&r.venc<t).length;
  const vP = db.pagar.filter(r=>r.status==="Pendente"&&r.venc<t).length;
  const metrics = [
    {l:"Saldo total",v:fmt(saldo),c:"c-blue"},{l:"A receber",v:fmt(aRec),c:"c-green"},
    {l:"A pagar",v:fmt(aPag),c:"c-red"},{l:"MRR",v:fmt(mrr),c:"c-orange"},
    {l:"Clientes ativos",v:db.clientes.filter(c=>c.status==="Ativo").length,c:""},
    {l:"Venc. receber",v:vR,c:vR>0?"c-red":""},{l:"Venc. pagar",v:vP,c:vP>0?"c-red":""},
    {l:"Contratos ativos",v:db.contratos.filter(c=>c.status==="Ativo").length,c:""},
  ];
  const p5r = db.receber.filter(r=>r.status==="Pendente").sort((a,b)=>a.venc>b.venc?1:-1).slice(0,5);
  const p5p = db.pagar.filter(r=>r.status==="Pendente").sort((a,b)=>a.venc>b.venc?1:-1).slice(0,5);
  return (
    <>
      <div className="ph"><div className="pt"><span>⬡ </span>Dashboard</div><span className="tiny">{new Date().toLocaleDateString("pt-BR",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</span></div>
      <div className="mgrid">{metrics.map(m=><div className="met" key={m.l}><div className="met-l">{m.l}</div><div className={`met-v ${m.c}`}>{m.v}</div></div>)}</div>
      <div className="two">
        <div className="card"><div className="stitle"><i className="ti ti-arrow-down-circle c-green"/>Próximos recebimentos</div>
          {p5r.length ? <table><tbody>{p5r.map(r=><tr key={r.id}><td style={{maxWidth:90,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{getCN(r.cliente)}</td><td className="c-green" style={{fontWeight:500}}>{fmt(r.valor)}</td><td className="tiny">{r.venc||"-"}</td></tr>)}</tbody></table> : <div className="empty">Sem pendências</div>}
        </div>
        <div className="card"><div className="stitle"><i className="ti ti-arrow-up-circle c-red"/>Próximos pagamentos</div>
          {p5p.length ? <table><tbody>{p5p.map(r=><tr key={r.id}><td style={{maxWidth:90,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.forn}</td><td className="c-red" style={{fontWeight:500}}>{fmt(r.valor)}</td><td className="tiny">{r.venc||"-"}</td></tr>)}</tbody></table> : <div className="empty">Sem pendências</div>}
        </div>
      </div>
      <div className="two">
        <div className="card"><div className="stitle"><i className="ti ti-building-bank c-orange"/>Saldo nas contas</div>
          {db.bancos.length ? <table><tbody>{db.bancos.map(b=><tr key={b.id}><td>{b.nome}</td><td className="c-green" style={{fontWeight:500}}>{fmt(b.saldo)}</td></tr>)}</tbody></table> : <div className="empty">Nenhuma conta</div>}
        </div>
        <div className="card"><div className="stitle"><i className="ti ti-credit-card c-orange"/>Limite de cartões</div>
          {db.cartoes.length ? db.cartoes.map(c=>{const pct=Math.min(100,Math.round((Number(c.usado||0)/Number(c.limite||1))*100));const cl=pct>80?"pfill-r":pct>60?"pfill-a":"";return(<div key={c.id} style={{marginBottom:12}}><div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:4,color:"var(--text2)"}}><span>{c.nome}</span><span style={{color:"var(--text)"}}>{fmt(c.usado)} / {fmt(c.limite)}</span></div><div className="pbar"><div className={`pfill ${cl}`} style={{width:pct+"%"}}/></div></div>);}) : <div className="empty">Nenhum cartão</div>}
        </div>
      </div>
    </>
  );
}

// ── FORM FIELD ─────────────────────────────────────────────────────────
const Field = ({label,span,children}) => <div className={`fg${span?" span2":""}`}><label>{label}</label>{children}</div>;

// ── CLIENTES ───────────────────────────────────────────────────────────
function Clientes({db,del,upsert,search,setSearch,modal,setModal,fmt}) {
  const [form,setForm] = useState({});
  const open = (d={}) => { setForm(d.id?d:{status:"Ativo",tipo:"Pessoa Física"}); setModal("cliente"); };
  const save = () => {
    if(!form.nome){alert("Nome obrigatório");return;}
    upsert("clientes",{...form,id:form.id||uid()});
    setModal(null);
  };
  const list = db.clientes.filter(c=>!search||c.nome?.toLowerCase().includes(search.toLowerCase())||(c.email||"").toLowerCase().includes(search.toLowerCase()));
  return(
    <>
      <div className="ph"><div className="pt"><span>⬡ </span>Clientes</div><button className="btn btn-p" onClick={()=>open()}><i className="ti ti-plus"/>Novo cliente</button></div>
      <div className="sbar"><i className="ti ti-search muted"/><input placeholder="Buscar..." value={search} onChange={e=>setSearch(e.target.value)}/><span className="tiny">{list.length} cliente(s)</span></div>
      <div className="card"><table><thead><tr><th>Nome</th><th>Tipo</th><th>Email</th><th>Telefone</th><th>Status</th><th>Ações</th></tr></thead><tbody>
        {!list.length && <tr><td colSpan={6}><div className="empty">Nenhum cliente cadastrado</div></td></tr>}
        {list.map(c=><tr key={c.id}><td><strong>{c.nome}</strong>{c.doc&&<><br/><span className="tiny">{c.doc}</span></>}</td><td className="muted">{c.tipo||"-"}</td><td className="muted">{c.email||"-"}</td><td className="muted">{c.tel||"-"}</td><td><Badge s={c.status||"Ativo"}/></td><td><div className="actions"><button className="btn btn-sm" onClick={()=>open(c)}><i className="ti ti-edit"/></button><button className="btn btn-sm btn-d" onClick={()=>del("clientes",c.id)}><i className="ti ti-trash"/></button></div></td></tr>)}
      </tbody></table></div>
      {modal==="cliente" && <Modal title="Cliente" onClose={()=>setModal(null)}>
        <div className="fgrid">
          <Field label="Nome *"><input value={form.nome||""} onChange={e=>setForm(f=>({...f,nome:e.target.value}))} placeholder="Nome completo"/></Field>
          <Field label="Tipo"><select value={form.tipo||"Pessoa Física"} onChange={e=>setForm(f=>({...f,tipo:e.target.value}))}><option>Pessoa Física</option><option>Pessoa Jurídica</option></select></Field>
          <Field label="CPF/CNPJ"><input value={form.doc||""} onChange={e=>setForm(f=>({...f,doc:e.target.value}))}/></Field>
          <Field label="Email"><input type="email" value={form.email||""} onChange={e=>setForm(f=>({...f,email:e.target.value}))}/></Field>
          <Field label="Telefone"><input value={form.tel||""} onChange={e=>setForm(f=>({...f,tel:e.target.value}))}/></Field>
          <Field label="Status"><select value={form.status||"Ativo"} onChange={e=>setForm(f=>({...f,status:e.target.value}))}><option>Ativo</option><option>Inativo</option><option>Prospect</option></select></Field>
          <Field label="Endereço" span><input value={form.end||""} onChange={e=>setForm(f=>({...f,end:e.target.value}))}/></Field>
          <Field label="Observações" span><textarea value={form.obs||""} onChange={e=>setForm(f=>({...f,obs:e.target.value}))}/></Field>
        </div>
        <div className="mact"><button className="btn" onClick={()=>setModal(null)}>Cancelar</button><button className="btn btn-p" onClick={save}>Salvar</button></div>
      </Modal>}
    </>
  );
}

// ── CONTRATOS ──────────────────────────────────────────────────────────
function Contratos({db,del,upsert,modal,setModal,fmt,getCN}) {
  const [form,setForm] = useState({});
  const open = (d={}) => { setForm(d.id?d:{status:"Ativo",freq:"Único",cat:"WebDesign"}); setModal("contrato"); };
  const save = () => {
    if(!form.servico||!form.valor){alert("Campos obrigatórios");return;}
    upsert("contratos",{...form,id:form.id||uid()});setModal(null);
  };
  return(
    <>
      <div className="ph"><div className="pt"><span>⬡ </span>Contratos</div><button className="btn btn-p" onClick={()=>open()}><i className="ti ti-plus"/>Novo contrato</button></div>
      <div className="card"><table><thead><tr><th>Cliente</th><th>Serviço</th><th>Valor</th><th>Início</th><th>Término</th><th>Status</th><th>Ações</th></tr></thead><tbody>
        {!db.contratos.length && <tr><td colSpan={7}><div className="empty">Nenhum contrato</div></td></tr>}
        {db.contratos.map(c=><tr key={c.id}><td>{getCN(c.cliente)}</td><td>{c.servico}</td><td className="c-orange" style={{fontWeight:500}}>{fmt(c.valor)}<br/><span className="tiny">{c.freq}</span></td><td className="tiny">{c.inicio||"-"}</td><td className="tiny">{c.fim||"-"}</td><td><Badge s={c.status}/></td><td><div className="actions"><button className="btn btn-sm" onClick={()=>open(c)}><i className="ti ti-edit"/></button><button className="btn btn-sm btn-d" onClick={()=>del("contratos",c.id)}><i className="ti ti-trash"/></button></div></td></tr>)}
      </tbody></table></div>
      {modal==="contrato" && <Modal title="Contrato" onClose={()=>setModal(null)}>
        <div className="fgrid">
          <Field label="Cliente *" span><select value={form.cliente||""} onChange={e=>setForm(f=>({...f,cliente:e.target.value}))}><option value="">Selecione...</option>{db.clientes.filter(c=>c.status==="Ativo").map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}</select></Field>
          <Field label="Serviço *" span><input value={form.servico||""} onChange={e=>setForm(f=>({...f,servico:e.target.value}))}/></Field>
          <Field label="Valor (R$) *"><input type="number" value={form.valor||""} onChange={e=>setForm(f=>({...f,valor:e.target.value}))}/></Field>
          <Field label="Frequência"><select value={form.freq||"Único"} onChange={e=>setForm(f=>({...f,freq:e.target.value}))}><option>Único</option><option>Mensal</option><option>Trimestral</option><option>Anual</option></select></Field>
          <Field label="Início"><input type="date" value={form.inicio||""} onChange={e=>setForm(f=>({...f,inicio:e.target.value}))}/></Field>
          <Field label="Término"><input type="date" value={form.fim||""} onChange={e=>setForm(f=>({...f,fim:e.target.value}))}/></Field>
          <Field label="Status"><select value={form.status||"Ativo"} onChange={e=>setForm(f=>({...f,status:e.target.value}))}><option>Ativo</option><option>Pausado</option><option>Encerrado</option><option>Em negociação</option></select></Field>
          <Field label="Categoria"><select value={form.cat||"WebDesign"} onChange={e=>setForm(f=>({...f,cat:e.target.value}))}><option>WebDesign</option><option>Automação</option><option>IA</option><option>CRM</option><option>Consultoria</option><option>Outro</option></select></Field>
          <Field label="Observações" span><textarea value={form.obs||""} onChange={e=>setForm(f=>({...f,obs:e.target.value}))}/></Field>
        </div>
        <div className="mact"><button className="btn" onClick={()=>setModal(null)}>Cancelar</button><button className="btn btn-p" onClick={save}>Salvar</button></div>
      </Modal>}
    </>
  );
}

// ── ASSINATURAS ────────────────────────────────────────────────────────
function Assinaturas({db,del,upsert,modal,setModal,fmt,getCN}) {
  const [form,setForm] = useState({});
  const open = (d={}) => { setForm(d.id?d:{status:"Ativa",plano:"Starter"}); setModal("assinatura"); };
  const save = () => { if(!form.valor){alert("Valor obrigatório");return;} upsert("assinaturas",{...form,id:form.id||uid()});setModal(null); };
  const at = db.assinaturas.filter(a=>a.status==="Ativa");
  const mrr = at.reduce((s,a)=>s+Number(a.valor||0),0);
  return(
    <>
      <div className="ph"><div className="pt"><span>⬡ </span>Assinaturas CRM</div><button className="btn btn-p" onClick={()=>open()}><i className="ti ti-plus"/>Nova assinatura</button></div>
      <div className="mgrid">
        <div className="met"><div className="met-l">Ativas</div><div className="met-v c-blue">{at.length}</div></div>
        <div className="met"><div className="met-l">MRR</div><div className="met-v c-green">{fmt(mrr)}</div></div>
        <div className="met"><div className="met-l">ARR estimado</div><div className="met-v c-orange">{fmt(mrr*12)}</div></div>
      </div>
      <div className="card"><table><thead><tr><th>Cliente</th><th>Plano</th><th>Valor/mês</th><th>Vencimento</th><th>Início</th><th>Status</th><th>Ações</th></tr></thead><tbody>
        {!db.assinaturas.length && <tr><td colSpan={7}><div className="empty">Nenhuma assinatura</div></td></tr>}
        {db.assinaturas.map(a=><tr key={a.id}><td>{getCN(a.cliente)}</td><td><span className="bdg bdg-a">{a.plano}</span></td><td className="c-orange" style={{fontWeight:500}}>{fmt(a.valor)}</td><td>Dia {a.venc||"-"}</td><td className="tiny">{a.inicio||"-"}</td><td><Badge s={a.status}/></td><td><div className="actions"><button className="btn btn-sm" onClick={()=>open(a)}><i className="ti ti-edit"/></button><button className="btn btn-sm btn-d" onClick={()=>del("assinaturas",a.id)}><i className="ti ti-trash"/></button></div></td></tr>)}
      </tbody></table></div>
      {modal==="assinatura" && <Modal title="Assinatura CRM" onClose={()=>setModal(null)}>
        <div className="fgrid">
          <Field label="Cliente *" span><select value={form.cliente||""} onChange={e=>setForm(f=>({...f,cliente:e.target.value}))}><option value="">Selecione...</option>{db.clientes.filter(c=>c.status==="Ativo").map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}</select></Field>
          <Field label="Plano"><select value={form.plano||"Starter"} onChange={e=>setForm(f=>({...f,plano:e.target.value}))}><option>Starter</option><option>Pro</option><option>Business</option><option>Enterprise</option></select></Field>
          <Field label="Valor mensal (R$) *"><input type="number" value={form.valor||""} onChange={e=>setForm(f=>({...f,valor:e.target.value}))}/></Field>
          <Field label="Dia de vencimento"><input type="number" min="1" max="31" value={form.venc||""} onChange={e=>setForm(f=>({...f,venc:e.target.value}))}/></Field>
          <Field label="Data de início"><input type="date" value={form.inicio||""} onChange={e=>setForm(f=>({...f,inicio:e.target.value}))}/></Field>
          <Field label="Status"><select value={form.status||"Ativa"} onChange={e=>setForm(f=>({...f,status:e.target.value}))}><option>Ativa</option><option>Suspensa</option><option>Cancelada</option></select></Field>
          <Field label="Observações" span><textarea value={form.obs||""} onChange={e=>setForm(f=>({...f,obs:e.target.value}))}/></Field>
        </div>
        <div className="mact"><button className="btn" onClick={()=>setModal(null)}>Cancelar</button><button className="btn btn-p" onClick={save}>Salvar</button></div>
      </Modal>}
    </>
  );
}

// ── RECEBER ────────────────────────────────────────────────────────────
function Receber({db,del,upsert,update,modal,setModal,fmt,getCN,today,tabs,setTabs}) {
  const [form,setForm] = useState({});
  const open = (d={}) => { setForm(d.id?d:{status:"Pendente",forma:"PIX"}); setModal("receber"); };
  const save = () => { if(!form.desc||!form.valor){alert("Campos obrigatórios");return;} upsert("receber",{...form,id:form.id||uid()});setModal(null); };
  const markPaid = id => { update("receber", db.receber.map(r=>r.id===id?{...r,status:"Pago"}:r)); };
  const t = today();
  let list = db.receber;
  if(tabs.receber==="pendente") list=list.filter(r=>r.status==="Pendente");
  else if(tabs.receber==="pago") list=list.filter(r=>r.status==="Pago");
  else if(tabs.receber==="vencido") list=list.filter(r=>r.status==="Vencido"||(r.status==="Pendente"&&r.venc<t));
  list=[...list].sort((a,b)=>a.venc>b.venc?1:-1);
  const tot=list.reduce((s,r)=>s+Number(r.valor||0),0);
  const pg=list.filter(r=>r.status==="Pago").reduce((s,r)=>s+Number(r.valor||0),0);
  const pd=list.filter(r=>r.status==="Pendente").reduce((s,r)=>s+Number(r.valor||0),0);
  return(
    <>
      <div className="ph"><div className="pt"><span>⬡ </span>Contas a receber</div><button className="btn btn-p" onClick={()=>open()}><i className="ti ti-plus"/>Nova cobrança</button></div>
      <div className="tabs">{["todos","pendente","pago","vencido"].map(f=><button key={f} className={`tab${tabs.receber===f?" act":""}`} onClick={()=>setTabs(t=>({...t,receber:f}))}>{f.charAt(0).toUpperCase()+f.slice(1)}</button>)}</div>
      <div className="mgrid">
        <div className="met"><div className="met-l">Total</div><div className="met-v">{fmt(tot)}</div></div>
        <div className="met"><div className="met-l">Recebido</div><div className="met-v c-green">{fmt(pg)}</div></div>
        <div className="met"><div className="met-l">Pendente</div><div className="met-v c-orange">{fmt(pd)}</div></div>
      </div>
      <div className="card"><table><thead><tr><th>Cliente</th><th>Descrição</th><th>Valor</th><th>Vencimento</th><th>Status</th><th>Ações</th></tr></thead><tbody>
        {!list.length && <tr><td colSpan={6}><div className="empty">Nenhum registro</div></td></tr>}
        {list.map(r=>{const venc=r.venc&&r.status==="Pendente"&&r.venc<t;return<tr key={r.id}><td>{getCN(r.cliente)}</td><td>{r.desc}</td><td className="c-green" style={{fontWeight:500}}>{fmt(r.valor)}</td><td style={venc?{color:"var(--red)"}:{}} className="tiny">{r.venc||"-"}</td><td><Badge s={r.status}/></td><td><div className="actions">{r.status==="Pendente"&&<button className="btn btn-sm btn-s" onClick={()=>markPaid(r.id)}><i className="ti ti-check"/></button>}<button className="btn btn-sm" onClick={()=>open(r)}><i className="ti ti-edit"/></button><button className="btn btn-sm btn-d" onClick={()=>del("receber",r.id)}><i className="ti ti-trash"/></button></div></td></tr>;})}
      </tbody></table></div>
      {modal==="receber" && <Modal title="Cobrança" onClose={()=>setModal(null)}>
        <div className="fgrid">
          <Field label="Cliente *" span><select value={form.cliente||""} onChange={e=>setForm(f=>({...f,cliente:e.target.value}))}><option value="">Selecione...</option>{db.clientes.filter(c=>c.status==="Ativo").map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}</select></Field>
          <Field label="Descrição *" span><input value={form.desc||""} onChange={e=>setForm(f=>({...f,desc:e.target.value}))}/></Field>
          <Field label="Valor (R$) *"><input type="number" value={form.valor||""} onChange={e=>setForm(f=>({...f,valor:e.target.value}))}/></Field>
          <Field label="Vencimento *"><input type="date" value={form.venc||""} onChange={e=>setForm(f=>({...f,venc:e.target.value}))}/></Field>
          <Field label="Forma de pagamento"><select value={form.forma||"PIX"} onChange={e=>setForm(f=>({...f,forma:e.target.value}))}><option>PIX</option><option>Boleto</option><option>Cartão de crédito</option><option>Transferência</option><option>Dinheiro</option></select></Field>
          <Field label="Status"><select value={form.status||"Pendente"} onChange={e=>setForm(f=>({...f,status:e.target.value}))}><option>Pendente</option><option>Pago</option><option>Vencido</option><option>Cancelado</option></select></Field>
        </div>
        <div className="mact"><button className="btn" onClick={()=>setModal(null)}>Cancelar</button><button className="btn btn-p" onClick={save}>Salvar</button></div>
      </Modal>}
    </>
  );
}

// ── PAGAR ──────────────────────────────────────────────────────────────
function Pagar({db,del,upsert,modal,setModal,fmt,today,tabs,setTabs}) {
  const [form,setForm] = useState({});
  const open = (d={}) => { setForm(d.id?d:{status:"Pendente",cat:"Infraestrutura"}); setModal("pagar"); };
  const save = () => { if(!form.desc||!form.valor){alert("Campos obrigatórios");return;} upsert("pagar",{...form,id:form.id||uid()});setModal(null); };
  const markPaid = id => { const arr = db.pagar.map(r=>r.id===id?{...r,status:"Pago"}:r); upsert._parent && upsert._parent("pagar",arr); };
  const t = today();
  let list = db.pagar;
  if(tabs.pagar==="pendente") list=list.filter(r=>r.status==="Pendente");
  else if(tabs.pagar==="pago") list=list.filter(r=>r.status==="Pago");
  else if(tabs.pagar==="vencido") list=list.filter(r=>r.status==="Vencido"||(r.status==="Pendente"&&r.venc<t));
  list=[...list].sort((a,b)=>a.venc>b.venc?1:-1);
  const tot=list.reduce((s,r)=>s+Number(r.valor||0),0);
  const pg=list.filter(r=>r.status==="Pago").reduce((s,r)=>s+Number(r.valor||0),0);
  const pd=list.filter(r=>r.status==="Pendente").reduce((s,r)=>s+Number(r.valor||0),0);
  const mp = id => { upsert("pagar",{...db.pagar.find(x=>x.id===id),status:"Pago"}); };
  return(
    <>
      <div className="ph"><div className="pt"><span>⬡ </span>Contas a pagar</div><button className="btn btn-p" onClick={()=>open()}><i className="ti ti-plus"/>Nova conta</button></div>
      <div className="tabs">{["todos","pendente","pago","vencido"].map(f=><button key={f} className={`tab${tabs.pagar===f?" act":""}`} onClick={()=>setTabs(t=>({...t,pagar:f}))}>{f.charAt(0).toUpperCase()+f.slice(1)}</button>)}</div>
      <div className="mgrid">
        <div className="met"><div className="met-l">Total</div><div className="met-v">{fmt(tot)}</div></div>
        <div className="met"><div className="met-l">Pago</div><div className="met-v c-green">{fmt(pg)}</div></div>
        <div className="met"><div className="met-l">Pendente</div><div className="met-v c-orange">{fmt(pd)}</div></div>
      </div>
      <div className="card"><table><thead><tr><th>Fornecedor</th><th>Descrição</th><th>Valor</th><th>Vencimento</th><th>Categoria</th><th>Status</th><th>Ações</th></tr></thead><tbody>
        {!list.length && <tr><td colSpan={7}><div className="empty">Nenhum registro</div></td></tr>}
        {list.map(r=>{const venc=r.venc&&r.status==="Pendente"&&r.venc<t;return<tr key={r.id}><td>{r.forn}</td><td>{r.desc}</td><td className="c-red" style={{fontWeight:500}}>{fmt(r.valor)}</td><td style={venc?{color:"var(--red)"}:{}} className="tiny">{r.venc||"-"}</td><td><span className="bdg bdg-x">{r.cat||"-"}</span></td><td><Badge s={r.status}/></td><td><div className="actions">{r.status==="Pendente"&&<button className="btn btn-sm btn-s" onClick={()=>mp(r.id)}><i className="ti ti-check"/></button>}<button className="btn btn-sm" onClick={()=>open(r)}><i className="ti ti-edit"/></button><button className="btn btn-sm btn-d" onClick={()=>del("pagar",r.id)}><i className="ti ti-trash"/></button></div></td></tr>;})}
      </tbody></table></div>
      {modal==="pagar" && <Modal title="Conta a pagar" onClose={()=>setModal(null)}>
        <div className="fgrid">
          <Field label="Fornecedor *" span><input value={form.forn||""} onChange={e=>setForm(f=>({...f,forn:e.target.value}))}/></Field>
          <Field label="Descrição *" span><input value={form.desc||""} onChange={e=>setForm(f=>({...f,desc:e.target.value}))}/></Field>
          <Field label="Valor (R$) *"><input type="number" value={form.valor||""} onChange={e=>setForm(f=>({...f,valor:e.target.value}))}/></Field>
          <Field label="Vencimento *"><input type="date" value={form.venc||""} onChange={e=>setForm(f=>({...f,venc:e.target.value}))}/></Field>
          <Field label="Categoria"><select value={form.cat||"Infraestrutura"} onChange={e=>setForm(f=>({...f,cat:e.target.value}))}><option>Infraestrutura</option><option>Software/SaaS</option><option>Marketing</option><option>Pessoal</option><option>Escritório</option><option>Impostos</option><option>Outros</option></select></Field>
          <Field label="Status"><select value={form.status||"Pendente"} onChange={e=>setForm(f=>({...f,status:e.target.value}))}><option>Pendente</option><option>Pago</option><option>Vencido</option><option>Cancelado</option></select></Field>
        </div>
        <div className="mact"><button className="btn" onClick={()=>setModal(null)}>Cancelar</button><button className="btn btn-p" onClick={save}>Salvar</button></div>
      </Modal>}
    </>
  );
}

// ── LANÇAMENTOS ────────────────────────────────────────────────────────
function Lancamentos({db,del,update,upsert,modal,setModal,fmt,getBN,today,tabs,setTabs}) {
  const [form,setForm] = useState({});
  const open = (tipo) => { setForm({tipo,data:today(),cat:tipo==="entrada"?"Serviço":"Infraestrutura"}); setModal("lanc"); };
  const save = () => {
    if(!form.desc||!form.valor){alert("Campos obrigatórios");return;}
    const item = {...form,id:uid()};
    const next = [...db.lancamentos, item];
    update("lancamentos", next);
    const bi = db.bancos.findIndex(x=>x.id===item.conta);
    if(bi>=0){const bNext=[...db.bancos];bNext[bi]={...bNext[bi],saldo:Number(bNext[bi].saldo||0)+(item.tipo==="entrada"?Number(item.valor):-Number(item.valor))};update("bancos",bNext);}
    setModal(null);
  };
  let list = db.lancamentos;
  if(tabs.lanc==="entrada") list=list.filter(l=>l.tipo==="entrada");
  else if(tabs.lanc==="saida") list=list.filter(l=>l.tipo==="saida");
  list=[...list].sort((a,b)=>b.data>a.data?1:-1);
  const ent=db.lancamentos.filter(l=>l.tipo==="entrada").reduce((s,l)=>s+Number(l.valor||0),0);
  const sai=db.lancamentos.filter(l=>l.tipo==="saida").reduce((s,l)=>s+Number(l.valor||0),0);
  return(
    <>
      <div className="ph"><div className="pt"><span>⬡ </span>Lançamentos</div><div style={{display:"flex",gap:8}}><button className="btn btn-s" onClick={()=>open("entrada")}><i className="ti ti-plus"/>Entrada</button><button className="btn btn-d" onClick={()=>open("saida")}><i className="ti ti-minus"/>Saída</button></div></div>
      <div className="tabs">{["todos","entrada","saida"].map(f=><button key={f} className={`tab${tabs.lanc===f?" act":""}`} onClick={()=>setTabs(t=>({...t,lanc:f}))}>{f.charAt(0).toUpperCase()+f.slice(1)}</button>)}</div>
      <div className="mgrid">
        <div className="met"><div className="met-l">Entradas</div><div className="met-v c-green">{fmt(ent)}</div></div>
        <div className="met"><div className="met-l">Saídas</div><div className="met-v c-red">{fmt(sai)}</div></div>
        <div className="met"><div className="met-l">Saldo</div><div className={`met-v ${ent-sai>=0?"c-green":"c-red"}`}>{fmt(ent-sai)}</div></div>
      </div>
      <div className="card"><table><thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>Categoria</th><th>Conta</th><th>Valor</th></tr></thead><tbody>
        {!list.length && <tr><td colSpan={6}><div className="empty">Nenhum lançamento</div></td></tr>}
        {list.map(l=><tr key={l.id}><td className="tiny">{l.data||"-"}</td><td><span className={`bdg ${l.tipo==="entrada"?"bdg-g":"bdg-r"}`}>{l.tipo==="entrada"?"Entrada":"Saída"}</span></td><td>{l.desc}</td><td><span className="bdg bdg-x">{l.cat||"-"}</span></td><td className="tiny">{getBN(l.conta)}</td><td style={{fontWeight:500,color:`var(${l.tipo==="entrada"?"--green":"--red"})`}}>{l.tipo==="entrada"?"+":"-"}{fmt(l.valor)}</td></tr>)}
      </tbody></table></div>
      {modal==="lanc" && <Modal title={form.tipo==="entrada"?"Registrar entrada":"Registrar saída"} onClose={()=>setModal(null)}>
        <div className="fgrid">
          <Field label="Descrição *" span><input value={form.desc||""} onChange={e=>setForm(f=>({...f,desc:e.target.value}))}/></Field>
          <Field label="Valor (R$) *"><input type="number" value={form.valor||""} onChange={e=>setForm(f=>({...f,valor:e.target.value}))}/></Field>
          <Field label="Data *"><input type="date" value={form.data||""} onChange={e=>setForm(f=>({...f,data:e.target.value}))}/></Field>
          <Field label="Categoria"><select value={form.cat||""} onChange={e=>setForm(f=>({...f,cat:e.target.value}))}>{form.tipo==="entrada"?<><option>Serviço</option><option>Assinatura CRM</option><option>Projeto</option><option>Consultoria</option><option>Outro</option></>:<><option>Infraestrutura</option><option>Software/SaaS</option><option>Marketing</option><option>Pessoal</option><option>Impostos</option><option>Outros</option></>}</select></Field>
          <Field label="Conta bancária" span><select value={form.conta||""} onChange={e=>setForm(f=>({...f,conta:e.target.value}))}><option value="">Nenhuma</option>{db.bancos.map(b=><option key={b.id} value={b.id}>{b.nome}</option>)}</select></Field>
        </div>
        <div className="mact"><button className="btn" onClick={()=>setModal(null)}>Cancelar</button><button className="btn btn-p" onClick={save}>Registrar</button></div>
      </Modal>}
    </>
  );
}

// ── BANCOS ─────────────────────────────────────────────────────────────
function Bancos({db,del,upsert,modal,setModal,fmt}) {
  const [form,setForm] = useState({});
  const open = (d={}) => { setForm(d.id?d:{tipo:"Conta corrente"}); setModal("banco"); };
  const save = () => { if(!form.nome){alert("Nome obrigatório");return;} upsert("bancos",{...form,id:form.id||uid()});setModal(null); };
  return(
    <>
      <div className="ph"><div className="pt"><span>⬡ </span>Contas bancárias</div><button className="btn btn-p" onClick={()=>open()}><i className="ti ti-plus"/>Nova conta</button></div>
      {!db.bancos.length && <div className="empty">Nenhuma conta cadastrada</div>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:12}}>
        {db.bancos.map(b=><div key={b.id} className="card"><div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}><div><div style={{fontWeight:500}}>{b.nome}</div><div className="tiny">{b.banco} · {b.tipo}</div></div><div className="actions"><button className="btn btn-sm" onClick={()=>open(b)}><i className="ti ti-edit"/></button><button className="btn btn-sm btn-d" onClick={()=>del("bancos",b.id)}><i className="ti ti-trash"/></button></div></div><div style={{fontSize:26,fontWeight:500,color:"var(--green)"}}>{fmt(b.saldo)}</div><div className="tiny" style={{marginTop:4}}>Saldo atual</div></div>)}
      </div>
      {modal==="banco" && <Modal title="Conta bancária" onClose={()=>setModal(null)}>
        <div className="fgrid">
          <Field label="Nome da conta *" span><input value={form.nome||""} onChange={e=>setForm(f=>({...f,nome:e.target.value}))}/></Field>
          <Field label="Banco"><input value={form.banco||""} onChange={e=>setForm(f=>({...f,banco:e.target.value}))}/></Field>
          <Field label="Saldo atual (R$) *"><input type="number" value={form.saldo||""} onChange={e=>setForm(f=>({...f,saldo:e.target.value}))}/></Field>
          <Field label="Tipo"><select value={form.tipo||"Conta corrente"} onChange={e=>setForm(f=>({...f,tipo:e.target.value}))}><option>Conta corrente</option><option>Conta poupança</option><option>Conta digital</option></select></Field>
        </div>
        <div className="mact"><button className="btn" onClick={()=>setModal(null)}>Cancelar</button><button className="btn btn-p" onClick={save}>Salvar</button></div>
      </Modal>}
    </>
  );
}

// ── CARTÕES ────────────────────────────────────────────────────────────
function Cartoes({db,del,upsert,modal,setModal,fmt}) {
  const [form,setForm] = useState({});
  const open = (d={}) => { setForm(d.id?d:{band:"Visa"}); setModal("cartao"); };
  const save = () => { if(!form.nome||!form.limite){alert("Nome e limite obrigatórios");return;} upsert("cartoes",{...form,id:form.id||uid()});setModal(null); };
  return(
    <>
      <div className="ph"><div className="pt"><span>⬡ </span>Cartões</div><button className="btn btn-p" onClick={()=>open()}><i className="ti ti-plus"/>Novo cartão</button></div>
      {!db.cartoes.length && <div className="empty">Nenhum cartão cadastrado</div>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:12}}>
        {db.cartoes.map(c=>{const us=Number(c.usado||0),lim=Number(c.limite||1);const pct=Math.min(100,Math.round((us/lim)*100));const cl=pct>80?"pfill-r":pct>60?"pfill-a":"";return<div key={c.id} className="card"><div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}><div><div style={{fontWeight:500}}>{c.nome}</div><div className="tiny">{c.band} · Fecha dia {c.fech||"-"} · Vence dia {c.venc||"-"}</div></div><div className="actions"><button className="btn btn-sm" onClick={()=>open(c)}><i className="ti ti-edit"/></button><button className="btn btn-sm btn-d" onClick={()=>del("cartoes",c.id)}><i className="ti ti-trash"/></button></div></div><div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:5,color:"var(--text2)"}}><span>Usado: <strong style={{color:"var(--text)"}}>{fmt(us)}</strong></span><span style={{fontWeight:500,color:pct>80?"var(--red)":"var(--orange-l)"}}>{pct}%</span></div><div className="pbar" style={{marginBottom:6}}><div className={`pfill ${cl}`} style={{width:pct+"%"}}/></div><div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"var(--text3)"}}><span>Disponível: <strong style={{color:"var(--green)"}}>{fmt(lim-us)}</strong></span><span>Limite: {fmt(lim)}</span></div></div>;})}
      </div>
      {modal==="cartao" && <Modal title="Cartão" onClose={()=>setModal(null)}>
        <div className="fgrid">
          <Field label="Nome do cartão *" span><input value={form.nome||""} onChange={e=>setForm(f=>({...f,nome:e.target.value}))}/></Field>
          <Field label="Bandeira"><select value={form.band||"Visa"} onChange={e=>setForm(f=>({...f,band:e.target.value}))}><option>Visa</option><option>Mastercard</option><option>Elo</option><option>American Express</option></select></Field>
          <Field label="Limite total (R$) *"><input type="number" value={form.limite||""} onChange={e=>setForm(f=>({...f,limite:e.target.value}))}/></Field>
          <Field label="Limite usado (R$)"><input type="number" value={form.usado||""} onChange={e=>setForm(f=>({...f,usado:e.target.value}))}/></Field>
          <Field label="Fechamento (dia)"><input type="number" min="1" max="31" value={form.fech||""} onChange={e=>setForm(f=>({...f,fech:e.target.value}))}/></Field>
          <Field label="Vencimento (dia)"><input type="number" min="1" max="31" value={form.venc||""} onChange={e=>setForm(f=>({...f,venc:e.target.value}))}/></Field>
        </div>
        <div className="mact"><button className="btn" onClick={()=>setModal(null)}>Cancelar</button><button className="btn btn-p" onClick={save}>Salvar</button></div>
      </Modal>}
    </>
  );
}

// ── RELATÓRIOS ─────────────────────────────────────────────────────────
function Relatorios({db,fmt,getCN}) {
  const bar = (items, vFn, lFn) => {
    if(!items.length) return <div className="empty">Sem dados suficientes</div>;
    const max = Math.max(...items.map(vFn));
    return items.slice(0,6).map((it,i)=>{const v=vFn(it),pct=max?Math.round((v/max)*100):0;return<div key={i} className="cbrow"><div className="cblbl" title={lFn(it)}>{lFn(it)}</div><div className="cbout"><div className="cbin" style={{width:pct+"%"}}/></div><div className="cbval">{fmt(v)}</div></div>;});
  };
  const rMap={};db.receber.filter(r=>r.status==="Pago").forEach(r=>{rMap[r.desc]=(rMap[r.desc]||0)+Number(r.valor||0)});
  const pMap={};db.pagar.filter(p=>p.status==="Pago").forEach(p=>{pMap[p.cat]=(pMap[p.cat]||0)+Number(p.valor||0)});
  const cMap={};db.receber.filter(r=>r.status==="Pago").forEach(r=>{const n=getCN(r.cliente);cMap[n]=(cMap[n]||0)+Number(r.valor||0)});
  const tR=db.receber.filter(r=>r.status==="Pago").reduce((s,r)=>s+Number(r.valor||0),0);
  const tP=db.pagar.filter(p=>p.status==="Pago").reduce((s,p)=>s+Number(p.valor||0),0);
  const aR=db.receber.filter(r=>r.status==="Pendente").reduce((s,r)=>s+Number(r.valor||0),0);
  const aP=db.pagar.filter(p=>p.status==="Pendente").reduce((s,p)=>s+Number(p.valor||0),0);
  const mrr=db.assinaturas.filter(a=>a.status==="Ativa").reduce((s,a)=>s+Number(a.valor||0),0);
  const sld=db.bancos.reduce((s,b)=>s+Number(b.saldo||0),0);
  return(
    <>
      <div className="ph"><div className="pt"><span>⬡ </span>Relatórios e análises</div></div>
      <div className="two">
        <div className="card"><div className="stitle"><i className="ti ti-chart-pie c-orange"/>Receita por serviço</div>{bar(Object.entries(rMap).map(([k,v])=>({k,v})).sort((a,b)=>b.v-a.v),x=>x.v,x=>x.k)}</div>
        <div className="card"><div className="stitle"><i className="ti ti-chart-bar c-orange"/>Despesas por categoria</div>{bar(Object.entries(pMap).map(([k,v])=>({k,v})).sort((a,b)=>b.v-a.v),x=>x.v,x=>x.k)}</div>
      </div>
      <div className="two">
        <div className="card"><div className="stitle"><i className="ti ti-users c-orange"/>Top clientes por receita</div>{bar(Object.entries(cMap).map(([k,v])=>({k,v})).sort((a,b)=>b.v-a.v),x=>x.v,x=>x.k)}</div>
        <div className="card"><div className="stitle"><i className="ti ti-trending-up c-orange"/>Resumo financeiro</div>
          <table><tbody>
            <tr><td className="muted" style={{padding:"7px 0"}}>Receita confirmada</td><td style={{textAlign:"right",fontWeight:500,color:"var(--green)"}}>{fmt(tR)}</td></tr>
            <tr><td className="muted" style={{padding:"7px 0"}}>Despesas pagas</td><td style={{textAlign:"right",fontWeight:500,color:"var(--red)"}}>{fmt(tP)}</td></tr>
            <tr style={{borderTop:"1px solid var(--border)"}}><td style={{padding:"7px 0",fontWeight:500,color:"var(--orange-l)"}}>Lucro líquido</td><td style={{textAlign:"right",fontWeight:500,color:`var(${tR-tP>=0?"--green":"--red"})`}}>{fmt(tR-tP)}</td></tr>
            <tr><td colSpan={2} style={{padding:4}}></td></tr>
            <tr><td className="muted" style={{padding:"5px 0"}}>Previsão a receber</td><td style={{textAlign:"right",fontWeight:500,color:"var(--orange-l)"}}>{fmt(aR)}</td></tr>
            <tr><td className="muted" style={{padding:"5px 0"}}>Previsão a pagar</td><td style={{textAlign:"right",fontWeight:500,color:"var(--orange-l)"}}>{fmt(aP)}</td></tr>
            <tr><td colSpan={2} style={{padding:4}}></td></tr>
            <tr><td className="muted" style={{padding:"5px 0"}}>MRR (assinaturas)</td><td style={{textAlign:"right",fontWeight:500,color:"var(--blue)"}}>{fmt(mrr)}</td></tr>
            <tr><td className="muted" style={{padding:"5px 0"}}>Saldo total</td><td style={{textAlign:"right",fontWeight:500,color:"var(--blue)"}}>{fmt(sld)}</td></tr>
          </tbody></table>
        </div>
      </div>
    </>
  );
}
