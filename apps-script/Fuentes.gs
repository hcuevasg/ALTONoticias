/**
 * Fuentes.gs — Detección (modelo de embudo / taxonomía)
 * Lee el Sheet (5 pestañas), arma las consultas y trae RSS en paralelo (fetchAll).
 *
 * Estrategia escalable: en vez de 1 búsqueda por cliente (no escala a 100-200),
 * cruza clientes × amenazas por INDUSTRIA en una sola query booleana de Google News.
 * Ej: ("Walmart" OR "Líder" OR "Falabella") (robo OR hurto OR fraude) when:2d
 * → ~10-20 fetches para cientos de clientes. La IA atribuye el cliente después.
 *
 * Pestañas (fila 1 = encabezados):
 *   FuentesGenerales:  A=etiqueta   B=url
 *   TemasDelictuales:  A=tema       B=términos
 *   Tendencias:        A=etiqueta   B=términos     (MO/viral, sin cliente)
 *   Clientes:          A=nombre     B=industria    C=alias (coma-separados)
 *   Amenazas:          A=industria  B=términos (coma-separados)
 *
 * Cada artículo sale etiquetado: seccion ('general'|'delictual'|'tendencia'|'clientes')
 * e industria (en 'clientes'). El cliente lo atribuye la IA en la Unidad 2.
 *
 * Verificación: setear SHEET_ID y ejecutar test().
 */

var TOPE_LOG_TEST = 30;
var LOTE_FETCH    = 40;     // tamaño de lote para fetchAll
var CLIENTES_POR_QUERY = 18; // chunk de clientes/alias por query cruzada
var DIAS_DELICTUAL = 2;
var DIAS_TENDENCIA = 2;
var DIAS_CLIENTES  = 2;
// Filtro de recencia duro: descarta toda nota cuya fecha de publicación sea más
// vieja que esto (el when: de Google News no es estricto y deja pasar antiguas).
// Medido en HORAS desde el momento de la corrida, para que sea exactamente 48 h.
var MAX_HORAS_ANTIGUEDAD = 48;

function test() {
  Logger.log('=== Prueba de fuentes (taxonomía) ===');
  var articulos = recolectarTitulares();
  if (!articulos.length) return;

  var conteo = {};
  for (var i = 0; i < articulos.length; i++) {
    var sec = articulos[i].seccion || '?';
    conteo[sec] = (conteo[sec] || 0) + 1;
  }
  Logger.log('Por sección: %s', JSON.stringify(conteo));

  var n = Math.min(articulos.length, TOPE_LOG_TEST);
  for (var k = 0; k < n; k++) {
    var a = articulos[k];
    var tag = a.seccion === 'clientes' ? ('clientes/' + a.industria) : a.seccion;
    Logger.log('%s. [%s] %s', (k + 1), tag, a.titular);
  }
}

/**
 * Lee el Sheet, hace fetch en lotes paralelos, parsea, etiqueta y deduplica.
 * @return {Array<Object>} {titular,url,fuente,fecha,etiqueta,seccion,industria,cliente}
 */
function recolectarTitulares() {
  var specs = leerFuentesDelSheet_();
  if (!specs.length) { Logger.log('✗ Sin fuentes (revisá SHEET_ID y las pestañas).'); return []; }
  Logger.log('Consultas a ejecutar: %s', specs.length);

  var todos = [];
  for (var i = 0; i < specs.length; i += LOTE_FETCH) {
    var lote = specs.slice(i, i + LOTE_FETCH);
    var requests = lote.map(function (s) {
      return {
        url: s.url, muteHttpExceptions: true, followRedirects: true,
        headers: { 'User-Agent': 'Mozilla/5.0 (ALTO Barrido de Prensa)' }
      };
    });
    var respuestas;
    try { respuestas = UrlFetchApp.fetchAll(requests); }
    catch (e) { Logger.log('  ✗ fetchAll falló en lote %s: %s', i, e.message); continue; }
    for (var j = 0; j < respuestas.length; j++) {
      todos = todos.concat(parsearRespuesta_(respuestas[j], lote[j]));
    }
  }

  var unicos = deduplicarPorUrl_(todos);
  Logger.log('Ítems %s → únicos %s (−%s dup)', todos.length, unicos.length, todos.length - unicos.length);
  return unicos;
}

// ---------- Lectura del Sheet -------------------------------------------

/** @return {Array<{url,etiqueta,seccion,industria,cliente}>} */
function leerFuentesDelSheet_() {
  var ss = abrirSheet_();
  if (!ss) return [];

  var specs = [];

  // 1) Prensa general (sección Chile/política): la URL se usa tal cual.
  recorrerHoja_(ss, 'FuentesGenerales', function (fila) {
    var url = String(fila[1] || '').trim();
    if (url) specs.push({ url: url, etiqueta: String(fila[0] || 'General').trim(),
                          seccion: 'general', industria: '', cliente: '' });
  });

  // 2) Temas delictuales (sección delictual pública): query when:2d.
  recorrerHoja_(ss, 'TemasDelictuales', function (fila) {
    var t = String(fila[1] || '').trim();
    if (t) specs.push({ url: urlGoogleNews_(t, DIAS_DELICTUAL), etiqueta: String(fila[0] || 'Delictual').trim(),
                        seccion: 'delictual', industria: '', cliente: '' });
  });

  // 3) Tendencias / nuevos modus operandi (sin cliente): query when:2d.
  recorrerHoja_(ss, 'Tendencias', function (fila) {
    var t = orTerminos_(fila[1]);
    if (t) specs.push({ url: urlGoogleNews_(t, DIAS_TENDENCIA), etiqueta: String(fila[0] || 'Tendencia').trim(),
                        seccion: 'tendencia', industria: '', cliente: '' });
  });

  // 4) Amenazas por industria → mapa industria → '(t1 OR t2 …)'.
  var amenazasPorInd = {};
  recorrerHoja_(ss, 'Amenazas', function (fila) {
    var ind = String(fila[0] || '').trim();
    var terms = orTerminos_(fila[1]);
    if (ind && terms) amenazasPorInd[ind] = '(' + terms + ')';
  });

  // 5) Clientes por industria → mapa industria → [términos "nombre"/"alias"].
  var clientesPorInd = {};
  recorrerHoja_(ss, 'Clientes', function (fila) {
    var nombre = String(fila[0] || '').trim();
    var ind = String(fila[1] || '').trim();
    if (!nombre || !ind) return;
    if (!clientesPorInd[ind]) clientesPorInd[ind] = [];
    clientesPorInd[ind].push('"' + nombre.replace(/"/g, '') + '"');
    String(fila[2] || '').split(',').forEach(function (a) {
      a = a.trim().replace(/^"|"$/g, '');
      if (a) clientesPorInd[ind].push('"' + a + '"');
    });
  });

  // Query cruzada (clientes × amenazas) por industria, chunkeada.
  Object.keys(clientesPorInd).forEach(function (ind) {
    var amenaza = amenazasPorInd[ind];
    if (!amenaza) { Logger.log('  ⚠ Industria "%s" sin fila en Amenazas; se omite.', ind); return; }
    var terms = clientesPorInd[ind];
    for (var c = 0; c < terms.length; c += CLIENTES_POR_QUERY) {
      var chunk = terms.slice(c, c + CLIENTES_POR_QUERY);
      var q = '(' + chunk.join(' OR ') + ') ' + amenaza;
      specs.push({ url: urlGoogleNews_(q, DIAS_CLIENTES), etiqueta: ind,
                   seccion: 'clientes', industria: ind, cliente: '' });
    }
  });

  return specs;
}

/**
 * Roster de clientes para la atribución y el riesgo por industria (Unidad 2).
 * @return {Array<{nombre,industria}>}
 */
function leerRosterClientes_() {
  var ss = abrirSheet_();
  if (!ss) return [];
  var roster = [];
  recorrerHoja_(ss, 'Clientes', function (fila) {
    var nombre = String(fila[0] || '').trim();
    var ind = String(fila[1] || '').trim();
    var alias = String(fila[2] || '').trim();
    if (nombre) roster.push({ nombre: nombre, industria: ind, alias: alias });
  });
  return roster;
}

function abrirSheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) { Logger.log('✗ Falta SHEET_ID en Propiedades del Script.'); return null; }
  try { return SpreadsheetApp.openById(id); }
  catch (e) { Logger.log('✗ No se pudo abrir el Sheet: %s', e.message); return null; }
}

/** Recorre filas de datos (salta encabezado) llamando fn(fila). */
function recorrerHoja_(ss, nombreHoja, fn) {
  var hoja = ss.getSheetByName(nombreHoja);
  if (!hoja) { Logger.log('  ⚠ Falta la pestaña "%s".', nombreHoja); return; }
  var filas = hoja.getDataRange().getValues();
  for (var i = 1; i < filas.length; i++) fn(filas[i]);
}

/** 'robo, hurto, gift card' → 'robo OR hurto OR "gift card"' (cita multipalabra). */
function orTerminos_(csv) {
  var partes = String(csv || '').split(',').map(function (t) {
    t = t.trim();
    if (!t) return '';
    return /\s/.test(t) && !/^".*"$/.test(t) ? '"' + t + '"' : t;
  }).filter(Boolean);
  return partes.join(' OR ');
}

/** URL de búsqueda de Google News RSS (CL, español) con when:Nd. */
function urlGoogleNews_(query, dias) {
  return 'https://news.google.com/rss/search?q=' +
         encodeURIComponent(query + ' when:' + dias + 'd') +
         '&hl=es-419&gl=CL&ceid=CL:es';
}

// ---------- Parseo y dedup ----------------------------------------------

function parsearRespuesta_(resp, spec) {
  if (!resp || resp.getResponseCode() !== 200) return [];
  var raiz;
  try { raiz = XmlService.parse(resp.getContentText()).getRootElement(); }
  catch (e) { return []; }

  var canal = raiz.getChild('channel');
  var items = canal ? canal.getChildren('item') : raiz.getChildren('entry');

  var articulos = [];
  for (var i = 0; i < items.length; i++) {
    var art = parsearItem_(items[i], { etiqueta: spec.etiqueta });
    if (art && esReciente_(art.fecha)) {
      art.seccion = spec.seccion;
      art.industria = spec.industria;
      art.cliente = spec.cliente;
      articulos.push(art);
    }
  }
  return articulos;
}

/** true si la nota es reciente (≤ MAX_HORAS_ANTIGUEDAD). Sin fecha legible: se conserva. */
function esReciente_(fechaStr) {
  if (!fechaStr) return true;
  var d = new Date(fechaStr);
  if (isNaN(d.getTime())) return true;
  var horas = (new Date().getTime() - d.getTime()) / 3600000;
  return horas <= MAX_HORAS_ANTIGUEDAD;
}

/** <item>/<entry> → objeto base. REGLA DURA: sin titular o sin url → null. */
function parsearItem_(item, fuente) {
  var titular = textoHijo_(item, 'title');
  var url = textoHijo_(item, 'link');
  if (!url) {
    var link = item.getChild('link');
    var href = link ? link.getAttribute('href') : null;
    if (href) url = href.getValue();
  }
  if (!titular || !url) return null;

  var nombreFuente = '';
  var src = item.getChild('source');
  if (src) nombreFuente = src.getText();

  var fecha = textoHijo_(item, 'pubDate') || textoHijo_(item, 'published') ||
              textoHijo_(item, 'updated') || '';

  return {
    titular: limpiar_(titular),
    url: url.trim(),
    fuente: nombreFuente ? limpiar_(nombreFuente) : fuente.etiqueta,
    fecha: fecha.trim(),
    etiqueta: fuente.etiqueta
  };
}

function deduplicarPorUrl_(articulos) {
  var vistos = {}, unicos = [];
  for (var i = 0; i < articulos.length; i++) {
    var clave = normalizarUrl_(articulos[i].url);
    if (vistos[clave]) continue;
    vistos[clave] = true;
    unicos.push(articulos[i]);
  }
  return unicos;
}

// ---------- Utilidades ---------------------------------------------------

function textoHijo_(elem, nombre) {
  var hijo = elem.getChild(nombre);
  return hijo ? hijo.getText() : '';
}
function normalizarUrl_(url) {
  return String(url).trim().toLowerCase().replace(/\/+$/, '');
}
function limpiar_(texto) {
  return String(texto).replace(/\s+/g, ' ').trim();
}
