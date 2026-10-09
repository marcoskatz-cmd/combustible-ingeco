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
 */

// ====== CONFIGURACIÓN — pegar después de correr setup() ======
const SHEET_ID = '1e29HCQaXK3hLhD0Lk4YA78kI8YRq4JEFbZCevKcjONk';
const CARPETA_FIRMAS_ID = '15q4K7wT_O_m_O5EOJzV_oW01SF4B32aH';

// ====== Códigos de equipos (mejora recomendada) ======
const SHEET_CODIGOS_ID = '1JKVZB43VqhIenkrefSefcZrqy8_7QADHPPHqKi4OkH4';
const USAR_DROPDOWN_CODIGOS = false;

const TZ = 'America/Argentina/Buenos_Aires';

// ====== Deduplicación ======
const VENTANA_DUPLICADO_MIN = 15; // minutos

// ====== Router ======

function doGet(e) {
  if (e && e.parameter && e.parameter.api) {
    const cb = e.parameter.callback
      ? String(e.parameter.callback).replace(/[^a-zA-Z0-9_]/g, '')
      : null;
    let result;
    switch (e.parameter.api) {
      case 'codigos':            result = getCodigosEquipos(); break;
      case 'resumen':            result = getResumen(); break;
      case 'entregas':           result = getUltimasEntregas(e.parameter.n); break;
      case 'verificarDuplicado': result = verificarDuplicado(e.parameter.equipo, e.parameter.tipo); break;
      default:                   result = { ok: false, error: 'API desconocida: ' + String(e.parameter.api) };
    }
    const json = JSON.stringify(result);
    if (cb) {
      return ContentService.createTextOutput(cb + '(' + json + ');')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService.createTextOutput(json)
      .setMimeType(ContentService.MimeType.JSON);
  }

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

function doPost(e) {
  let data;
  try {
    if (e && e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    } else if (e && e.parameter && e.parameter.payload) {
      data = JSON.parse(e.parameter.payload);
    } else {
      return _jsonResponse({ ok: false, error: 'Sin payload' });
    }
  } catch (err) {
    return _jsonResponse({ ok: false, error: 'Payload inválido: ' + err.message });
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

  return _jsonResponse(result);
}

function _jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
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
    'FECHA', 'DIESEL_500_LITROS', 'INFINIA_500_LITROS', 'TIMESTAMP', 'FIRMA_RESPONSABLE_URL'
  ]);
  reposiciones.setFrozenRows(1);

  const stock = ss.insertSheet('STOCK_INICIAL');
  stock.appendRow([
    'FECHA', 'DIESEL_500_INICIAL_LITROS', 'INFINIA_500_INICIAL_LITROS', 'TIMESTAMP'
  ]);
  stock.setFrozenRows(1);

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

// ====== Helpers ======

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

// Normaliza para comparar equipos: minúsculas, sin acentos, espacios colapsados
function _normalizar(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

// ====== Deduplicación ======

function verificarDuplicado(equipo, tipoCombustible) {
  try {
    if (!SHEET_ID) return { ok: true, isDuplicate: false };

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sh = ss.getSheetByName('ENTREGAS');
    if (!sh || sh.getLastRow() < 2) return { ok: true, isDuplicate: false };

    const ahora = new Date();
    const limite = ahora.getTime() - VENTANA_DUPLICADO_MIN * 60 * 1000;

    const equipoNorm = _normalizar(equipo);
    const tipoNorm = _normalizar(tipoCombustible);

    // Solo miramos las últimas 30 filas (más que suficiente para 15 min)
    const lastRow = sh.getLastRow();
    const desde = Math.max(2, lastRow - 29);
    const cant = lastRow - desde + 1;
    const data = sh.getRange(desde, 1, cant, 12).getValues();

    for (let i = data.length - 1; i >= 0; i--) {
      const row = data[i];
      const timestamp = row[11]; // columna TIMESTAMP
      const ts = timestamp instanceof Date ? timestamp.getTime() : 0;
      if (ts === 0) continue;
      if (ts < limite) break; // ya salimos de la ventana, el resto es más viejo

      const equipoRow = _normalizar(row[2]);
      const tipoRow = _normalizar(row[8]);

      if (equipoRow === equipoNorm && tipoRow === tipoNorm) {
        const hace = Math.max(1, Math.round((ahora.getTime() - ts) / 60000));
        return {
          ok: true,
          isDuplicate: true,
          mensaje: 'Hace ' + hace + ' minuto(s) ya se registró una carga al mismo equipo "' +
                   String(row[2]).trim() + '" (' + String(row[7]) + ' L, ' + String(row[8]).trim() + ').',
          timestamp: Utilities.formatDate(new Date(ts), TZ, 'HH:mm'),
          litros: Number(row[7]) || 0
        };
      }
    }

    return { ok: true, isDuplicate: false };
  } catch (err) {
    // Si falla la verificación, NO bloqueamos la carga (fail-open)
    return { ok: true, isDuplicate: false, error: (err && err.message) ? err.message : String(err) };
  }
}

// ====== Endpoints expuestos al cliente ======

function guardarEntrega(data) {
  try {
    _validar(data, [
      'fecha', 'operario', 'equipo', 'codigoInterno', 'estadoHorometro',
      'lugarEntrega', 'cantidadLitros', 'tipoCombustible',
      'firmaOperario', 'firmaResponsable'
    ]);

    const litros = _numeroValido(data.cantidadLitros, 0);
    if (litros === null || litros <= 0) {
      throw new Error('La cantidad de litros debe ser un número mayor a 0.');
    }

    const estadosValidos = ['Sí funciona', 'No funciona'];
    if (estadosValidos.indexOf(data.estadoHorometro) < 0) {
      throw new Error('Estado de horómetro inválido.');
    }

    let horometro = '';
    if (data.estadoHorometro === 'Sí funciona') {
      const h = _numeroValido(data.horometroActual, 0);
      if (h === null) {
        throw new Error('El horómetro debe ser un número mayor o igual a 0.');
      }
      horometro = h;
    }

    const tiposValidos = ['Diesel 500', 'Diesel Infinia'];
    if (tiposValidos.indexOf(data.tipoCombustible) < 0) {
      throw new Error('Tipo de combustible inválido.');
    }

    // === Verificación de duplicado (antes de subir firmas para no dejar basura en Drive) ===
    // Si el cliente confirmó explícitamente (data.forzar === true) salteamos el chequeo.
    if (data.forzar !== true) {
      const dupCheck = verificarDuplicado(data.equipo, data.tipoCombustible);
      if (dupCheck.isDuplicate) {
        return {
          ok: false,
          isDuplicate: true,
          warning: dupCheck.mensaje,
          timestamp: dupCheck.timestamp
        };
      }
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
    _validar(data, ['fecha', 'diesel500', 'infinia500', 'firmaResponsable']);

    const diesel = _numeroValido(data.diesel500, 0);
    const infinia = _numeroValido(data.infinia500, 0);
    if (diesel === null) throw new Error('Diesel 500 debe ser un número >= 0.');
    if (infinia === null) throw new Error('Infinia 500 debe ser un número >= 0.');

    const urlFirma = _guardarFirma(data.firmaResponsable, 'responsable_reposicion');

    const sh = _abrirSheet('REPOSICIONES');
    // Self-healing: agrega columna FIRMA_RESPONSABLE_URL si no existe
    if (sh.getRange(1, 5).getValue() !== 'FIRMA_RESPONSABLE_URL') {
      sh.getRange(1, 5).setValue('FIRMA_RESPONSABLE_URL');
    }
    sh.appendRow([
      _parseFecha(data.fecha),
      diesel,
      infinia,
      new Date(),
      urlFirma
    ]);

    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err && err.message) ? err.message : String(err) };
  }
}

// DEPRECADO como formulario — la pestaña STOCK_INICIAL sigue activa como ajuste manual
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

function getResumen() {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);

    let diesel500 = 0;
    let infinia500 = 0;

    // Ajustes manuales (saldo apertura + correcciones). Pueden ser negativos.
    const stockSheet = ss.getSheetByName('STOCK_INICIAL');
    if (stockSheet && stockSheet.getLastRow() > 1) {
      const stockData = stockSheet.getRange(2, 1, stockSheet.getLastRow() - 1, 3).getValues();
      for (let i = 0; i < stockData.length; i++) {
        diesel500  += Number(stockData[i][1]) || 0;
        infinia500 += Number(stockData[i][2]) || 0;
      }
    }

    const repoSheet = ss.getSheetByName('REPOSICIONES');
    if (repoSheet && repoSheet.getLastRow() > 1) {
      const repoData = repoSheet.getRange(2, 1, repoSheet.getLastRow() - 1, 3).getValues();
      for (let i = 0; i < repoData.length; i++) {
        diesel500  += Number(repoData[i][1]) || 0;
        infinia500 += Number(repoData[i][2]) || 0;
      }
    }

    const entSheet = ss.getSheetByName('ENTREGAS');
    let totalEntregas = 0;
    if (entSheet && entSheet.getLastRow() > 1) {
      const entData = entSheet.getRange(2, 1, entSheet.getLastRow() - 1, 9).getValues();
      for (let i = 0; i < entData.length; i++) {
        const litros = Number(entData[i][7]) || 0;
        const tipo   = String(entData[i][8] || '').trim();
        if (tipo === 'Diesel 500') {
          diesel500 -= litros;
        } else if (tipo === 'Diesel Infinia' || tipo === 'Infinia 500') {
          infinia500 -= litros;
        }
        totalEntregas++;
      }
    }

    diesel500  = Math.round(diesel500  * 100) / 100;
    infinia500 = Math.round(infinia500 * 100) / 100;

    return {
      ok: true,
      disponible: {
        'Diesel 500':  diesel500,
        'Infinia 500': infinia500
      },
      total_entregas: totalEntregas
    };
  } catch (err) {
    return { ok: false, error: (err && err.message) ? err.message : String(err) };
  }
}

function getUltimasEntregas(n) {
  try {
    const cantidad = Math.min(Math.max(Number(n) || 20, 1), 100);
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sh = ss.getSheetByName('ENTREGAS');
    if (!sh || sh.getLastRow() < 2) return { ok: true, entregas: [] };

    const data = sh.getRange(2, 1, sh.getLastRow() - 1, 12).getValues();
    const rows = data
      .filter(function(r) { return r[0]; })
      .map(function(r, i) { return { r: r, i: i }; })
      .sort(function(a, b) {
        const ta = a.r[11] instanceof Date ? a.r[11].getTime() : null;
        const tb = b.r[11] instanceof Date ? b.r[11].getTime() : null;
        if (ta !== null && tb !== null) return tb - ta;
        if (ta !== null) return -1;
        if (tb !== null) return 1;
        const fa = _parseFechaCeldaToTime(a.r[0]);
        const fb = _parseFechaCeldaToTime(b.r[0]);
        if (fa !== fb) return fb - fa;
        return b.i - a.i;
      })
      .slice(0, cantidad)
      .map(function(x) {
        const r = x.r;
        return {
          fecha:           r[0] instanceof Date ? Utilities.formatDate(r[0], TZ, 'yyyy-MM-dd') : String(r[0]),
          operario:        String(r[1] || ''),
          equipo:          String(r[2] || ''),
          codigoInterno:   String(r[3] || ''),
          lugarEntrega:    String(r[6] || ''),
          cantidadLitros:  Number(r[7]) || 0,
          tipoCombustible: String(r[8] || ''),
          timestamp:       r[11] instanceof Date ? Utilities.formatDate(r[11], TZ, 'yyyy-MM-dd HH:mm') : ''
        };
      });

    return { ok: true, entregas: rows };
  } catch (err) {
    return { ok: false, error: (err && err.message) ? err.message : String(err) };
  }
}

function _parseFechaCeldaToTime(v) {
  if (v instanceof Date) return v.getTime();
  const s = String(v || '').trim();
  if (!s) return 0;
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) {
    const a = +m[1], b = +m[2], y = +m[3];
    if (a > 12) return new Date(y, b - 1, a).getTime();
    return new Date(y, a - 1, b).getTime();
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}
