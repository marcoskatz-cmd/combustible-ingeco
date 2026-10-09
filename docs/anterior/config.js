// URL del proxy Cloudflare Worker — único endpoint que llama el frontend.
// El Worker reenvía a Apps Script y agrega CORS. Existe porque la política
// Workspace de grupoingeco.com.ar bloquea cross-origin directo a Apps Script.
// Ver worker/proxy.js y README.md.
//
// REEMPLAZAR con la URL que te dio Cloudflare al deployar worker/proxy.js.
// Ej: "https://combustible-proxy.tu-usuario.workers.dev"
window.PROXY_URL = "https://combustible-ingeco-proxy.marcoskatz.workers.dev";
