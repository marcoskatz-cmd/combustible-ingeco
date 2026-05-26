# Combustible INGECO

Reemplazo autohospedado de los tres formularios de Jotform de control de combustible.

## Arquitectura

```
┌──────────────────┐        HTTPS estático        ┌──────────────────────┐
│  Operario (cel)  │ ───────────────────────────► │   GitHub Pages       │
└──────────────────┘                              │   (HTML/CSS/JS)      │
                                                  └──────────┬───────────┘
                                                             │ fetch() con CORS
                                                             │ (cookies omitidas)
                                                             ▼
                                                  ┌──────────────────────┐
                                                  │ Cloudflare Worker    │
                                                  │ (proxy, free tier)   │
                                                  └──────────┬───────────┘
                                                             │ fetch sin cookies
                                                             ▼
                                                  ┌──────────────────────┐
                                                  │  Apps Script Web App │
                                                  │  (doGet/doPost JSON) │
                                                  └──────────┬───────────┘
                                                             ▼
                                              ┌──────────────────────────┐
                                              │  Google Sheet            │
                                              │  ENTREGAS, REPOSICIONES, │
                                              │  STOCK_INICIAL           │
                                              │                          │
                                              │  Drive: FIRMAS (PNG)     │
                                              └──────────────────────────┘
```

- **Frontend** estático en GitHub Pages (`<usuario>.github.io/<repo>/`).
- **Cloudflare Worker** como proxy CORS — un solo archivo de ~60 líneas en el
  free tier (100K req/día, más que de sobra).
- **Backend** en Google Apps Script desplegado como Web App.
- **Datos** en Google Sheet `COMBUSTIBLE INGECO` (3 pestañas). Firmas en PNG
  dentro de `FIRMAS COMBUSTIBLE` de Drive.

### Por qué hace falta el Worker

El dominio Workspace de `grupoingeco.com.ar` tiene una política que bloquea
acceder a Apps Script Web Apps compartidos fuera del dominio. Cuando un
operario abre la página teniendo sesión activa en grupoingeco, Google
intercepta tanto los reads (JSONP, fetch) como los writes (form+iframe) que
van a `script.google.com`. Probamos múltiples workarounds (cambiar a
`ANYONE`, form+iframe+postMessage, JSONP) — todos rompen.

El Worker corre en `workers.dev` (dominio neutral, sin política de Workspace
aplicable) y reenvía la request sin cookies de Google. Apps Script la procesa
como anónima y el Worker devuelve el resultado con headers CORS abiertos.

Lo único que requiere admin/permiso especial sería levantar la política a
nivel Workspace — alternativa válida si querés evitar el Worker. Sin admin,
el Worker es la solución.

---

## Estructura del repositorio

```
combustible-ingeco/
├── appsscript.json          # manifiesto del Web App
├── Codigo.gs                # doGet (JSON+JSONP), doPost (JSON), setup, guardar*
├── menu.html | entrega.html | reposicion.html | stock.html | estilos.html
│                            # vistas fallback servidas directo por Apps Script
│
├── docs/                    # GitHub Pages — frontend que ven los operarios
│   ├── index.html           # menú (4 botones)
│   ├── entrega.html         # form con doble firma
│   ├── reposicion.html
│   ├── stock.html
│   ├── resumen.html         # stock disponible + últimas 20 entregas
│   ├── estilos.css
│   ├── config.js            # window.PROXY_URL — actualizar con la URL del Worker
│   └── .nojekyll            # desactiva Jekyll de GitHub Pages
│
├── worker/
│   └── proxy.js             # Cloudflare Worker proxy con CORS
│
├── .claspignore             # excluye docs/, worker/, README del push a Apps Script
├── .gitignore               # excluye .clasp.json (script ID por usuario)
└── README.md
```

---

## URLs operativas

| Cosa | URL |
|---|---|
| 🔗 **Para operarios** | `https://marcoskatz-cmd.github.io/combustible-ingeco/` |
| Worker proxy (Cloudflare) | `https://<TU-WORKER>.workers.dev` ← actualizar `docs/config.js` |
| Backend (Apps Script) | `https://script.google.com/macros/s/AKfycbywGmkWxwzPA925X6MDKqfsGAJddO3SGG3K3JwZisdL7JrVLcajmRR_Y9yRYvoeAWuP/exec` |
| Spreadsheet | `https://docs.google.com/spreadsheets/d/1e29HCQaXK3hLhD0Lk4YA78kI8YRq4JEFbZCevKcjONk/edit` |
| Carpeta firmas | `https://drive.google.com/drive/folders/15q4K7wT_O_m_O5EOJzV_oW01SF4B32aH` |
| Editor Apps Script | `https://script.google.com/d/1AaE9AM67Aw_-10dumCHKEdwnevgygBWM0QXM0YTXIbSzZxLoR64X1R4W/edit` |

---

## Setup del Cloudflare Worker (una sola vez, ~5 min)

1. Crear cuenta gratis en https://dash.cloudflare.com/sign-up
   (no pide tarjeta de crédito, solo email + password)
2. En el dashboard: menú izquierdo → **Workers & Pages**
3. Click **Create application** → **Create Worker**
4. Le ponés un nombre, ej. `combustible-ingeco-proxy`
5. Click **Deploy** (deja el código default por ahora)
6. Una vez deployado, click **Edit code** (botón arriba a la derecha)
7. En el editor, **borrá todo** el contenido de `worker.js`
8. Copiá y pegá el contenido de `worker/proxy.js` de este repo
9. Click **Deploy** (arriba a la derecha)
10. La URL del Worker aparece arriba — ej. `combustible-ingeco-proxy.tu-usuario.workers.dev`
11. **Copiar esa URL** y pegarla en `docs/config.js`:
    ```javascript
    window.PROXY_URL = "https://combustible-ingeco-proxy.tu-usuario.workers.dev";
    ```
12. `git add docs/config.js && git commit -m "Set PROXY_URL" && git push`
13. Esperar 1 minuto a que GitHub Pages se actualice.

### Si cambia el deployment de Apps Script

Si vos rehacés el deploy de Apps Script y la URL `/exec` cambia, también
actualizá la constante `APPS_SCRIPT_URL` arriba en `worker/proxy.js` y
re-deployá el Worker.

---

## Setup del Apps Script (ya hecho — referencia)

```powershell
npm install -g @google/clasp
clasp login
clasp create --type standalone --title "Combustible INGECO"
clasp push -f
# Abrir editor, ejecutar setup() una vez, aceptar OAuth "App no verificada"
# Copiar SHEET_ID y CARPETA_FIRMAS_ID del log a Codigo.gs
clasp push -f
clasp deploy --description "v1"
```

---

## Setup de GitHub Pages (ya hecho — referencia)

1. Push del repo
2. GitHub → **Settings → Pages**
3. Source: **Deploy from a branch**, Branch: **main**, Folder: **/docs**, Save
4. Esperar 1-2 min

---

## Mantenimiento

### Cambios en frontend
```powershell
# Editás archivos en docs/
git add docs/ && git commit -m "msg" && git push
```
GitHub Pages reflota en ~1 minuto. Refresh con Ctrl+Shift+R para evitar cache.

### Cambios en backend (Apps Script)
```powershell
# Editás Codigo.gs o appsscript.json
cmd /c "clasp.cmd push -f"
cmd /c "clasp.cmd deploy --deploymentId AKfycbywGmkWxwzPA925X6MDKqfsGAJddO3SGG3K3JwZisdL7JrVLcajmRR_Y9yRYvoeAWuP --description ""vN"""
```

### Cambios en el Worker
- Editar `worker/proxy.js` localmente (para tener historia en git)
- Ir al editor de Cloudflare Workers, pegar el código nuevo, Deploy

---

## Esquema del Sheet

| Pestaña          | Columnas (fila 1, congelada) |
| ---------------- | ----------------------------- |
| `ENTREGAS`       | FECHA, OPERARIO, EQUIPO, CODIGO_INTERNO, ESTADO_HOROMETRO, HOROMETRO_ACTUAL, LUGAR_ENTREGA, CANTIDAD_LITROS, TIPO_COMBUSTIBLE, FIRMA_OPERARIO_URL, FIRMA_RESPONSABLE_URL, TIMESTAMP |
| `REPOSICIONES`   | FECHA, DIESEL_500_LITROS, INFINIA_500_LITROS, TIMESTAMP |
| `STOCK_INICIAL`  | FECHA, DIESEL_500_INICIAL_LITROS, INFINIA_500_INICIAL_LITROS, TIMESTAMP |

Firmas: PNG en `FIRMAS COMBUSTIBLE` (Drive). Columna `FIRMA_*_URL` guarda
la URL pública (ANYONE_WITH_LINK).

---

## Endpoints del backend

| Método | URL | Body / Query | Devuelve |
|---|---|---|---|
| GET    | `…/exec?api=resumen` | — | `{ok, disponible: {Diesel 500, Infinia 500}, total_entregas}` |
| GET    | `…/exec?api=entregas&n=20` | — | `{ok, entregas: [{fecha, operario, equipo, …}]}` |
| GET    | `…/exec?api=codigos` | — | `{ok, codigos: [...]}` (no usado por el frontend actual) |
| POST   | `…/exec` | `{action:"guardarEntrega", ...}` | `{ok}` o `{ok:false, error}` |
| POST   | `…/exec` | `{action:"guardarReposicion", ...}` | `{ok}` o `{ok:false, error}` |
| POST   | `…/exec` | `{action:"guardarStock", ...}` | `{ok}` o `{ok:false, error}` |

El Worker reenvía cualquier GET/POST a `/exec` y agrega CORS. Acepta el
mismo formato.

---

## Decisiones técnicas relevantes

### Balance de stock disponible
`getResumen()` calcula: `Σ stock inicial + Σ reposiciones − Σ entregas` por
tipo. Las entradas de "stock inicial" suman (no son un reset). Si querés
"resetear" el balance, cargá una reposición negativa o editá el sheet.

### Inconsistencia "Diesel Infinia" / "Infinia 500" ⚠️

| Form         | Texto que ve el operario |
| ------------ | ------------------------ |
| Entrega      | **Diesel Infinia**       |
| Reposición   | **Infinia 500**          |
| Stock inicial| **Infinia 500**          |

Heredado de Jotform. `getResumen()` las trata como el mismo tipo a efectos
del cálculo. Pero si hacés análisis externos contra el sheet sin saberlo,
los strings no van a matchear. Pendiente: normalizar a un valor canónico.

### Código de equipo: texto libre
Decisión del usuario. Originalmente el plan era dropdown desde el Sheet
maestro de códigos (`getCodigosEquipos` lee `1JKVZB43VqhI...`), pero al
revisar la planilla los valores eran categorías ("Camioneta SUV"), no
códigos específicos. Por ahora el frontend usa input de texto.
`USAR_DROPDOWN_CODIGOS = false` en `Codigo.gs` y el endpoint JSONP sigue
disponible si se rehabilita.

### Compartido público del Spreadsheet
`setup()` deja el Sheet como `ANYONE_WITH_LINK / VIEW`. Necesario para gviz
si en el futuro INGECOV lo consume. Proteger el link.

### Firmas
Canvas HTML5 con `PointerEvent` (mouse + touch + pen). Se serializan como
base64 dentro del JSON. El backend las decodifica, sube como PNG a Drive
y guarda la URL pública del PNG en el Sheet.

---

## Acceso directo en celular (PWA-like)

### Android (Chrome)
1. Abrí la URL de GitHub Pages.
2. Menú → **Añadir a pantalla principal** → confirmar.

### iPhone (Safari)
1. Abrí la URL de GitHub Pages.
2. Botón compartir → **Agregar a pantalla de inicio**.

---

## Checklist de aceptación

- [ ] Worker deployado y `docs/config.js` apunta a la URL del Worker.
- [ ] La URL de GitHub Pages abre el menú con los 4 botones.
- [ ] Funciona desde Chrome con sesión `@grupoingeco.com.ar` activa.
- [ ] Cada formulario carga en mobile, valida requeridos y al enviar
      appendea exactamente una fila en la pestaña correspondiente.
- [ ] Las firmas del form de entrega quedan como PNG en Drive y sus URLs
      en las columnas `FIRMA_*_URL`.
- [ ] Resumen muestra stock disponible (Diesel 500, Infinia 500) y las
      últimas 20 entregas.
- [ ] Cero login para operarios.
