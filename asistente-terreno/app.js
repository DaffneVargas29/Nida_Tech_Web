document.addEventListener("DOMContentLoaded", () => {
  const $ = id => document.getElementById(id);
  const STORAGE = "nida_records_v5";
  const TOKEN_KEY = "nida_auth_token_v1";
  const USER_KEY = "nida_auth_user_v1";

  let user = null;
  let current = null;
  let companies = [];
  let fields = [];
  let historyData = [];

  const views = {
    dashboard: ["Inicio", "Gestiona registros desde un solo lugar."],
    visit: ["Nueva visita", "Captura la información mientras aún está fresca."],
    history: ["Historial", "Consulta toda la información registrada y sincronizada."]
  };

  function esc(value = "") {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function norm(value = "") {
    return String(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function token() {
    return sessionStorage.getItem(TOKEN_KEY) || "";
  }

  function clearSession() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    user = null;
  }

  function showLogin(message = "") {
    clearSession();
    $("appScreen").classList.add("hidden");
    $("loginScreen").classList.remove("hidden");
    $("loginError").textContent = message || "Correo o contraseña incorrectos.";
    $("loginError").classList.toggle("hidden", !message);
    $("password").value = "";
  }

  async function api(url, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {})
    };

    if (token() && url !== "/api/auth/login") {
      headers.Authorization = "Bearer " + token();
    }

    const response = await fetch(url, { ...options, headers });
    const data = await response.json().catch(() => ({}));

    if (response.status === 401 && url !== "/api/auth/login") {
      showLogin("Tu sesión venció. Ingresa nuevamente.");
      throw new Error(data.error || "Sesión vencida.");
    }

    if (!response.ok) {
      throw new Error(data.error || ("HTTP " + response.status));
    }

    return data;
  }

  async function login() {
    const button = $("loginBtn");
    const email = $("email").value.trim().toLowerCase();
    const password = $("password").value;

    if (!email || !password) {
      $("loginError").textContent = "Ingresa correo y contraseña.";
      $("loginError").classList.remove("hidden");
      return;
    }

    button.disabled = true;
    button.textContent = "Ingresando…";
    $("loginError").classList.add("hidden");

    try {
      const result = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });

      sessionStorage.setItem(TOKEN_KEY, result.token);
      sessionStorage.setItem(USER_KEY, JSON.stringify(result.user));
      user = result.user;
      showApp();
    } catch (error) {
      $("loginError").textContent = error.message;
      $("loginError").classList.remove("hidden");
    } finally {
      button.disabled = false;
      button.textContent = "Ingresar";
    }
  }

  async function restoreSession() {
    if (!token()) return;

    try {
      const result = await api("/api/auth/me");
      user = result.user;
      sessionStorage.setItem(USER_KEY, JSON.stringify(user));
      showApp();
    } catch {
      showLogin();
    }
  }

  function showApp() {
    if (!user) return;

    $("loginScreen").classList.add("hidden");
    $("appScreen").classList.remove("hidden");
    $("workspaceName").textContent = user.workspace || "AgroInventario";
    $("workspacePlan").textContent = user.plan || "Piloto activo";
    $("userName").textContent = user.name || user.email;
    $("userEmail").textContent = user.email || "";
    $("welcomeTitle").textContent = (user.workspace || "AgroInventario") + ", tu espacio está listo.";

    nav("dashboard");
    status();
    loadCompanies();
    loadHistory();
  }

  function logout() {
    clearSession();
    location.reload();
  }

  function nav(id) {
    document.querySelectorAll(".view").forEach(x => x.classList.add("hidden"));
    $(id)?.classList.remove("hidden");
    document.querySelectorAll(".nav").forEach(x => x.classList.toggle("active", x.dataset.view === id));

    if (views[id]) {
      $("pageTitle").textContent = views[id][0];
      $("pageSubtitle").textContent = views[id][1];
    }

    if (id === "dashboard" || id === "history") loadHistory();
  }

  function setStatus(textElement, dotElement, integration) {
    textElement.textContent = integration?.message || "No disponible";
    dotElement.className = "dot " + (integration?.connected ? "connected" : "pending");
  }

  async function status() {
    try {
      const data = await api("/api/integrations/status");
      setStatus($("notionStatusText"), $("notionStatusDot"), data.notion);
      setStatus($("githubStatusText"), $("githubStatusDot"), data.github);
    } catch (error) {
      if (!user) return;
      $("notionStatusText").textContent = "Servidor no disponible";
      $("githubStatusText").textContent = "Servidor no disponible";
    }
  }

  async function loadCompanies() {
    const select = $("clientInput");
    select.disabled = true;
    select.innerHTML = '<option value="">Cargando empresas…</option>';

    try {
      const data = await api("/api/notion/companies");
      companies = data.items || [];
      select.innerHTML = '<option value="">Selecciona una empresa</option>' +
        companies.map(x => '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>').join("");
      select.disabled = false;
    } catch (error) {
      if (!user) return;
      select.innerHTML = '<option value="">No se pudieron cargar empresas</option>';
    }
  }

  async function loadFields(companyId) {
    const select = $("locationInput");
    select.disabled = true;
    select.innerHTML = '<option value="">Cargando campos…</option>';

    if (!companyId) {
      select.innerHTML = '<option value="">Selecciona primero una empresa</option>';
      return;
    }

    try {
      const data = await api("/api/notion/fields?companyId=" + encodeURIComponent(companyId));
      fields = data.items || [];
      select.innerHTML = '<option value="">Selecciona un campo / proyecto</option>' +
        fields.map(x => '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>').join("");
      select.disabled = false;
    } catch {
      if (!user) return;
      select.innerHTML = '<option value="">No se pudieron cargar campos</option>';
    }
  }

  function selectedText(select) {
    return select.options[select.selectedIndex]?.textContent?.trim() || "";
  }

  function sentences(value = "") {
    return value.split(/(?<=[.!?])\s+|\n+/).map(x => x.trim()).filter(Boolean);
  }

  function matching(value, keys, fallback = "Por confirmar") {
    const found = sentences(value).filter(x => keys.some(k => norm(x).includes(norm(k))));
    return found.join("\n") || fallback;
  }

  function first(value, keys) {
    return sentences(value).find(x => keys.some(k => norm(x).includes(norm(k)))) || "";
  }

  function visitType(value) {
    const n = norm(value);
    if (n.includes("implement")) return "Implementación";
    if (n.includes("capacit")) return "Capacitación";
    if (n.includes("seguimiento")) return "Seguimiento";
    if (n.includes("reunion")) return "Reunión";
    return "Visita a terreno";
  }

  function detectsIssue(value) {
    const n = norm(value);
    return ["error", "falla", "incidencia", "bug", "no funciona", "no permite", "no deja", "problema del sistema"]
      .some(key => n.includes(key));
  }

  function detectSection(value) {
    const candidates = ["módulo de inventario", "inventario", "guía de despacho", "reportes", "facturación", "usuarios", "configuración"];
    const n = norm(value);
    return candidates.find(x => n.includes(norm(x))) || "Por confirmar";
  }

  function detectNextDate(value) {
    const n = norm(value);
    for (const day of ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"]) {
      if (n.includes(day)) return day.charAt(0).toUpperCase() + day.slice(1);
    }
    const match = value.match(/\b(\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?)\b/);
    return match ? match[1] : "Por confirmar";
  }

  function today() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function buildCurrentRecord() {
    const companyId = $("clientInput").value;
    const fieldId = $("locationInput").value;
    const client = selectedText($("clientInput"));
    const location = selectedText($("locationInput"));
    const report = $("reportInput").value.trim();

    if (!companyId) return alert("Selecciona una empresa.");
    if (!fieldId) return alert("Selecciona un campo o proyecto.");
    if (!report) return alert("Escribe o dicta el reporte.");

    const issue = detectsIssue(report);

    current = {
      id: Date.now(),
      workspace: user.workspace,
      companyId,
      fieldId,
      client,
      location,
      type: visitType(report),
      visitDate: today(),
      reviewed: matching(report, ["revisamos", "vimos", "analizamos", "explicamos", "capacitamos", "configuramos", "mostramos"]),
      requests: matching(report, ["cliente solicit", "cliente pidió", "cliente pidio", "nos solicitaron", "nos pidieron", "requiere"], "Sin solicitudes adicionales detectadas."),
      teamCommitments: matching(report, ["nosotros quedamos", "quedamos de", "vamos a revisar", "vamos a validar", "debemos revisar"]),
      clientCommitments: matching(report, ["cliente quedó", "cliente quedo", "cliente debe", "cliente enviará", "cliente enviara"]),
      explanation: matching(report, ["explicamos", "paso a paso", "mostramos", "capacitamos", "indicamos"]),
      nextSteps: matching(report, ["nos reuniremos", "próxima", "proxima", "siguiente", "volveremos", "seguimiento"]),
      followup: matching(report, ["pendiente", "revisar", "validar", "confirmar", "falta", "queda por"]),
      nextDate: detectNextDate(report),
      github: issue,
      githubSection: issue ? detectSection(report) : "",
      githubPriority: "",
      githubProblem: issue ? (first(report, ["error", "falla", "incidencia", "problema"]) || "Por confirmar") : "",
      githubSteps: issue ? matching(report, ["al intentar", "al presionar", "después de", "despues de", "cuando", "guardar"]) : "",
      githubContext: issue ? report : "",
      reportOriginal: report,
      createdAt: new Date().toLocaleString("es-CL")
    };

    fillReview();
  }

  function fillReview() {
    const r = current;
    ["Client", "Location", "Type", "VisitDate", "Reviewed", "Requests", "TeamCommitments", "ClientCommitments", "Explanation", "NextSteps", "Followup", "NextDate"]
      .forEach(key => {
        $("result" + key).value = r[key.charAt(0).toLowerCase() + key.slice(1)] || "";
      });

    $("resultGithub").value = String(r.github);
    $("githubSection").value = r.githubSection;
    $("githubPriority").value = r.githubPriority;
    $("githubProblem").value = r.githubProblem;
    $("githubSteps").value = r.githubSteps;
    $("githubContext").value = r.githubContext;
    $("githubDraft").classList.toggle("hidden", !r.github);
    $("resultCard").classList.remove("hidden");
    $("saveSuccess").classList.add("hidden");
    $("resultCard").scrollIntoView({ behavior: "smooth" });
  }

  function editedRecord() {
    return {
      ...current,
      client: $("resultClient").value.trim(),
      location: $("resultLocation").value.trim(),
      type: $("resultType").value.trim(),
      visitDate: $("resultVisitDate").value,
      reviewed: $("resultReviewed").value.trim(),
      requests: $("resultRequests").value.trim(),
      teamCommitments: $("resultTeamCommitments").value.trim(),
      clientCommitments: $("resultClientCommitments").value.trim(),
      explanation: $("resultExplanation").value.trim(),
      nextSteps: $("resultNextSteps").value.trim(),
      followup: $("resultFollowup").value.trim(),
      nextDate: $("resultNextDate").value.trim(),
      github: $("resultGithub").value === "true",
      githubSection: $("githubSection").value.trim(),
      githubPriority: $("githubPriority").value,
      githubProblem: $("githubProblem").value.trim(),
      githubSteps: $("githubSteps").value.trim(),
      githubContext: $("githubContext").value.trim(),
      createdAt: new Date().toLocaleString("es-CL")
    };
  }

  function localRecords() {
    try {
      const records = JSON.parse(localStorage.getItem(STORAGE) || "[]");
      return Array.isArray(records) ? records : [];
    } catch {
      return [];
    }
  }

  function localWorkspaceRecords() {
    return localRecords().filter(x => x.workspace === user?.workspace);
  }

  function saveLocal(record) {
    const records = localRecords();
    records.unshift(record);
    localStorage.setItem(STORAGE, JSON.stringify(records.slice(0, 500)));
  }

  function formatWhen(value = "") {
    if (!value) return "Sin fecha";
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [y, m, d] = value.split("-");
      return d + "-" + m + "-" + y;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString("es-CL", { dateStyle: "medium", timeStyle: "short" });
  }

  function hasFollowup(record) {
    const value = norm(record?.followup || "");
    return Boolean(value) && !["por confirmar", "sin seguimiento", "sin pendientes", "no aplica", "n/a"].includes(value);
  }

  function mergeHistory(remote = []) {
    const local = localWorkspaceRecords();
    const byPage = new Map();

    local.forEach(x => {
      const id = x.remote?.notion?.pageId;
      if (id) byPage.set(id, x);
    });

    const merged = remote.map(r => {
      const localVersion = byPage.get(r.id);
      return localVersion ? { ...r, remote: localVersion.remote, createdAt: r.createdAt || localVersion.createdAt } : r;
    });

    const remoteIds = new Set(remote.map(x => x.id));
    local.forEach(x => {
      const id = x.remote?.notion?.pageId;
      if (!id || !remoteIds.has(id)) merged.push({ ...x, source: "local" });
    });

    return merged.sort((a, b) => String(b.visitDate || b.createdAt || "").localeCompare(String(a.visitDate || a.createdAt || "")));
  }

  function populateCompanyFilter() {
    const select = $("historyCompanyFilter");
    if (!select) return;

    const selected = select.value || "all";
    const names = [...new Set(historyData.map(x => x.client).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));

    select.innerHTML = '<option value="all">Todas las empresas</option>' +
      names.map(name => '<option value="' + esc(name) + '">' + esc(name) + '</option>').join("");

    select.value = names.includes(selected) ? selected : "all";
  }

  function filteredHistory() {
    const query = norm($("historySearch")?.value || "");
    const issueFilter = $("historyIssueFilter")?.value || "all";
    const companyFilter = $("historyCompanyFilter")?.value || "all";

    return historyData.filter(r => {
      if (issueFilter === "issues" && !r.github) return false;
      if (issueFilter === "noissues" && r.github) return false;
      if (companyFilter !== "all" && r.client !== companyFilter) return false;
      if (!query) return true;

      return norm([
        r.client, r.location, r.type, r.visitDate, r.reviewed, r.requests,
        r.teamCommitments, r.clientCommitments, r.explanation, r.nextSteps,
        r.followup, r.nextDate, r.reportOriginal, r.githubNumber
      ].join(" ")).includes(query);
    });
  }

  function detail(label, value) {
    return '<div class="detail"><small>' + esc(label) + '</small><p>' + esc(value || "Sin información registrada") + '</p></div>';
  }

  function renderHistory() {
    const container = $("historyContainer");
    const meta = $("historyMeta");
    if (!container || !meta) return;

    const rows = filteredHistory();
    meta.textContent = rows.length + " de " + historyData.length + " visitas";

    if (!rows.length) {
      container.innerHTML = '<div class="empty">No encontramos visitas con esos filtros.</div>';
      return;
    }

    container.innerHTML = rows.map(r => {
      const notionUrl = r.notionUrl || r.remote?.notion?.url || "";
      const githubUrl = r.githubUrl || r.remote?.github?.url || "";

      return '<details class="history-item">' +
        '<summary>' +
          '<div><strong>' + esc(r.client) + ' · ' + esc(r.location) + '</strong>' +
          '<p>' + esc(r.type || "Visita") + ' · ' + esc(formatWhen(r.visitDate || r.createdAt)) + '</p></div>' +
          '<div class="history-tags">' +
            (hasFollowup(r) ? '<span class="tag followup">Seguimiento</span>' : '') +
            (r.github ? '<span class="tag issue">⚠ Incidencia' + (r.githubNumber ? ' #' + esc(r.githubNumber) : '') + '</span>' : '<span class="tag ok">Sin incidencia</span>') +
            '<span class="chevron">⌄</span>' +
          '</div>' +
        '</summary>' +
        '<div class="history-detail">' +
          detail("Temas revisados", r.reviewed) +
          detail("Solicitudes del cliente", r.requests) +
          detail("Compromisos AgroInventario", r.teamCommitments) +
          detail("Compromisos del cliente", r.clientCommitments) +
          detail("Explicaciones / pasos realizados", r.explanation) +
          detail("Próximos pasos", r.nextSteps) +
          detail("Seguimientos pendientes", r.followup) +
          detail("Próxima acción / fecha", r.nextDate) +
          detail("Reporte original", r.reportOriginal) +
          '<div class="history-links">' +
            (notionUrl ? '<a class="btn ghost" target="_blank" rel="noopener" href="' + esc(notionUrl) + '">Abrir en Notion</a>' : '') +
            (githubUrl ? '<a class="btn ghost" target="_blank" rel="noopener" href="' + esc(githubUrl) + '">Abrir incidencia GitHub</a>' : '') +
          '</div>' +
        '</div>' +
      '</details>';
    }).join("");
  }

  function renderDashboard() {
    $("statRecords").textContent = historyData.length;
    $("statIssues").textContent = historyData.filter(x => x.github).length;

    const followups = historyData.filter(hasFollowup);
    $("statFollowups").textContent = followups.length;
    $("statLast").textContent = historyData[0] ? formatWhen(historyData[0].visitDate || historyData[0].createdAt) : "Sin registros";

    const box = $("dashboardFollowups");
    if (!box) return;

    if (!followups.length) {
      box.innerHTML = '<div class="empty compact-empty">No hay seguimientos pendientes registrados.</div>';
      return;
    }

    box.innerHTML = followups.slice(0, 5).map(r => {
      const notionUrl = r.notionUrl || r.remote?.notion?.url || "";
      return '<article class="followup-item">' +
        '<div><strong>' + esc(r.client) + ' · ' + esc(r.location) + '</strong>' +
        '<p>' + esc(r.followup || "Seguimiento pendiente") + '</p>' +
        '<small>' + (r.nextDate ? 'Próxima acción: ' + esc(r.nextDate) : 'Sin fecha definida') + '</small></div>' +
        (notionUrl ? '<a class="btn ghost mini" target="_blank" rel="noopener" href="' + esc(notionUrl) + '">Abrir</a>' : '') +
      '</article>';
    }).join("");
  }

  async function loadHistory() {
    const container = $("historyContainer");
    const meta = $("historyMeta");

    if (container) container.innerHTML = '<div class="empty">Cargando historial…</div>';
    if (meta) meta.textContent = "Sincronizando con Notion…";

    try {
      const data = await api("/api/visits");
      historyData = mergeHistory(data.items || []);
    } catch (error) {
      if (!user) return;
      historyData = mergeHistory([]);
      if (meta) meta.textContent = "Mostrando respaldo local · " + error.message;
    }

    populateCompanyFilter();
    renderHistory();
    renderDashboard();
  }

  function csvCell(value = "") {
    return '"' + String(value ?? "").replaceAll('"', '""') + '"';
  }

  function exportCsv() {
    const rows = filteredHistory();

    if (!rows.length) {
      alert("No hay visitas para exportar con los filtros actuales.");
      return;
    }

    const headers = [
      "Empresa", "Campo", "Tipo de visita", "Fecha", "Temas revisados", "Solicitudes del cliente",
      "Compromisos AgroInventario", "Compromisos del cliente", "Explicaciones / pasos realizados",
      "Próximos pasos", "Seguimientos pendientes", "Próxima fecha", "Incidencia", "GitHub #",
      "GitHub Issue", "Reporte original", "Notion"
    ];

    const lines = [headers.map(csvCell).join(";")];

    rows.forEach(r => {
      lines.push([
        r.client, r.location, r.type, r.visitDate, r.reviewed, r.requests, r.teamCommitments,
        r.clientCommitments, r.explanation, r.nextSteps, r.followup, r.nextDate,
        r.github ? "Sí" : "No", r.githubNumber || "", r.githubUrl || r.remote?.github?.url || "",
        r.reportOriginal, r.notionUrl || r.remote?.notion?.url || ""
      ].map(csvCell).join(";"));
    });

    const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "NIDA_historial_visitas_" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function showSaveSuccess(record, remote, error) {
    const card = $("saveSuccess");
    const notionStatus = $("saveNotionStatus");
    const githubStatus = $("saveGithubStatus");
    const notionLink = $("saveNotionLink");
    const githubLink = $("saveGithubLink");

    notionLink.classList.add("hidden");
    githubLink.classList.add("hidden");

    if (error) {
      notionStatus.textContent = "Copia local guardada · " + error.message;
      githubStatus.textContent = record.github ? "Incidencia pendiente" : "No requerido";
    } else {
      notionStatus.textContent = remote?.notion?.saved ? "✓ Registro creado" : "Guardado localmente";
      githubStatus.textContent = record.github
        ? (remote?.github?.created ? "✓ Incidencia creada" : "Incidencia pendiente")
        : "No requerido";

      if (remote?.notion?.url) {
        notionLink.href = remote.notion.url;
        notionLink.classList.remove("hidden");
      }

      if (remote?.github?.url) {
        githubLink.href = remote.github.url;
        githubLink.classList.remove("hidden");
      }
    }

    card.classList.remove("hidden");
    card.scrollIntoView({ behavior: "smooth" });
  }

  async function confirmVisit() {
    if (!current) return;

    const button = $("confirmBtn");
    const oldText = button.textContent;
    const record = editedRecord();

    button.disabled = true;
    button.textContent = "Guardando…";

    let remote = null;
    let error = null;

    try {
      remote = await api("/api/visits", {
        method: "POST",
        body: JSON.stringify(record)
      });
    } catch (e) {
      error = e;
    }

    record.remote = remote || { ok: false, error: error?.message };
    saveLocal(record);

    $("clientInput").value = "";
    $("locationInput").innerHTML = '<option value="">Selecciona primero una empresa</option>';
    $("locationInput").disabled = true;
    $("reportInput").value = "";
    $("resultCard").classList.add("hidden");
    current = null;

    button.disabled = false;
    button.textContent = oldText;

    historyData = [];
    showSaveSuccess(record, remote, error);
    status();
    loadHistory();
  }

  $("loginBtn").onclick = login;
  $("password").onkeydown = event => {
    if (event.key === "Enter") login();
  };
  $("logoutBtn").onclick = logout;

  document.querySelectorAll(".nav").forEach(x => {
    x.onclick = () => nav(x.dataset.view);
  });

  $("goVisitBtn").onclick = () => {
    $("saveSuccess").classList.add("hidden");
    nav("visit");
  };

  $("goHistoryBtn").onclick = () => nav("history");
  $("viewHistoryBtn").onclick = () => nav("history");
  $("newVisitBtn").onclick = () => {
    $("saveSuccess").classList.add("hidden");
    nav("visit");
  };

  $("refreshStatusBtn").onclick = status;
  $("clientInput").onchange = event => loadFields(event.target.value);
  $("processBtn").onclick = buildCurrentRecord;

  $("resultGithub").onchange = event => {
    $("githubDraft").classList.toggle("hidden", event.target.value !== "true");
  };

  $("cancelBtn").onclick = () => {
    $("resultCard").classList.add("hidden");
    current = null;
  };

  $("confirmBtn").onclick = confirmVisit;
  $("historySearch").oninput = renderHistory;
  $("historyCompanyFilter").onchange = renderHistory;
  $("historyIssueFilter").onchange = renderHistory;
  $("historyRefreshBtn").onclick = loadHistory;
  $("historyExportBtn").onclick = exportCsv;

  $("exampleBtn").onclick = async () => {
    if (!companies.length) await loadCompanies();

    if (companies[0]) {
      $("clientInput").value = companies[0].id;
      await loadFields(companies[0].id);
      if (fields[0]) $("locationInput").value = fields[0].id;
    }

    $("reportInput").value =
      "Hoy realizamos una visita de seguimiento. Revisamos el módulo de inventario y explicamos cómo registrar una guía de despacho. " +
      "El cliente solicitó mejorar los reportes. Nosotros quedamos de revisar la solicitud. El cliente enviará capturas. " +
      "Detectamos un error al guardar una guía de despacho. Quedó pendiente revisar la incidencia con TI y nos reuniremos nuevamente el viernes.";
  };

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let listening = false;

  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = "es-CL";
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onstart = () => {
      listening = true;
      $("voiceBtn").textContent = "⏹ Detener";
      $("voiceStatus").textContent = "Escuchando…";
    };

    recognition.onend = () => {
      listening = false;
      $("voiceBtn").textContent = "🎙 Dictar";
      $("voiceStatus").textContent = "Dictado finalizado.";
    };

    recognition.onresult = event => {
      let text = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        if (event.results[i].isFinal) text += event.results[i][0].transcript + " ";
      }

      if (text) {
        $("reportInput").value += ($("reportInput").value ? " " : "") + text.trim();
      }
    };

    $("voiceBtn").onclick = () => listening ? recognition.stop() : recognition.start();
  } else {
    $("voiceBtn").disabled = true;
    $("voiceStatus").textContent = "Dictado no disponible en este navegador.";
  }

  restoreSession();
});