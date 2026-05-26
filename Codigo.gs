/**
 * COMBUSTIBLE INGECO - Backend Apps Script
 * Web App único que sirve los 3 formularios (entrega, reposición, stock)
 * y persiste cada carga en un Spreadsheet propio.
 *
 * Flujo de instalación:
 *   1) clasp push
 *   2) Correr setup() UNA SOLA VEZ desde el editor de Apps Script
 *   3) Copiar SHEET_ID y CARPETA_FIRMAS_ID del log a las constantes de abajo
 *   4) clasp push
 *   5) clasp deploy (Web App)
 *
 * NOMENCLATURA INCONSISTENTE A REVISAR:
 *   - Form de Entrega usa "Diesel Infinia"
 *   - Forms de Reposición y Stock usan "Infinia 500"
 * Mantenemos los textos como los conocen los operarios desde Jotform,
 * pero a futuro conviene normalizar a un único valor canónico (ver README).
 */

// ====== CONFIGURACIÓN — pegar después de correr setup() ======
const SHEET_ID = '1e29HCQaXK3hLhD0Lk4YA78kI8YRq4JEFbZCevKcjONk';
const CARPETA_FIRMAS_ID = '15q4K7wT_O_m_O5EOJzV_oW01SF4B32aH';

// ====== Códigos de equipos (mejora recomendada) ======
// ID del Sheet de INGECO con códigos válidos de equipos (4 pestañas)
const SHEET_CODIGOS_ID = '1JKVZB43VqhIenkrefSefcZrqy8_7QADHPPHqKi4OkH4';
// Si la cuenta deployer no tiene permiso de lectura, el cliente cae a input texto libre
const USAR_DROPDOWN_CODIGOS = true;

const TZ = 'America/Argentina/Buenos_Aires';

// ====== Router ======

function doGet(e) {
  // ---- JSONP endpoint para frontend en GitHub Pages ----
  // Esquivamos CORS usando un <script src> en el cliente.
  if (e && e.parameter && e.parameter.api === 'codigos' && e.parameter.callback) {
    const result = getCodigosEquipos();
    const cb = String(e.parameter.callback).replace(/[^a-zA-Z0-9_]/g, '');
    return ContentService
      .createTextOutput(cb + '(' + JSON.stringify(result) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  // ---- HTML pages (frontend embebido — fallback, usado si no se accede via GitHub Pages) ----
  const page = (e && e.parameter && e.parameter.page) || 'menu';
  const titulos = {
    menu: 'Combustible INGECO',
    entrega: 'Entrega de combustible',
    reposicion: 'Reposición de combustible',
    stock: 'Stock inicial de combustible'
  };

  if (!Object.prototype.hasOwnProperty.call(titulos, page)) {
    return HtmlService.createHtmlOutput('Página no encontrada').setTitle('Error');
  }

  return HtmlService.createTemplateFromFile(page)
    .evaluate()
    .setTitle(titulos[page])
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
}

// ====== doPost: API para frontend en GitHub Pages ======
// El cliente envía un <form> con un único campo "payload" (JSON.stringify de
// los datos). Esquivamos CORS porque <form> permite POST cross-origin.
// La respuesta es un HTML pequeño que hace window.parent.postMessage(...),
// que el cliente escucha desde un iframe oculto.
function doPost(e) {
  let data;
  try {
    if (e && e.parameter && e.parameter.payload) {
      data = JSON.parse(e.parameter.payload);
    } else if (e && e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    } else {
      return _postMessage({ ok: false, error: 'Sin payload' });
    }
  } catch (err) {
    return _postMessage({ ok: false, error: 'Payload inválido: ' + err.message });
  }

  const action = data.action;
  delete data.action;

  let result;
  try {
    switch (action) {
      case 'guardarEntrega':    result = guardarEntrega(data); break;
      case 'guardarReposicion': result = guardarReposicion(data); break;
      case 'guardarStock':      result = guardarStock(data); break;
      default: result = { ok: false, error: 'Acción desconocida: ' + String(action) };
    }
  } catch (err) {
    result = { ok: false, error: (err && err.message) ? err.message : String(err) };
  }

  return _postMessage(result);
}

function _postMessage(obj) {
  // Escapamos lo que va dentro del <script> para que no rompa el HTML ni
  // permita inyección de tags.
  const json = JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const html =
    '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
    '<script>try{window.parent.postMessage(' + json + ',"*");}catch(e){}</script>' +
    '</body></html>';
  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(nombre) {
  return HtmlService.createHtmlOutputFromFile(nombre).getContent();
}

// ====== Setup inicial (correr UNA sola vez desde el editor) ======

function setup() {
  const ss = SpreadsheetApp.create('COMBUSTIBLE INGECO');
  const ssId = ss.getId();

  const entregas = ss.insertSheet('ENTREGAS');
  entregas.appendRow([
    'FECHA', 'OPERARIO', 'EQUIPO', 'CODIGO_INTERNO', 'ESTADO_HOROMETRO',
    'HOROMETRO_ACTUAL', 'LUGAR_ENTREGA', 'CANTIDAD_LITROS', 'TIPO_COMBUSTIBLE',
    'FIRMA_OPERARIO_URL', 'FIRMA_RESPONSABLE_URL', 'TIMESTAMP'
  ]);
  entregas.setFrozenRows(1);

  const reposiciones = ss.insertSheet('REPOSICIONES');
  reposiciones.appendRow([
    'FECHA', 'DIESEL_500_LITROS', 'INFINIA_500_LITROS', 'TIMESTAMP'
  ]);
  reposiciones.setFrozenRows(1);

  const stock = ss.insertSheet('STOCK_INICIAL');
  stock.appendRow([
    'FECHA', 'DIESEL_500_INICIAL_LITROS', 'INFINIA_500_INICIAL_LITROS', 'TIMESTAMP'
  ]);
  stock.setFrozenRows(1);

  // Borrar la Hoja 1 / Sheet1 por defecto si quedó vacía
  const todas = ss.getSheets();
  for (const sh of todas) {
    const n = sh.getName();
    if ((n === 'Hoja 1' || n === 'Sheet1' || n === 'Hoja1') && todas.length > 1) {
      ss.deleteSheet(sh);
      break;
    }
  }

  const carpeta = DriveApp.createFolder('FIRMAS COMBUSTIBLE');
  const carpetaId = carpeta.getId();

  // Compartir Spreadsheet como "cualquiera con el link puede ver" — necesario
  // para que el panel INGECOV pueda consumirlo vía gviz a futuro.
  DriveApp.getFileById(ssId).setSharing(
    DriveApp.Access.ANYONE_WITH_LINK,
    DriveApp.Permission.VIEW
  );

  Logger.log('=== SETUP COMPLETO ===');
  Logger.log('SHEET_ID = ' + ssId);
  Logger.log('CARPETA_FIRMAS_ID = ' + carpetaId);
  Logger.log('URL del Sheet: ' + ss.getUrl());
  Logger.log('Pegá estos IDs en las constantes al tope de Codigo.gs y hacé clasp push.');
}

// ====== Helpers de guardado ======

function _validar(data, requeridos) {
  for (const campo of requeridos) {
    const v = data[campo];
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
      throw new Error('Falta el campo requerido: ' + campo);
    }
  }
}

function _abrirSheet(nombre) {
  if (!SHEET_ID) {
    throw new Error('SHEET_ID no configurado. Corré setup() y pegá los IDs en Codigo.gs.');
  }
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(nombre);
  if (!sh) throw new Error('Pestaña no encontrada: ' + nombre);
  return sh;
}

// El input type="date" devuelve "YYYY-MM-DD". Lo convertimos a Date local
// para que Sheets lo interprete como celda de fecha y no como string.
function _parseFecha(s) {
  if (s instanceof Date) return s;
  if (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const partes = s.split('-').map(Number);
    return new Date(partes[0], partes[1] - 1, partes[2]);
  }
  return new Date(s);
}

function _numeroValido(v, min) {
  const n = Number(v);
  if (!isFinite(n)) return null;
  if (typeof min === 'number' && n < min) return null;
  return n;
}

function _guardarFirma(dataUrl, rol) {
  if (!CARPETA_FIRMAS_ID) {
    throw new Error('CARPETA_FIRMAS_ID no configurado.');
  }
  if (typeof dataUrl !== 'string' || dataUrl.indexOf('data:image/') !== 0) {
    throw new Error('Firma inválida (' + rol + ')');
  }
  const coma = dataUrl.indexOf(',');
  if (coma < 0) throw new Error('Firma malformada (' + rol + ')');
  const base64 = dataUrl.substring(coma + 1);
  const bytes = Utilities.base64Decode(base64);
  const ts = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd_HHmmss');
  const blob = Utilities.newBlob(bytes, 'image/png', 'firma_' + rol + '_' + ts + '.png');
  const carpeta = DriveApp.getFolderById(CARPETA_FIRMAS_ID);
  const file = carpeta.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

// ====== Endpoints expuestos al cliente (google.script.run) ======

function guardarEntrega(data) {
  try {
    _validar(data, [
      'fecha', 'operario', 'equipo', 'codigoInterno', 'estadoHorometro',
      'horometroActual', 'lugarEntrega', 'cantidadLitros', 'tipoCombustible',
      'firmaOperario', 'firmaResponsable'
    ]);

    const litros = _numeroValido(data.cantidadLitros, 0);
    if (litros === null || litros <= 0) {
      throw new Error('La cantidad de litros debe ser un número mayor a 0.');
    }

    const horometro = _numeroValido(data.horometroActual, 0);
    if (horometro === null) {
      throw new Error('El horómetro debe ser un número mayor o igual a 0.');
    }

    const estadosValidos = ['Sí funciona', 'No funciona'];
    if (estadosValidos.indexOf(data.estadoHorometro) < 0) {
      throw new Error('Estado de horómetro inválido.');
    }

    const tiposValidos = ['Diesel 500', 'Diesel Infinia'];
    if (tiposValidos.indexOf(data.tipoCombustible) < 0) {
      throw new Error('Tipo de combustible inválido.');
    }

    const urlFirmaOp = _guardarFirma(data.firmaOperario, 'operario');
    const urlFirmaResp = _guardarFirma(data.firmaResponsable, 'responsable');

    const sh = _abrirSheet('ENTREGAS');
    sh.appendRow([
      _parseFecha(data.fecha),
      String(data.operario).trim(),
      String(data.equipo).trim(),
      String(data.codigoInterno).trim(),
      String(data.estadoHorometro).trim(),
      horometro,
      String(data.lugarEntrega).trim(),
      litros,
      String(data.tipoCombustible).trim(),
      urlFirmaOp,
      urlFirmaResp,
      new Date()
    ]);

    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err && err.message) ? err.message : String(err) };
  }
}

function guardarReposicion(data) {
  try {
    _validar(data, ['fecha', 'diesel500', 'infinia500']);

    const diesel = _numeroValido(data.diesel500, 0);
    const infinia = _numeroValido(data.infinia500, 0);
    if (diesel === null) throw new Error('Diesel 500 debe ser un número >= 0.');
    if (infinia === null) throw new Error('Infinia 500 debe ser un número >= 0.');

    const sh = _abrirSheet('REPOSICIONES');
    sh.appendRow([
      _parseFecha(data.fecha),
      diesel,
      infinia,
      new Date()
    ]);

    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err && err.message) ? err.message : String(err) };
  }
}

function guardarStock(data) {
  try {
    _validar(data, ['fecha', 'diesel500Inicial', 'infinia500Inicial']);

    const diesel = _numeroValido(data.diesel500Inicial, 0);
    const infinia = _numeroValido(data.infinia500Inicial, 0);
    if (diesel === null) throw new Error('Diesel 500 inicial debe ser un número >= 0.');
    if (infinia === null) throw new Error('Infinia 500 inicial debe ser un número >= 0.');

    const sh = _abrirSheet('STOCK_INICIAL');
    sh.appendRow([
      _parseFecha(data.fecha),
      diesel,
      infinia,
      new Date()
    ]);

    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err && err.message) ? err.message : String(err) };
  }
}

// ====== Códigos de equipos para dropdown ======
// Lee las 4 pestañas del Sheet de códigos. Asume primera columna = código,
// fila 1 = header. Si la estructura cambia, ajustar acá.
function getCodigosEquipos() {
  if (!USAR_DROPDOWN_CODIGOS) return { ok: false, codigos: [] };

  try {
    const ss = SpreadsheetApp.openById(SHEET_CODIGOS_ID);
    const codigos = {};
    const hojas = ss.getSheets();
    for (const sh of hojas) {
      const last = sh.getLastRow();
      if (last < 2) continue;
      const valores = sh.getRange(2, 1, last - 1, 1).getValues();
      for (let i = 0; i < valores.length; i++) {
        const v = valores[i][0];
        if (v === '' || v === null || v === undefined) continue;
        codigos[String(v).trim()] = true;
      }
    }
    const lista = Object.keys(codigos).sort();
    return { ok: true, codigos: lista };
  } catch (err) {
    return { ok: false, codigos: [], error: (err && err.message) ? err.message : String(err) };
  }
}
