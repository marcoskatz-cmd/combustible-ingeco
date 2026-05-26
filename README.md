# Combustible INGECO

Reemplazo autohospedado de los tres formularios de Jotform de control de combustible.

## Arquitectura

```
┌──────────────────┐                            ┌──────────────────────┐
│  Operario (cel)  │  ──── HTTPS estático ────► │   GitHub Pages       │
└──────────────────┘                            │   (HTML/CSS/JS)      │
                                                └──────────┬───────────┘
                                                           │
                                                  POST (form+iframe)
                                                  GET   (JSONP)
                                                           │
                                                           ▼
                                                ┌──────────────────────┐
                                                │  Apps Script Web App │
                                                │  (doGet/doPost)      │
                                                └──────────┬───────────┘
                                                           │
                                                           ▼
                                            ┌──────────────────────────┐
                                            │  Google Sheet            │
                                            │  ENTREGAS, REPOSICIONES, │
                                            │  STOCK_INICIAL           │
                                            │                          │
                                            │  Drive: FIRMAS (PNG)     │
                                            └──────────────────────────┘
```

- **Frontend** estático en GitHub Pages: HTML/CSS/JS puro, cero dependencias.
  Se sirve desde `<usuario>.github.io/<repo>/`.
- **Backend** en Google Apps Script desplegado como Web App
  (`script.google.com/macros/s/<id>/exec`).
- **Cross-origin sin CORS**: el frontend hace POST por `<form target="iframe">`
  (legal cross-origin) y el backend responde con HTML que ejecuta
  `window.parent.postMessage(...)`. El cliente escucha el mensaje en el iframe
  oculto. Para lecturas (códigos de equipos) usa JSONP (`<script src>`).
- **Datos**: Google Sheet `COMBUSTIBLE INGECO` con 3 pestañas. Firmas en PNG
  dentro de la carpeta `FIRMAS COMBUSTIBLE` de Drive.

Por qué esta arquitectura y no Apps Script puro: el dominio Workspace de
INGECO tiene una política que bloquea acceder a Apps Script Web Apps
compartidos fuera del dominio. Esto rompía la solución original (Apps Script
sirviendo todo) cuando un usuario logueado a `@grupoingeco.com.ar` la abría.
GitHub Pages está en un origen externo a Google, así que esa política no
aplica.

---

## Estructura del repositorio

```
combustible-ingeco/
├── apps-script-backend/         (root del repo, archivos que ven los operarios NO viven acá)
│   ├── appsscript.json          # manifiesto del Web App
│   ├── Codigo.gs                # doGet, doPost, setup, guardar*, getCodigosEquipos
│   ├── menu.html                # vistas fallback (servidas si abrís /exec sin pasar por GH Pages)
│   ├── entrega.html
│   ├── reposicion.html
│   ├── stock.html
│   └── estilos.html
│
├── docs/                        # GitHub Pages — frontend que ven los operarios
│   ├── index.html               # menú
│   ├── entrega.html             # form con doble firma, dropdown códigos
│   ├── reposicion.html
│   ├── stock.html
│   ├── estilos.css
│   └── config.js                # window.API_URL — actualizar si cambia el Apps Script deploy
│
├── .claspignore                 # excluye docs/ y README del push a Apps Script
├── .gitignore                   # excluye .clasp.json (script ID por usuario)
└── README.md
```

> Los archivos `*.html` en el root son la copia **fallback** servida por
> Apps Script directamente, por si alguien abre la URL `/exec?page=menu`
> en lugar de la URL de GitHub Pages. La versión canónica para operarios
> es la de `docs/`.

---

## URLs operativas

| Cosa | URL |
|---|---|
| 🔗 **Para operarios** (después del setup de Pages) | `https://<tu-usuario-github>.github.io/<repo>/` |
| Backend (Apps Script Web App) | `https://script.google.com/macros/s/AKfycbywGmkWxwzPA925X6MDKqfsGAJddO3SGG3K3JwZisdL7JrVLcajmRR_Y9yRYvoeAWuP/exec` |
| Spreadsheet | `https://docs.google.com/spreadsheets/d/1e29HCQaXK3hLhD0Lk4YA78kI8YRq4JEFbZCevKcjONk/edit` |
| Carpeta firmas | `https://drive.google.com/drive/folders/15q4K7wT_O_m_O5EOJzV_oW01SF4B32aH` |
| Editor Apps Script | `https://script.google.com/d/1AaE9AM67Aw_-10dumCHKEdwnevgygBWM0QXM0YTXIbSzZxLoR64X1R4W/edit` |

---

## Setup inicial (ya está hecho — referencia)

### Backend (Apps Script)

```powershell
npm install -g @google/clasp
clasp login                                        # abre browser, OAuth con tu cuenta Google
clasp create --type standalone --title "Combustible INGECO"
clasp push -f
# Abrir editor: clasp open-script
# Ejecutar setup() una vez desde el editor (acepta los scopes "App no verificada")
# Copiar los IDs del log a las constantes SHEET_ID y CARPETA_FIRMAS_ID en Codigo.gs
clasp push -f
clasp deploy --description "v1"
# Anotar el deploymentId que devuelve para futuros redeploys
```

Cuando aparece la advertencia "Google no ha verificado esta aplicación" en
la autorización de `setup()`, hacer click en **Configuración avanzada** →
**Ir a Combustible INGECO (no seguro)**. Es normal, no se evita: la app la
estás autorizando vos mismo para usar tus propios datos. Los operarios
nunca ven esta pantalla porque el Web App ejecuta con `executeAs: USER_DEPLOYING`.

### Frontend (GitHub Pages)

1. Crear un repo nuevo en GitHub (privado o público, da igual).
2. Push del repo local:
   ```powershell
   git init
   git add .
   git commit -m "Inicial"
   git branch -M main
   git remote add origin https://github.com/<tu-usuario>/<repo>.git
   git push -u origin main
   ```
3. En GitHub: **Settings → Pages**
   - Source: **Deploy from a branch**
   - Branch: **main**, folder: **/docs**
   - Save
4. Esperar 1-2 minutos hasta que muestre el URL público
   (`https://<tu-usuario>.github.io/<repo>/`).
5. Compartir ese URL con los operarios.

---

## Mantenimiento

### Cambios en el frontend (HTML/CSS)

```powershell
# Editás cualquier archivo en docs/
git add docs/
git commit -m "Mensaje"
git push
```

GitHub Pages reflota en ~1 minuto. Los operarios pueden necesitar refresh con
Ctrl+Shift+R si tienen cache vieja.

### Cambios en el backend (Apps Script)

```powershell
# Editás Codigo.gs o appsscript.json
clasp push -f
clasp deploy --deploymentId AKfycbywGmkWxwzPA925X6MDKqfsGAJddO3SGG3K3JwZisdL7JrVLcajmRR_Y9yRYvoeAWuP --description "v4"
```

Usar siempre el mismo `--deploymentId` para que la URL no cambie. Si redeployás
sin `--deploymentId`, se genera una URL nueva y hay que actualizar
`docs/config.js` con la nueva URL.

### Si cambia la URL del Apps Script

Actualizar `docs/config.js`:
```javascript
window.API_URL = "https://script.google.com/macros/s/<nueva-id>/exec";
```
Luego `git push` y listo.

---

## Esquema del Sheet `COMBUSTIBLE INGECO`

| Pestaña          | Columnas (fila 1, congelada) |
| ---------------- | ----------------------------- |
| `ENTREGAS`       | FECHA, OPERARIO, EQUIPO, CODIGO_INTERNO, ESTADO_HOROMETRO, HOROMETRO_ACTUAL, LUGAR_ENTREGA, CANTIDAD_LITROS, TIPO_COMBUSTIBLE, FIRMA_OPERARIO_URL, FIRMA_RESPONSABLE_URL, TIMESTAMP |
| `REPOSICIONES`   | FECHA, DIESEL_500_LITROS, INFINIA_500_LITROS, TIMESTAMP |
| `STOCK_INICIAL`  | FECHA, DIESEL_500_INICIAL_LITROS, INFINIA_500_INICIAL_LITROS, TIMESTAMP |

Las firmas se suben como PNG a la carpeta `FIRMAS COMBUSTIBLE` con permiso
`ANYONE_WITH_LINK / VIEW`. La columna `FIRMA_*_URL` guarda la URL al PNG.

---

## Decisiones técnicas relevantes

### Cross-origin sin CORS (form + iframe + postMessage)

Apps Script Web Apps no permiten setear headers CORS, así que un `fetch()`
desde GitHub Pages al backend no puede leer la respuesta. La técnica que
usamos: `<form target="iframe-oculto" method="POST" action="...exec">`
enviado a Apps Script. La respuesta carga en el iframe, y el HTML que
devuelve Apps Script ejecuta `window.parent.postMessage({ok:true,...}, '*')`.
El frontend escucha mensajes en `window.addEventListener('message', ...)`.

Funciona en todos los browsers desde 2010 (es lo que usaban Stripe y PayPal
para integraciones inline antes de tener APIs CORS reales).

### Lectura de códigos de equipos (JSONP)

Para el dropdown de códigos en el form de entrega, el frontend agrega un
`<script src="...exec?api=codigos&callback=cbXyz">` al DOM. Apps Script
responde con `cbXyz({ok:true, codigos:[...]})` y eso ejecuta la callback.
Esto esquiva CORS porque `<script>` no está sujeto a same-origin policy.

⚠️ **Heurística actual frágil**: `getCodigosEquipos()` lee la columna A de
cada pestaña del Sheet maestro (`1JKVZB43VqhI...`) y asume "código" en esa
columna. La prueba inicial mostró que algunos valores parecen *categorías*
(`Camioneta SUV`, `CAMIONES Y CARRETONES`) y no *códigos específicos*
(`CB-001`, patentes, etc.). Si los códigos reales están en otra columna o
con otra estructura, ajustar `getCodigosEquipos()` en `Codigo.gs`. Si la
lectura falla por permisos o estructura inesperada, el form cae a input
de texto libre sin romper.

### Inconsistencia "Diesel Infinia" vs "Infinia 500" ⚠️

| Form         | Texto que ve el operario |
| ------------ | ------------------------ |
| Entrega      | **Diesel Infinia**       |
| Reposición   | **Infinia 500**          |
| Stock inicial| **Infinia 500**          |

Heredado de los formularios viejos en Jotform. Para hacer balance de stock
(stock inicial + reposiciones − entregas), los strings no van a matchear.
Conviene normalizar a un valor canónico (decisión de producto que no
resolvimos para no cambiar lo que ya conocen los operarios). Se propone
discutirlo y migrar con un script de un solo uso o resolver del lado del
consumidor (INGECOV) con un mapeo de equivalencias.

### Sharing `ANYONE_WITH_LINK` del Spreadsheet

Hecho por `setup()`. Necesario para que el panel INGECOV consuma los datos
por gviz sin autenticación. Cualquiera con el link puede leer el Sheet —
proteger el link como una contraseña.

### Firmas

Canvas HTML5 nativo con `PointerEvent` (mouse + touch + pen). Se serializan
como base64 dentro del `payload` JSON. El backend las decodifica, las sube
como PNG a Drive y guarda la URL pública del PNG en el Sheet.

---

## Acceso directo en celular (PWA-like)

No es PWA real (no hay manifest), pero sirve para tener ícono en pantalla
de inicio:

### Android (Chrome)
1. Abrí la URL de GitHub Pages.
2. Menú → **Añadir a pantalla principal** → confirmar.

### iPhone (Safari)
1. Abrí la URL de GitHub Pages.
2. Botón compartir → **Agregar a pantalla de inicio**.

---

## Checklist de aceptación

- [ ] La URL de GitHub Pages abre el menú con los 3 botones.
- [ ] Cada formulario carga en mobile, valida requeridos y al enviar
      appendea exactamente una fila en la pestaña correspondiente.
- [ ] Las firmas del form de entrega quedan como PNG en Drive y sus URLs
      en las columnas `FIRMA_*_URL`.
- [ ] El Sheet tiene fila 1 congelada y se puede leer con un link anónimo.
- [ ] El dropdown de códigos se popula desde el Sheet maestro
      (o cae a texto libre si no hay permiso, sin romper).
- [ ] Funciona desde Chrome con sesión `@grupoingeco.com.ar` activa.
- [ ] Cero CORS, cero servicios pagos, cero login para operarios.
