# NIDA Technology · Asistente de Terreno

Build de prueba independiente para registrar visitas y conectarlas directamente con **Notion** y **GitHub**, sin n8n.

## Probar ahora

Requiere Node.js 18 o superior.

```bash
cd asistente-terreno
node server.js
```

Abre:

```text
http://localhost:3000
```

Credenciales demo:

```text
demo@agroinventario.cl
NIDA2026
```

Sin un archivo `.env`, la app funciona en **modo demo** con empresas y campos ficticios. Esto permite revisar el flujo completo sin tocar datos reales.

## Conectar Notion real

1. Copia `.env.example` como `.env`.
2. Crea una integración interna de Notion.
3. Comparte con esa integración las bases de Empresas, Campos y la base de Registros/Visitas.
4. Completa:
   - `NOTION_API_KEY`
   - `NOTION_COMPANIES_DATA_SOURCE_ID`
   - `NOTION_FIELDS_DATA_SOURCE_ID`
   - `NOTION_VISITS_DATA_SOURCE_ID`
5. Reinicia `node server.js`.

El backend usa la API de Notion; el token nunca llega al navegador.

## Conectar GitHub real

Completa en `.env`:

```text
GITHUB_TOKEN=...
GITHUB_REPO=owner/repositorio
```

El token debe tener permiso para crear Issues en el repositorio de AgroInventario.

## Flujo

```text
Empresa de Notion
    ↓
Campo asociado
    ↓
Texto / dictado
    ↓
Resumen editable
    ↓
Confirmar
    ├─ Notion
    ├─ GitHub Issue si hay incidencia
    └─ copia local de respaldo
```

## Endpoints

- `GET /api/health`
- `GET /api/integrations/status`
- `GET /api/notion/companies`
- `GET /api/notion/fields?companyId=...`
- `GET /api/notion/schema?dataSourceId=...`
- `POST /api/visits`

## Antes de producción

El login actual es de piloto/demo. Antes de entregar a clientes debe reemplazarse por autenticación real y desplegarse el backend en un servidor con HTTPS.