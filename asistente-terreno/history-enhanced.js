document.addEventListener("DOMContentLoaded",()=>{
  const $=id=>document.getElementById(id);
  const STORAGE="nida_records_v4";
  let historyData=[];

  function esc(v=""){return String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
  function norm(v=""){return String(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()}
  async function api(url){const r=await fetch(url,{headers:{"Content-Type":"application/json"}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||("HTTP "+r.status));return d}
  function localRecords(){try{const x=JSON.parse(localStorage.getItem(STORAGE)||"[]");return Array.isArray(x)?x:[]}catch{return[]}}
  function formatWhen(v=""){if(!v)return"Sin fecha";const d=new Date(v);return Number.isNaN(d.getTime())?v:d.toLocaleString("es-CL",{dateStyle:"medium",timeStyle:v.includes("T")?"short":undefined})}
  function merge(remote=[]){
    const local=localRecords(),byPage=new Map();
    local.forEach(x=>{const id=x.remote?.notion?.pageId;if(id)byPage.set(id,x)});
    const out=remote.map(r=>{const l=byPage.get(r.id);return l?{...r,remote:l.remote,createdAt:r.createdAt||l.createdAt}:r});
    const ids=new Set(remote.map(x=>x.id));
    local.forEach(x=>{const id=x.remote?.notion?.pageId;if(!id||!ids.has(id))out.push({...x,source:"local"})});
    return out.sort((a,b)=>String(b.visitDate||b.createdAt||"").localeCompare(String(a.visitDate||a.createdAt||"")))
  }
  function detail(label,value){return '<div class="detail"><small>'+esc(label)+'</small><p>'+esc(value||"Sin información registrada")+'</p></div>'}
  function render(){
    const c=$("historyContainer"),meta=$("historyMeta");if(!c||!meta)return;
    const q=norm($("historySearch")?.value||""),filter=$("historyIssueFilter")?.value||"all";
    const rows=historyData.filter(r=>{
      if(filter==="issues"&&!r.github)return false;
      if(filter==="noissues"&&r.github)return false;
      if(!q)return true;
      return norm([r.client,r.location,r.type,r.visitDate,r.reviewed,r.requests,r.teamCommitments,r.clientCommitments,r.explanation,r.nextSteps,r.followup,r.nextDate,r.reportOriginal].join(" ")).includes(q)
    });
    meta.textContent=rows.length+" de "+historyData.length+" visitas";
    if(!rows.length){c.innerHTML='<div class="empty">No encontramos visitas con esos filtros.</div>';return}
    c.innerHTML=rows.map(r=>{
      const notionUrl=r.notionUrl||r.remote?.notion?.url||"",githubUrl=r.remote?.github?.url||"";
      return '<details class="history-item"><summary><div><strong>'+esc(r.client)+' · '+esc(r.location)+'</strong><p>'+esc(r.type||"Visita")+' · '+esc(formatWhen(r.visitDate||r.createdAt))+'</p></div><div class="history-tags">'+(r.github?'<span class="tag issue">⚠ Incidencia</span>':'<span class="tag ok">Sin incidencia</span>')+'<span class="chevron">⌄</span></div></summary><div class="history-detail">'+
        detail("Temas revisados",r.reviewed)+
        detail("Solicitudes del cliente",r.requests)+
        detail("Compromisos AgroInventario",r.teamCommitments)+
        detail("Compromisos del cliente",r.clientCommitments)+
        detail("Explicaciones / pasos realizados",r.explanation)+
        detail("Próximos pasos",r.nextSteps)+
        detail("Seguimientos pendientes",r.followup)+
        detail("Próxima acción / fecha",r.nextDate)+
        detail("Reporte original",r.reportOriginal)+
        '<div class="history-links">'+
        (notionUrl?'<a class="btn ghost" target="_blank" rel="noopener" href="'+esc(notionUrl)+'">Abrir en Notion</a>':'')+
        (githubUrl?'<a class="btn ghost" target="_blank" rel="noopener" href="'+esc(githubUrl)+'">Abrir incidencia GitHub</a>':'')+
        '</div></div></details>'
    }).join("")
  }
  async function loadHistory(){
    const c=$("historyContainer"),meta=$("historyMeta");
    if(c)c.innerHTML='<div class="empty">Cargando historial…</div>';
    if(meta)meta.textContent="Sincronizando con Notion…";
    try{const d=await api("/api/visits");historyData=merge(d.items||[])}
    catch(e){historyData=merge([]);if(meta)meta.textContent="Mostrando respaldo local · "+e.message}
    render();
    if($("statRecords"))$("statRecords").textContent=historyData.length;
    if($("statIssues"))$("statIssues").textContent=historyData.filter(x=>x.github).length;
    if($("statLast"))$("statLast").textContent=historyData[0]?.visitDate||historyData[0]?.createdAt||"Sin registros"
  }
  function activate(view){
    document.querySelectorAll(".view").forEach(x=>x.classList.add("hidden"));
    $(view)?.classList.remove("hidden");
    document.querySelectorAll(".nav").forEach(x=>x.classList.toggle("active",x.dataset.view===view));
    if(view==="history"){if($("pageTitle"))$("pageTitle").textContent="Historial";if($("pageSubtitle"))$("pageSubtitle").textContent="Consulta los registros confirmados.";loadHistory()}
    if(view==="visit"){if($("pageTitle"))$("pageTitle").textContent="Nueva visita";if($("pageSubtitle"))$("pageSubtitle").textContent="Captura la información mientras aún está fresca."}
  }

  document.querySelectorAll('.nav[data-view="history"]').forEach(x=>x.addEventListener("click",()=>setTimeout(loadHistory,0)));
  $("historySearch")?.addEventListener("input",render);
  $("historyIssueFilter")?.addEventListener("change",render);
  $("historyRefreshBtn")?.addEventListener("click",loadHistory);
  $("viewHistoryBtn")?.addEventListener("click",()=>activate("history"));
  $("newVisitBtn")?.addEventListener("click",()=>{$("saveSuccess")?.classList.add("hidden");activate("visit")});

  const confirm=$("confirmBtn");
  if(confirm&&typeof confirm.onclick==="function"){
    const original=confirm.onclick;
    confirm.onclick=async function(e){
      const oldAlert=window.alert;window.alert=()=>{};
      try{await original.call(this,e)}finally{window.alert=oldAlert}
      const latest=localRecords()[0],remote=latest?.remote;
      if(!latest||!$("saveSuccess"))return;
      const n=$("saveNotionStatus"),g=$("saveGithubStatus"),nl=$("saveNotionLink"),gl=$("saveGithubLink");
      nl?.classList.add("hidden");gl?.classList.add("hidden");
      if(remote?.ok===false){
        if(n)n.textContent="Copia local guardada · "+(remote.error||"sin conexión");
        if(g)g.textContent=latest.github?"Incidencia pendiente":"No requerido";
      }else{
        if(n)n.textContent=remote?.notion?.saved?"✓ Registro creado":"Guardado localmente";
        if(g)g.textContent=latest.github?(remote?.github?.created?"✓ Incidencia creada":"Incidencia pendiente"):"No requerido";
        if(nl&&remote?.notion?.url){nl.href=remote.notion.url;nl.classList.remove("hidden")}
        if(gl&&remote?.github?.url){gl.href=remote.github.url;gl.classList.remove("hidden")}
      }
      activate("visit");$("resultCard")?.classList.add("hidden");$("saveSuccess").classList.remove("hidden");$("saveSuccess").scrollIntoView({behavior:"smooth"});historyData=[]
    }
  }

  setTimeout(loadHistory,500);
});