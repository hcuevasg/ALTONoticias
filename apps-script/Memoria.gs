/**
 * Memoria.gs — Mejora #1: no repetir incidentes ya reportados.
 * Guarda en Script Properties el hash de cada URL ya publicada (con su fecha) y
 * filtra de cada corrida lo que ya salió. Poda lo más viejo que la ventana.
 *
 * Limitación conocida: deduplica por URL. Si el MISMO hecho sale otro día con una
 * URL distinta (otro medio), no lo detecta — eso requeriría similitud de titular.
 */

var MEM_PROP = 'URLS_VISTAS';
var MEM_DIAS_RETENCION = 4;   // un poco más que la ventana de 48 h

/** Filtra los artículos cuya URL ya fue publicada en una corrida anterior. */
function filtrarNoVistos_(articulos) {
  var vistas = leerVistas_();
  var fuera = 0;
  var nuevos = articulos.filter(function (a) {
    if (vistas[hashUrl_(a.url)]) { fuera++; return false; }
    return true;
  });
  Logger.log('Memoria: %s ya reportados descartados; quedan %s nuevos.', fuera, nuevos.length);
  return nuevos;
}

/** Registra las URLs que salieron en la edición (diario + boletín) y poda viejas. */
function registrarPublicados_(edicion) {
  var vistas = leerVistas_();
  var ahora = new Date().getTime();
  urlsDeEdicion_(edicion).forEach(function (u) { vistas[hashUrl_(u)] = ahora; });
  guardarVistas_(podarVistas_(vistas, ahora));
}

/** Todas las URLs presentes en la edición. */
function urlsDeEdicion_(edicion) {
  var urls = [];
  if (edicion.titular_principal && edicion.titular_principal.url) urls.push(edicion.titular_principal.url);
  (edicion.secciones || []).forEach(function (s) {
    (s.articulos || []).forEach(function (a) { if (a.url) urls.push(a.url); });
  });
  var b = edicion.boletin || {};
  (b.clientes_afectados || []).forEach(function (c) { if (c.url) urls.push(c.url); });
  (b.nuevos_modus_operandi || []).forEach(function (m) { if (m.url) urls.push(m.url); });
  return urls;
}

function leerVistas_() {
  var raw = PropertiesService.getScriptProperties().getProperty(MEM_PROP);
  if (!raw) return {};
  try { return JSON.parse(raw) || {}; } catch (e) { return {}; }
}
function guardarVistas_(vistas) {
  PropertiesService.getScriptProperties().setProperty(MEM_PROP, JSON.stringify(vistas));
}
function podarVistas_(vistas, ahora) {
  var corte = ahora - MEM_DIAS_RETENCION * 86400000;
  var limpio = {};
  Object.keys(vistas).forEach(function (h) { if (vistas[h] >= corte) limpio[h] = vistas[h]; });
  return limpio;
}

/** Hash corto y estable de la URL normalizada (MD5 → 16 hex). normalizarUrl_ está en Fuentes.gs. */
function hashUrl_(url) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, normalizarUrl_(url));
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('').slice(0, 16);
}
