'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = __dirname;
loadEnv(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT || 3000);
const NOTION_VERSION = process.env.NOTION_VERSION || '2026-03-11';
const GITHUB_API_VERSION = process.env.GITHUB_API_VERSION || '2026-03-10';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

const DEMO_COMPANIES = [
  { id: 'demo-company-1', name: 'Agrícola Los Robles' },
  { id: 'demo-company-2', name: 'Agrícola Santa Elena' },
  { id: 'demo-company-3', name: 'Frutícola Valle Central' }
];

const DEMO_FIELDS = {
  'demo-company-1': [
    { id: 'demo-field-1', name: 'Fundo Los Robles' },
    { id: 'demo-field-2', name: 'Predio Norte' }
  ],
  'demo-company-2': [
    { id: 'demo-field-3', name: 'Campo Santa Elena' }
  ],
  'demo-company-3': [
    { id: 'demo-field-4', name: 'Fundo Principal' },
    { id: 'demo-field-5', name: 'Sector Packing' }
  ]
};

const dataSourceCache = new Map();

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function normalize(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function compactText(value, max = 1900) {
  const text = String(value || '').trim();
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function notionReadConfigured() {
  return Boolean(
    process.env.NOTION_API_KEY &&
    process.env.NOTION_COMPANIES_DATA_SOURCE_ID &&
    process.env.NOTION_FIELDS_DATA_SOURCE_ID
  );
}

function notionWriteConfigured() {
  return Boolean(
    process.env.NOTION_API_KEY &&
    process.env.NOTION_VISITS_DATA_SOURCE_ID
  );
}

function githubConfigured() {
  return Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO);
}

function json(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error('La solicitud es demasiado grande.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

async function notionRequest(endpoint, options = {}) {
  if (!process.env.NOTION_API_KEY) throw new Error('Falta NOTION_API_KEY.');

  const response = await fetch('https://api.notion.com/v1' + endpoint, {
    ...options,
    headers: {
      'Authorization': 'Bearer ' + process.env.NOTION_API_KEY,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw }; }

  if (!response.ok) {
    const detail = data?.message || ('HTTP ' + response.status);
    throw new Error('Notion: ' + detail);
  }
  return data;
}

async function queryAllDataSource(dataSourceId) {
  const results = [];
  let startCursor;

  do {
    const body = { page_size: 100 };
    if (startCursor) body.start_cursor = startCursor;

    const data = await notionRequest('/data_sources/' + encodeURIComponent(dataSourceId) + '/query', {
      method: 'POST',
      body: JSON.stringify(body)
    });

    results.push(...(data.results || []));
    startCursor = data.has_more ? data.next_cursor : null;
  } while (startCursor);

  return results;
}

async function retrieveDataSource(dataSourceId) {
  if (dataSourceCache.has(dataSourceId)) return dataSourceCache.get(dataSourceId);
  const data = await notionRequest('/data_sources/' + encodeURIComponent(dataSourceId));
  dataSourceCache.set(dataSourceId, data);
  return data;
}

function pageTitle(page) {
  for (const prop of Object.values(page?.properties || {})) {
    if (prop?.type === 'title') {
      const title = (prop.title || []).map(part => part?.plain_text || part?.text?.content || '').join('').trim();
      if (title) return title;
    }
  }
  return page?.url || page?.id || 'Sin nombre';
}

function pageHasRelationTo(page, targetId, explicitProperty) {
  const props = page?.properties || {};

  if (explicitProperty && props[explicitProperty]?.type === 'relation') {
    return (props[explicitProperty].relation || []).some(item => item.id === targetId);
  }

  return Object.values(props).some(prop =>
    prop?.type === 'relation' &&
    (prop.relation || []).some(item => item.id === targetId)
  );
}

function findSchemaProperty(schema, explicitName, candidates, allowedTypes = []) {
  const properties = schema?.properties || {};

  if (explicitName && properties[explicitName]) {
    const prop = properties[explicitName];
    if (!allowedTypes.length || allowedTypes.includes(prop.type)) {
      return { name: explicitName, ...prop };
    }
  }

  const entries = Object.entries(properties);
  for (const candidate of candidates) {
    const normalizedCandidate = normalize(candidate);
    const exact = entries.find(([name, prop]) =>
      normalize(name) === normalizedCandidate &&
      (!allowedTypes.length || allowedTypes.includes(prop.type))
    );
    if (exact) return { name: exact[0], ...exact[1] };
  }

  for (const candidate of candidates) {
    const normalizedCandidate = normalize(candidate);
    const fuzzy = entries.find(([name, prop]) =>
      normalize(name).includes(normalizedCandidate) &&
      (!allowedTypes.length || allowedTypes.includes(prop.type))
    );
    if (fuzzy) return { name: fuzzy[0], ...fuzzy[1] };
  }

  const fallback = entries.find(([, prop]) => !allowedTypes.length || allowedTypes.includes(prop.type));
  return fallback ? { name: fallback[0], ...fallback[1] } : null;
}

function richTextValue(text) {
  const content = compactText(text);
  return content ? { rich_text: [{ type: 'text', text: { content } }] } : { rich_text: [] };
}

function titleValue(text) {
  const content = compactText(text, 500);
  return { title: [{ type: 'text', text: { content } }] };
}

function relationValue(id) {
  return id ? { relation: [{ id }] } : { relation: [] };
}

function dateValue(value) {
  return value ? { date: { start: value } } : { date: null };
}

function selectOrStatusValue(prop, value) {
  if (!prop || !value) return null;
  const optionList = prop[prop.type]?.options || [];
  const match = optionList.find(option => normalize(option.name) === normalize(value));
  if (!match) return null;
  return prop.type === 'status'
    ? { status: { name: match.name } }
    : { select: { name: match.name } };
}

async function listCompanies() {
  if (!notionReadConfigured()) return { mode: 'demo', items: DEMO_COMPANIES };

  const pages = await queryAllDataSource(process.env.NOTION_COMPANIES_DATA_SOURCE_ID);
  const items = pages
    .map(page => ({ id: page.id, name: pageTitle(page) }))
    .filter(item => item.name)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  return { mode: 'live', items };
}

async function listFields(companyId) {
  if (!notionReadConfigured()) {
    return { mode: 'demo', items: DEMO_FIELDS[companyId] || [] };
  }

  const pages = await queryAllDataSource(process.env.NOTION_FIELDS_DATA_SOURCE_ID);
  const relationProperty = process.env.NOTION_FIELD_COMPANY_RELATION_PROPERTY || '';

  const items = pages
    .filter(page => !companyId || pageHasRelationTo(page, companyId, relationProperty))
    .map(page => ({ id: page.id, name: pageTitle(page) }))
    .filter(item => item.name)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  return { mode: 'live', items };
}

function notionPropertyText(prop) {
  if (!prop) return '';
  if (prop.type === 'title') return (prop.title || []).map(x => x?.plain_text || x?.text?.content || '').join('').trim();
  if (prop.type === 'rich_text') return (prop.rich_text || []).map(x => x?.plain_text || x?.text?.content || '').join('').trim();
  if (prop.type === 'select') return prop.select?.name || '';
  if (prop.type === 'status') return prop.status?.name || '';
  if (prop.type === 'date') return prop.date?.start || '';
  if (prop.type === 'checkbox') return Boolean(prop.checkbox);
  if (prop.type === 'url') return prop.url || '';
  if (prop.type === 'number') return prop.number ?? '';
  return '';
}

function notionRelationIds(prop) {
  return prop?.type === 'relation' ? (prop.relation || []).map(x => x.id).filter(Boolean) : [];
}

async function listNotionVisits() {
  if (!notionWriteConfigured()) return { mode: 'demo', items: [] };

  const dataSourceId = process.env.NOTION_VISITS_DATA_SOURCE_ID;
  const [schema, pages, companiesResult, fieldsResult] = await Promise.all([
    retrieveDataSource(dataSourceId),
    queryAllDataSource(dataSourceId),
    notionReadConfigured() ? queryAllDataSource(process.env.NOTION_COMPANIES_DATA_SOURCE_ID) : Promise.resolve([]),
    notionReadConfigured() ? queryAllDataSource(process.env.NOTION_FIELDS_DATA_SOURCE_ID) : Promise.resolve([])
  ]);

  const companyNames = new Map(companiesResult.map(page => [page.id, pageTitle(page)]));
  const fieldNames = new Map(fieldsResult.map(page => [page.id, pageTitle(page)]));

  const companyProp = findSchemaProperty(schema, process.env.NOTION_VISIT_COMPANY_RELATION_PROPERTY, ['Empresa', 'Empresas', 'Cliente', 'Cuenta'], ['relation']);
  const fieldProp = findSchemaProperty(schema, process.env.NOTION_VISIT_FIELD_RELATION_PROPERTY, ['Campo', 'Campos', 'Ubicación', 'Ubicacion', 'Proyecto'], ['relation']);
  const dateProp = findSchemaProperty(schema, process.env.NOTION_VISIT_DATE_PROPERTY, ['Fecha visita', 'Fecha de visita', 'Fecha'], ['date']);
  const typeProp = findSchemaProperty(schema, process.env.NOTION_VISIT_TYPE_PROPERTY, ['Tipo de visita', 'Tipo'], ['select', 'status']);
  const reviewedProp = findSchemaProperty(schema, process.env.NOTION_VISIT_REVIEWED_PROPERTY, ['Temas revisados', 'Revisado', 'Actividades'], ['rich_text']);
  const requestsProp = findSchemaProperty(schema, process.env.NOTION_VISIT_REQUESTS_PROPERTY, ['Solicitudes', 'Solicitudes del cliente', 'Requerimientos'], ['rich_text']);
  const teamProp = findSchemaProperty(schema, process.env.NOTION_VISIT_TEAM_COMMITMENTS_PROPERTY, ['Compromisos equipo', 'Compromisos NIDA', 'Compromisos AgroInventario'], ['rich_text']);
  const clientProp = findSchemaProperty(schema, process.env.NOTION_VISIT_CLIENT_COMMITMENTS_PROPERTY, ['Compromisos cliente', 'Compromisos del cliente'], ['rich_text']);
  const explanationProp = findSchemaProperty(schema, process.env.NOTION_VISIT_EXPLANATION_PROPERTY, ['Explicaciones', 'Pasos realizados', 'Detalle'], ['rich_text']);
  const nextStepsProp = findSchemaProperty(schema, process.env.NOTION_VISIT_NEXT_STEPS_PROPERTY, ['Próximos pasos', 'Proximos pasos', 'Próxima acción', 'Proxima accion'], ['rich_text']);
  const followupProp = findSchemaProperty(schema, process.env.NOTION_VISIT_FOLLOWUP_PROPERTY, ['Seguimiento', 'Seguimientos pendientes', 'Pendientes'], ['rich_text']);
  const nextDateProp = findSchemaProperty(schema, process.env.NOTION_VISIT_NEXT_DATE_PROPERTY, ['Próxima fecha', 'Proxima fecha', 'Próxima acción fecha', 'Fecha próxima'], ['rich_text']);
  const reportProp = findSchemaProperty(schema, process.env.NOTION_VISIT_REPORT_PROPERTY, ['Reporte original', 'Bitácora', 'Bitacora', 'Notas'], ['rich_text']);
  const githubProp = findSchemaProperty(schema, process.env.NOTION_VISIT_GITHUB_FLAG_PROPERTY, ['Incidencia', 'GitHub', 'Requiere GitHub'], ['checkbox']);
  const githubUrlProp = findSchemaProperty(schema, process.env.NOTION_VISIT_GITHUB_URL_PROPERTY, ['GitHub Issue', 'Issue GitHub', 'GitHub URL'], ['url']);
  const githubNumberProp = findSchemaProperty(schema, process.env.NOTION_VISIT_GITHUB_NUMBER_PROPERTY, ['GitHub #', 'GitHub Issue #', 'Issue #'], ['number']);

  const items = pages.map(page => {
    const props = page.properties || {};
    const companyIds = companyProp ? notionRelationIds(props[companyProp.name]) : [];
    const fieldIds = fieldProp ? notionRelationIds(props[fieldProp.name]) : [];
    return {
      id: page.id,
      source: 'notion',
      notionUrl: page.url || '',
      client: companyNames.get(companyIds[0]) || 'Empresa sin nombre',
      location: fieldNames.get(fieldIds[0]) || 'Campo sin nombre',
      companyId: companyIds[0] || '',
      fieldId: fieldIds[0] || '',
      type: typeProp ? notionPropertyText(props[typeProp.name]) : '',
      visitDate: dateProp ? notionPropertyText(props[dateProp.name]) : '',
      reviewed: reviewedProp ? notionPropertyText(props[reviewedProp.name]) : '',
      requests: requestsProp ? notionPropertyText(props[requestsProp.name]) : '',
      teamCommitments: teamProp ? notionPropertyText(props[teamProp.name]) : '',
      clientCommitments: clientProp ? notionPropertyText(props[clientProp.name]) : '',
      explanation: explanationProp ? notionPropertyText(props[explanationProp.name]) : '',
      nextSteps: nextStepsProp ? notionPropertyText(props[nextStepsProp.name]) : '',
      followup: followupProp ? notionPropertyText(props[followupProp.name]) : '',
      nextDate: nextDateProp ? notionPropertyText(props[nextDateProp.name]) : '',
      reportOriginal: reportProp ? notionPropertyText(props[reportProp.name]) : '',
      github: githubProp ? Boolean(props[githubProp.name]?.checkbox) : false,
      githubUrl: githubUrlProp ? notionPropertyText(props[githubUrlProp.name]) : '',
      githubNumber: githubNumberProp ? notionPropertyText(props[githubNumberProp.name]) : '',
      createdAt: page.created_time || ''
    };
  }).sort((a, b) => String(b.visitDate || b.createdAt).localeCompare(String(a.visitDate || a.createdAt)));

  return { mode: 'live', items };
}

async function createNotionVisit(record) {
  if (!notionWriteConfigured()) return null;

  const dataSourceId = process.env.NOTION_VISITS_DATA_SOURCE_ID;
  const schema = await retrieveDataSource(dataSourceId);
  const properties = {};

  const titleProp = findSchemaProperty(schema, process.env.NOTION_VISIT_TITLE_PROPERTY, ['Nombre', 'Registro', 'Visita', 'Título', 'Titulo'], ['title']);
  if (!titleProp) throw new Error('Notion: no se encontró una propiedad title en la base de visitas.');
  properties[titleProp.name] = titleValue(record.client + ' · ' + record.location + ' · ' + record.visitDate);

  const companyProp = findSchemaProperty(schema, process.env.NOTION_VISIT_COMPANY_RELATION_PROPERTY, ['Empresa', 'Empresas', 'Cliente', 'Cuenta'], ['relation']);
  if (companyProp && record.companyId && !String(record.companyId).startsWith('demo-')) {
    properties[companyProp.name] = relationValue(record.companyId);
  }

  const fieldProp = findSchemaProperty(schema, process.env.NOTION_VISIT_FIELD_RELATION_PROPERTY, ['Campo', 'Campos', 'Ubicación', 'Ubicacion', 'Proyecto'], ['relation']);
  if (fieldProp && record.fieldId && !String(record.fieldId).startsWith('demo-')) {
    properties[fieldProp.name] = relationValue(record.fieldId);
  }

  const dateProp = findSchemaProperty(schema, process.env.NOTION_VISIT_DATE_PROPERTY, ['Fecha visita', 'Fecha de visita', 'Fecha'], ['date']);
  if (dateProp) properties[dateProp.name] = dateValue(record.visitDate);

  const typeProp = findSchemaProperty(schema, process.env.NOTION_VISIT_TYPE_PROPERTY, ['Tipo de visita', 'Tipo'], ['select', 'status']);
  const typeValue = selectOrStatusValue(typeProp, record.type);
  if (typeProp && typeValue) properties[typeProp.name] = typeValue;

  const richMappings = [
    ['NOTION_VISIT_REVIEWED_PROPERTY', ['Temas revisados', 'Revisado', 'Actividades'], record.reviewed],
    ['NOTION_VISIT_REQUESTS_PROPERTY', ['Solicitudes', 'Solicitudes del cliente', 'Requerimientos'], record.requests],
    ['NOTION_VISIT_TEAM_COMMITMENTS_PROPERTY', ['Compromisos equipo', 'Compromisos NIDA', 'Compromisos AgroInventario'], record.teamCommitments],
    ['NOTION_VISIT_CLIENT_COMMITMENTS_PROPERTY', ['Compromisos cliente', 'Compromisos del cliente'], record.clientCommitments],
    ['NOTION_VISIT_EXPLANATION_PROPERTY', ['Explicaciones', 'Pasos realizados', 'Detalle'], record.explanation],
    ['NOTION_VISIT_NEXT_STEPS_PROPERTY', ['Próximos pasos', 'Proximos pasos', 'Próxima acción', 'Proxima accion'], record.nextSteps],
    ['NOTION_VISIT_FOLLOWUP_PROPERTY', ['Seguimiento', 'Seguimientos pendientes', 'Pendientes'], record.followup],
    ['NOTION_VISIT_REPORT_PROPERTY', ['Reporte original', 'Bitácora', 'Bitacora', 'Notas'], record.reportOriginal]
  ];

  for (const [envKey, candidates, value] of richMappings) {
    if (!value) continue;
    const prop = findSchemaProperty(schema, process.env[envKey], candidates, ['rich_text']);
    if (prop) properties[prop.name] = richTextValue(value);
  }

  const nextDateProp = findSchemaProperty(schema, process.env.NOTION_VISIT_NEXT_DATE_PROPERTY, ['Próxima fecha', 'Proxima fecha', 'Próxima acción fecha', 'Fecha próxima'], ['rich_text']);
  if (nextDateProp && record.nextDate) properties[nextDateProp.name] = richTextValue(record.nextDate);

  const githubFlagProp = findSchemaProperty(schema, process.env.NOTION_VISIT_GITHUB_FLAG_PROPERTY, ['Incidencia', 'GitHub', 'Requiere GitHub'], ['checkbox']);
  if (githubFlagProp) properties[githubFlagProp.name] = { checkbox: Boolean(record.github) };

  const payload = {
    parent: { type: 'data_source_id', data_source_id: dataSourceId },
    properties
  };

  return notionRequest('/pages', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

async function attachGithubIssueToNotion(pageId, issue) {
  if (!pageId || !issue) return;
  const schema = await retrieveDataSource(process.env.NOTION_VISITS_DATA_SOURCE_ID);
  const properties = {};
  const urlProp = findSchemaProperty(schema, process.env.NOTION_VISIT_GITHUB_URL_PROPERTY, ['GitHub Issue', 'Issue GitHub', 'GitHub URL'], ['url']);
  const numberProp = findSchemaProperty(schema, process.env.NOTION_VISIT_GITHUB_NUMBER_PROPERTY, ['GitHub #', 'GitHub Issue #', 'Issue #'], ['number']);
  if (urlProp && issue.html_url) properties[urlProp.name] = { url: issue.html_url };
  if (numberProp && issue.number != null) properties[numberProp.name] = { number: issue.number };
  if (!Object.keys(properties).length) return;
  return notionRequest('/pages/' + encodeURIComponent(pageId), {
    method: 'PATCH',
    body: JSON.stringify({ properties })
  });
}

function issueBody(record) {
  return [
    '## Cliente',
    record.client + ' · ' + record.location,
    '',
    '## Módulo / sección',
    record.githubSection || 'Por confirmar',
    '',
    '## Prioridad',
    record.githubPriority || 'Por confirmar',
    '',
    '## Problema',
    record.githubProblem || 'Por confirmar',
    '',
    '## Pasos para replicarlo',
    record.githubSteps || 'Por confirmar',
    '',
    '## Contexto',
    record.githubContext || record.reportOriginal || 'Sin antecedentes adicionales',
    '',
    '---',
    'Registro generado desde Asistente de Terreno NIDA. Fecha visita: ' + (record.visitDate || 'sin fecha')
  ].join('\n');
}

async function githubRequest(endpoint, options = {}) {
  if (!githubConfigured()) throw new Error('Faltan GITHUB_TOKEN o GITHUB_REPO.');

  const response = await fetch('https://api.github.com' + endpoint, {
    ...options,
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + process.env.GITHUB_TOKEN,
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw }; }

  if (!response.ok) {
    throw new Error('GitHub: ' + (data?.message || ('HTTP ' + response.status)));
  }
  return data;
}

async function createGithubIssue(record) {
  if (!githubConfigured() || !record.github) return null;

  const labels = String(process.env.GITHUB_ISSUE_LABELS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);

  const title = '[Incidencia] ' + record.client + ' - ' + (record.githubSection || record.location);
  const body = { title, body: issueBody(record) };
  if (labels.length) body.labels = labels;

  return githubRequest('/repos/' + process.env.GITHUB_REPO + '/issues', {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

async function integrationStatus() {
  const notion = {
    configured: notionReadConfigured(),
    writeConfigured: notionWriteConfigured(),
    connected: false,
    mode: notionReadConfigured() ? 'live' : 'demo',
    message: notionReadConfigured() ? 'Configurado; verificando…' : 'Modo demo · faltan credenciales'
  };

  const github = {
    configured: githubConfigured(),
    connected: false,
    repo: process.env.GITHUB_REPO || '',
    mode: githubConfigured() ? 'live' : 'demo',
    message: githubConfigured() ? 'Configurado; verificando…' : 'Modo demo · faltan credenciales'
  };

  if (notionReadConfigured()) {
    try {
      await retrieveDataSource(process.env.NOTION_COMPANIES_DATA_SOURCE_ID);
      notion.connected = true;
      notion.message = notionWriteConfigured()
        ? 'Conectado · lectura y escritura'
        : 'Conectado · lectura (falta base de visitas)';
    } catch (error) {
      notion.message = error.message;
    }
  }

  if (githubConfigured()) {
    try {
      await githubRequest('/repos/' + process.env.GITHUB_REPO);
      github.connected = true;
      github.message = 'Conectado · ' + process.env.GITHUB_REPO;
    } catch (error) {
      github.message = error.message;
    }
  }

  return { notion, github };
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, { ok: true, service: 'NIDA Asistente de Terreno', version: '1.0.0' });
  }

  if (req.method === 'GET' && url.pathname === '/api/integrations/status') {
    const status = await integrationStatus();
    return json(res, 200, status);
  }

  if (req.method === 'GET' && url.pathname === '/api/notion/companies') {
    const result = await listCompanies();
    return json(res, 200, result);
  }

  if (req.method === 'GET' && url.pathname === '/api/notion/fields') {
    const companyId = url.searchParams.get('companyId') || '';
    const result = await listFields(companyId);
    return json(res, 200, result);
  }

  if (req.method === 'GET' && url.pathname === '/api/visits') {
    const result = await listNotionVisits();
    return json(res, 200, result);
  }

  if (req.method === 'POST' && url.pathname === '/api/visits') {
    const record = await readJsonBody(req);
    if (!record.client || !record.location || !record.reportOriginal) {
      return json(res, 400, { ok: false, error: 'Faltan cliente, ubicación o reporte original.' });
    }

    const result = {
      ok: true,
      notion: { saved: false, mode: notionWriteConfigured() ? 'live' : 'demo' },
      github: { created: false, mode: githubConfigured() ? 'live' : 'demo' }
    };

    let notionPage = null;
    let githubIssue = null;

    if (notionWriteConfigured()) {
      notionPage = await createNotionVisit(record);
      result.notion = {
        saved: true,
        mode: 'live',
        pageId: notionPage?.id || null,
        url: notionPage?.url || null
      };
    }

    if (record.github && githubConfigured()) {
      githubIssue = await createGithubIssue(record);
      result.github = {
        created: true,
        mode: 'live',
        number: githubIssue?.number || null,
        url: githubIssue?.html_url || null
      };
      if (notionPage?.id && githubIssue) {
        await attachGithubIssueToNotion(notionPage.id, githubIssue);
      }
    }

    return json(res, 200, result);
  }

  if (req.method === 'GET' && url.pathname === '/api/notion/schema') {
    const dataSourceId = url.searchParams.get('dataSourceId');
    if (!dataSourceId) return json(res, 400, { ok: false, error: 'Falta dataSourceId.' });
    const schema = await retrieveDataSource(dataSourceId);
    return json(res, 200, {
      id: schema.id,
      title: schema.title,
      properties: schema.properties
    });
  }

  return json(res, 404, { ok: false, error: 'Ruta API no encontrada.' });
}

function serveStatic(req, res, url) {
  let relativePath = decodeURIComponent(url.pathname);
  if (relativePath === '/') relativePath = '/index.html';

  const safePath = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(ROOT, safePath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Archivo no encontrado.');
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=300'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    if (url.pathname.startsWith('/api/')) {
      return await handleApi(req, res, url);
    }
    return serveStatic(req, res, url);
  } catch (error) {
    console.error('[NIDA]', error);
    return json(res, 500, { ok: false, error: error.message || 'Error interno.' });
  }
});

server.listen(PORT, () => {
  console.log('NIDA Asistente de Terreno listo en http://localhost:' + PORT);
  console.log('Notion: ' + (notionReadConfigured() ? 'configurado' : 'modo demo'));
  console.log('GitHub: ' + (githubConfigured() ? 'configurado' : 'modo demo'));
});
