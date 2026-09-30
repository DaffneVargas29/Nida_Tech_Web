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

El acceso se configura en `.env`. El correo y la contraseña ya no están escritos en el frontend ni visibles desde el navegador.

Ejemplo:

```text
AUTH_SECRET=una_clave_larga_y_aleatoria
AUTH_SESSION_HOURS=12

APP_USER_1_EMAIL=correo@empresa.cl
APP_USER_1_PASSWORD=una_contrasena_segura
APP_USER_1_NAME=Renato
APP_USER_1_WORKSPACE=AgroInventario
APP_USER_1_PLAN=Piloto activo
APP_USER_1_ROLE=cliente
```

Puedes agregar más usuarios usando `APP_USER_2_...`, `APP_USER_3_...`, etc. La API queda protegida por una sesión firmada en el servidor.

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
    ├─ Notion: visita completa
    ├─ GitHub: Issue si hay incidencia
    ├─ enlace y número del Issue guardados nuevamente en Notion
    └─ copia local de respaldo
```

## Experiencia del piloto

La versión actual incluye:

- historial centralizado leído desde Notion;
- búsqueda por empresa, campo y contenido;
- filtros por empresa e incidencias;
- vista expandible con el detalle completo de cada visita;
- accesos directos al registro de Notion y a la incidencia de GitHub;
- panel de seguimientos pendientes;
- métricas de visitas, incidencias y seguimientos;
- confirmación visual después de guardar;
- exportación CSV del historial filtrado;
- diseño responsive para escritorio y móvil.

La base de visitas puede incluir las propiedades `GitHub Issue` (URL) y `GitHub #` (número). Cuando se crea una incidencia nueva, el backend las completa automáticamente para mantener trazabilidad entre Notion y GitHub.

## Endpoints

- `GET /api/health`
- `GET /api/integrations/status`
- `GET /api/notion/companies`
- `GET /api/notion/fields?companyId=...`
- `GET /api/notion/schema?dataSourceId=...`
- `GET /api/visits` — historial centralizado desde Notion
- `POST /api/visits` — guarda visita y crea Issue cuando corresponde

## Seguridad del piloto

- El login se valida en el servidor.
- Las contraseñas y tokens quedan en variables de entorno; no se envían al navegador.
- La API de Notion/GitHub requiere una sesión válida.
- Las sesiones están firmadas con `AUTH_SECRET` y vencen según `AUTH_SESSION_HOURS`.
- `.env` debe permanecer fuera de GitHub.

Para producción comercial a mayor escala conviene migrar posteriormente a una base de usuarios con contraseñas hasheadas y recuperación de acceso, pero esta versión ya evita el login expuesto que tenía la demo inicial.