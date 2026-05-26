/**
 * Cloudflare Worker — proxy CORS para Apps Script de Combustible INGECO.
 *
 * Por qué existe: el dominio Workspace de grupoingeco.com.ar bloquea
 * peticiones cross-origin al Apps Script Web App cuando el usuario tiene
 * sesión activa en el dominio (tanto JSONP como form+iframe). Este Worker
 * actúa como intermediario neutral en un dominio sin esa política:
 *
 *   Browser ─► Worker (workers.dev) ─► Apps Script ─► Sheet/Drive
 *
 * El Worker:
 *   - acepta GET y POST con CORS abierto
 *   - reenvía la request a Apps Script /exec sin cookies
 *   - sigue los redirects 302 que Apps Script usa internamente
 *   - devuelve la respuesta con headers CORS al frontend
 *
 * Tamaño total: < 60 líneas. Free tier de Cloudflare aguanta 100K req/día,
 * más que suficiente para este uso.
 */

const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbywGmkWxwzPA925X6MDKqfsGAJddO3SGG3K3JwZisdL7JrVLcajmRR_Y9yRYvoeAWuP/exec";

// Si querés restringir qué orígenes pueden usar este proxy, listalos acá.
// Dejá ["*"] para permitir cualquiera (recomendado solo si el endpoint no
// expone datos sensibles).
const ALLOWED_ORIGINS = ["*"];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request) {
    // Preflight CORS
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Check origen (si está restringido)
    if (ALLOWED_ORIGINS[0] !== "*") {
      const origin = request.headers.get("Origin");
      if (origin && !ALLOWED_ORIGINS.includes(origin)) {
        return new Response("Origen no permitido: " + origin, {
          status: 403,
          headers: CORS_HEADERS,
        });
      }
    }

    // Forward al Apps Script
    const incomingUrl = new URL(request.url);
    const targetUrl = APPS_SCRIPT_URL + incomingUrl.search;

    const init = {
      method: request.method,
      headers: {},
      redirect: "follow",
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = await request.text();
      const ct = request.headers.get("content-type");
      if (ct) init.headers["Content-Type"] = ct;
    }

    let upstream;
    try {
      upstream = await fetch(targetUrl, init);
    } catch (err) {
      return new Response(
        JSON.stringify({ ok: false, error: "Proxy fetch error: " + err.message }),
        {
          status: 502,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        }
      );
    }

    const body = await upstream.text();
    const contentType = upstream.headers.get("content-type") || "text/plain";

    return new Response(body, {
      status: upstream.status,
      headers: { ...CORS_HEADERS, "Content-Type": contentType },
    });
  },
};
