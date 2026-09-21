document.addEventListener("DOMContentLoaded",()=>{
  const $=id=>document.getElementById(id);
  const STORAGE="nida_records_v4";
  let historyData=[];

  function esc(v=""){
    return String(v)
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function norm(v=""){
    return String(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
  }

  async function api(url){
    const r=await fetch(url,{headers:{"Content-Type":"application/json"}});
    const d=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(d.error||("HTTP "+r.status));
    return d;
  }

  function localRecords(){
    try{
      const x=JSON.parse(localStorage.getItem(STORAGE)||"[]");
      return Array.isArray(x)?x:[];
    }catch{return[]}
  }

  function formatWhen(v=""){
    if(!v) return "Sin fecha";
    if(/^\d{4}-\d{2}-\d{2}$/.test(v)){
      const [y,m,d]=v.split("-");
      return d+"-"+m+"-"+y;
    }
    const dt=new Date(v);
    return Number.isNaN(dt.getTime())?v:dt.toLocaleString("es-CL",{dateStyle:"medium",timeStyle:"short"});
  }

  function hasFollowup(r){
    const value=norm(r?.followup||"");
    return Boolean(value)&&!["por confirmar","sin seguimiento","sin pendientes","no aplica","n/a"].includes(value);
  }

  function merge(remote=[]){
    const local=localRecords();
    const byPage=new Map();

    local.forEach(x=>{
      const id=x.remote?.notion?.pageId;
      if(id) byPage.set(id,x);
    });

    const out=remote.map(r=>{
      const l=byPage.get(r.id);
      return l?{...r,remote:l.remote,createdAt:r.createdAt||l.createdAt}:r;
    });

    const remoteIds=new Set(remote.map(x=>x.id));
    local.forEach(x=>{
      const id=x.remote?.notion?.pageId;
      if(!id||!remoteIds.has(id)) out.push({...x,source:"local"});
    });

    return out.sort((a,b)=>String(b.visitDate||b.createdAt||"").localeCompare(String(a.visitDate||a.createdAt||"")));
  }

  function populateCompanyFilter(){
    const select=$("historyCompanyFilter");
    if(!select) return;
    const selected=select.value||"all";
    const companies=[...new Set(historyData.map(x=>x.client).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"es"));
    select.innerHTML='<option value="all">Todas las empresas</option>'+companies.map(name=>'<option value="'+esc(name)+'">'+esc(name)+'</option>').join("");
    select.value=companies.includes(selected)?selected:"all";
  }

  function filteredRows(){
    const q=norm($("historySearch")?.value||"");
    const issueFilter=$("historyIssueFilter")?.value||"all";
    const companyFilter=$("historyCompanyFilter")?.value||"all";

    return historyData.filter(r=>{
      if(issueFilter==="issues"&&!r.github) return false;
      if(issueFilter==="noissues"&&r.github) return false;
      if(companyFilter!=="all"&&r.client!==companyFilter) return false;
      if(!q) return true;

      return norm([
        r.client,r.location,r.type,r.visitDate,r.reviewed,r.requests,
        r.teamCommitments,r.clientCommitments,r.explanation,r.nextSteps,
        r.followup,r.nextDate,r.reportOriginal,r.githubNumber
      ].join(" ")).includes(q);
    });
  }

  function detail(label,value){
    return '<div class="detail"><small>'+esc(label)+'</small><p>'+esc(value||"Sin información registrada")+'</p></div>';
  }

  function renderHistory(){
    const c=$("historyContainer"),meta=$("historyMeta");
    if(!c||!meta) return;

    const rows=filteredRows();
    meta.textContent=rows.length+" de "+historyData.length+" visitas";

    if(!rows.length){
      c.innerHTML='<div class="empty">No encontramos visitas con esos filtros.</div>';
      return;
    }

    c.innerHTML=rows.map(r=>{
      const notionUrl=r.notionUrl||r.remote?.notion?.url||"";
      const githubUrl=r.githubUrl||r.remote?.github?.url||"";

      return '<details class="history-item">'+
        '<summary>'+
          '<div><strong>'+esc(r.client)+' · '+esc(r.location)+'</strong>'+
          '<p>'+esc(r.type||"Visita")+' · '+esc(formatWhen(r.visitDate||r.createdAt))+'</p></div>'+
          '<div class="history-tags">'+
            (hasFollowup(r)?'<span class="tag followup">Seguimiento</span>':'')+
            (r.github?'<span class="tag issue">⚠ Incidencia'+(r.githubNumber?' #'+esc(r.githubNumber):'')+'</span>':'<span class="tag ok">Sin incidencia</span>')+
            '<span class="chevron">⌄</span>'+
          '</div>'+
        '</summary>'+
        '<div class="history-detail">'+
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
          '</div>'+
        '</div>'+
      '</details>';
    }).join("");
  }

  function renderDashboard(){
    if($("statRecords")) $("statRecords").textContent=historyData.length;
    if($("statIssues")) $("statIssues").textContent=historyData.filter(x=>x.github).length;

    const followups=historyData.filter(hasFollowup);
    if($("statFollowups")) $("statFollowups").textContent=followups.length;
    if($("statLast")) $("statLast").textContent=formatWhen(historyData[0]?.visitDate||historyData[0]?.createdAt||"");

    const box=$("dashboardFollowups");
    if(!box) return;

    if(!followups.length){
      box.innerHTML='<div class="empty compact-empty">No hay seguimientos pendientes registrados.</div>';
      return;
    }

    box.innerHTML=followups.slice(0,5).map(r=>{
      const notionUrl=r.notionUrl||r.remote?.notion?.url||"";
      return '<article class="followup-item">'+
        '<div><strong>'+esc(r.client)+' · '+esc(r.location)+'</strong>'+
        '<p>'+esc(r.followup||"Seguimiento pendiente")+'</p>'+
        '<small>'+(r.nextDate?'Próxima acción: '+esc(r.nextDate):'Sin fecha definida')+'</small></div>'+
        (notionUrl?'<a class="btn ghost mini" target="_blank" rel="noopener" href="'+esc(notionUrl)+'">Abrir</a>':'')+
      '</article>';
    }).join("");
  }

  function csvCell(v=""){
    return '"'+String(v??"").replaceAll('"','""')+'"';
  }

  function exportCsv(){
    const rows=filteredRows();
    if(!rows.length){
      alert("No hay visitas para exportar con los filtros actuales.");
      return;
    }

    const headers=[
      "Empresa","Campo","Tipo de visita","Fecha","Temas revisados","Solicitudes del cliente",
      "Compromisos AgroInventario","Compromisos del cliente","Explicaciones / pasos realizados",
      "Próximos pasos","Seguimientos pendientes","Próxima fecha","Incidencia","GitHub #",
      "GitHub Issue","Reporte original","Notion"
    ];

    const lines=[headers.map(csvCell).join(";")];
    rows.forEach(r=>{
      lines.push([
        r.client,r.location,r.type,r.visitDate,r.reviewed,r.requests,r.teamCommitments,
        r.clientCommitments,r.explanation,r.nextSteps,r.followup,r.nextDate,
        r.github?"Sí":"No",r.githubNumber||"",r.githubUrl||r.remote?.github?.url||"",
        r.reportOriginal,r.notionUrl||r.remote?.notion?.url||""
      ].map(csvCell).join(";"));
    });

    const blob=new Blob(["\ufeff"+lines.join("\r\n")],{type:"text/csv;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;
    a.download="NIDA_historial_visitas_"+new Date().toISOString().slice(0,10)+".csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function loadHistory(){
    const c=$("historyContainer"),meta=$("historyMeta");
    if(c) c.innerHTML='<div class="empty">Cargando historial…</div>';
    if(meta) meta.textContent="Sincronizando con Notion…";

    try{
      const d=await api("/api/visits");
      historyData=merge(d.items||[]);
    }catch(e){
      historyData=merge([]);
      if(meta) meta.textContent="Mostrando respaldo local · "+e.message;
    }

    populateCompanyFilter();
    renderHistory();
    renderDashboard();
  }

  function activate(view){
    document.querySelectorAll(".view").forEach(x=>x.classList.add("hidden"));
    $(view)?.classList.remove("hidden");
    document.querySelectorAll(".nav").forEach(x=>x.classList.toggle("active",x.dataset.view===view));

    if(view==="history"){
      if($("pageTitle")) $("pageTitle").textContent="Historial";
      if($("pageSubtitle")) $("pageSubtitle").textContent="Consulta toda la información registrada y sincronizada.";
      loadHistory();
    }

    if(view==="visit"){
      if($("pageTitle")) $("pageTitle").textContent="Nueva visita";
      if($("pageSubtitle")) $("pageSubtitle").textContent="Captura la información mientras aún está fresca.";
    }

    if(view==="dashboard"){
      if($("pageTitle")) $("pageTitle").textContent="Inicio";
      if($("pageSubtitle")) $("pageSubtitle").textContent="Gestiona registros desde un solo lugar.";
      loadHistory();
    }
  }

  document.querySelectorAll('.nav[data-view="history"]').forEach(x=>x.addEventListener("click",()=>setTimeout(loadHistory,0)));
  document.querySelectorAll('.nav[data-view="dashboard"]').forEach(x=>x.addEventListener("click",()=>setTimeout(loadHistory,0)));

  $("historySearch")?.addEventListener("input",renderHistory);
  $("historyIssueFilter")?.addEventListener("change",renderHistory);
  $("historyCompanyFilter")?.addEventListener("change",renderHistory);
  $("historyRefreshBtn")?.addEventListener("click",loadHistory);
  $("historyExportBtn")?.addEventListener("click",exportCsv);
  $("viewHistoryBtn")?.addEventListener("click",()=>activate("history"));
  $("goHistoryBtn")?.addEventListener("click",()=>activate("history"));
  $("newVisitBtn")?.addEventListener("click",()=>{
    $("saveSuccess")?.classList.add("hidden");
    activate("visit");
  });

  const confirm=$("confirmBtn");
  if(confirm&&typeof confirm.onclick==="function"){
    const original=confirm.onclick;

    confirm.onclick=async function(e){
      const oldAlert=window.alert;
      window.alert=()=>{};

      try{
        await original.call(this,e);
      }finally{
        window.alert=oldAlert;
      }

      const latest=localRecords()[0];
      const remote=latest?.remote;
      if(!latest||!$("saveSuccess")) return;

      const n=$("saveNotionStatus"),g=$("saveGithubStatus");
      const nl=$("saveNotionLink"),gl=$("saveGithubLink");

      nl?.classList.add("hidden");
      gl?.classList.add("hidden");

      if(remote?.ok===false){
        if(n) n.textContent="Copia local guardada · "+(remote.error||"sin conexión");
        if(g) g.textContent=latest.github?"Incidencia pendiente":"No requerido";
      }else{
        if(n) n.textContent=remote?.notion?.saved?"✓ Registro creado":"Guardado localmente";
        if(g) g.textContent=latest.github?(remote?.github?.created?"✓ Incidencia creada":"Incidencia pendiente"):"No requerido";

        if(nl&&remote?.notion?.url){
          nl.href=remote.notion.url;
          nl.classList.remove("hidden");
        }

        if(gl&&remote?.github?.url){
          gl.href=remote.github.url;
          gl.classList.remove("hidden");
        }
      }

      activate("visit");
      $("resultCard")?.classList.add("hidden");
      $("saveSuccess").classList.remove("hidden");
      $("saveSuccess").scrollIntoView({behavior:"smooth"});
      historyData=[];
    };
  }

  setTimeout(loadHistory,500);
});