/**
 * Fuentes.gs — Fase 1
 * Fetch de RSS + parse (XmlService) + dedup por URL.
 *
 * En esta fase las fuentes están HARDCODEADAS (FUENTES_PRUEBA) para probar el
 * pipeline de extracción de extremo a extremo. En una fase posterior se leerán
 * desde el Google Sheet (SHEET_ID en Script Properties), sin tocar esta lógica.
 *
 * Verificación: ejecutar test() y revisar el registro (Ver → Registros, o
 * `npx clasp tail-logs`). Deben aparecer titulares reales de hoy, deduplicados.
 */

// Feeds reales de prueba. Google News RSS es la columna vertebral del diseño
// final (una query por cliente/tema); agregamos un medio directo para confirmar
// que el parseo generaliza más allá de Google News.
var FUENTES_PRUEBA = [
  { etiqueta: 'Chile · portada',     url: 'https://news.google.com/rss?hl=es-419&gl=CL&ceid=CL:es' },
  { etiqueta: 'Política · Chile',    url: 'https://news.google.com/rss/search?q=pol%C3%ADtica+Chile+when:2d&hl=es-419&gl=CL&ceid=CL:es' },
  { etiqueta: 'Delictual',           url: 'https://news.google.com/rss/search?q=portonazo+OR+encerrona+OR+%22crimen+organizado%22+when:2d&hl=es-419&gl=CL&ceid=CL:es' },
  { etiqueta: 'EMOL · nacional',     url: 'https://www.emol.com/rss/rss.asp?canal=nacional' }
];

// Cuántos titulares loguear en test() (el resto solo se cuenta).
var TOPE_LOG_TEST = 40;

/**
 * Punto de entrada de verificación de la Fase 1.
 * Recolecta de todas las fuentes, deduplica y loguea los titulares.
 */
function test() {
  Logger.log('=== Fase 1 · prueba de fuentes ===');
  var articulos = recolectarTitulares();

  var n = Math.min(articulos.length, TOPE_LOG_TEST);
  for (var i = 0; i < n; i++) {
    var a = articulos[i];
    Logger.log('%s. [%s] %s\n     %s', (i + 1), a.fuente, a.titular, a.url);
  }
  if (articulos.length > n) {
    Logger.log('… y %s titulares más (no se loguean).', articulos.length - n);
  }
}

/**
 * Recorre FUENTES_PRUEBA, junta todos los artículos y deduplica por URL.
 * @return {Array<Object>} artículos únicos {titular, url, fuente, fecha, etiqueta}.
 */
function recolectarTitulares() {
  var todos = [];

  for (var i = 0; i < FUENTES_PRUEBA.length; i++) {
    var fuente = FUENTES_PRUEBA[i];
    var arts = obtenerArticulosDeFuente_(fuente);
    Logger.log('• %s → %s ítems', fuente.etiqueta, arts.length);
    todos = todos.concat(arts);
  }

  var antes = todos.length;
  var unicos = deduplicarPorUrl_(todos);
  Logger.log('Total %s ítems → %s únicos (se quitaron %s duplicados).',
             antes, unicos.length, antes - unicos.length);

  return unicos;
}

/**
 * Hace fetch de una fuente RSS y parsea sus ítems de forma defensiva.
 * Cualquier fallo (red, HTTP, XML) se loguea y devuelve [] sin romper el resto.
 * @param {{etiqueta:string, url:string}} fuente
 * @return {Array<Object>}
 */
function obtenerArticulosDeFuente_(fuente) {
  var resp;
  try {
    resp = UrlFetchApp.fetch(fuente.url, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (ALTO Barrido de Prensa)' }
    });
  } catch (e) {
    Logger.log('  ✗ Falló el fetch [%s]: %s', fuente.etiqueta, e.message);
    return [];
  }

  var codigo = resp.getResponseCode();
  if (codigo !== 200) {
    Logger.log('  ✗ HTTP %s [%s]', codigo, fuente.etiqueta);
    return [];
  }

  var raiz;
  try {
    raiz = XmlService.parse(resp.getContentText()).getRootElement();
  } catch (e) {
    Logger.log('  ✗ XML inválido [%s]: %s', fuente.etiqueta, e.message);
    return [];
  }

  // RSS 2.0: <rss><channel><item>… | Atom (fallback): <feed><entry>…
  var canal = raiz.getChild('channel');
  var items = canal ? canal.getChildren('item') : raiz.getChildren('entry');

  var articulos = [];
  for (var i = 0; i < items.length; i++) {
    var art = parsearItem_(items[i], fuente);
    if (art) articulos.push(art);   // parsearItem_ descarta los que no traen url
  }
  return articulos;
}

/**
 * Convierte un <item>/<entry> en nuestro objeto de artículo.
 * REGLA DURA: sin titular o sin url → se descarta (devuelve null).
 */
function parsearItem_(item, fuente) {
  var titular = textoHijo_(item, 'title');

  // RSS: <link>url</link> · Atom: <link href="url"/>
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

  var fecha = textoHijo_(item, 'pubDate') ||
              textoHijo_(item, 'published') ||
              textoHijo_(item, 'updated') || '';

  return {
    titular: limpiar_(titular),
    url: url.trim(),
    fuente: nombreFuente ? limpiar_(nombreFuente) : fuente.etiqueta,
    fecha: fecha.trim(),
    etiqueta: fuente.etiqueta
  };
}

/**
 * Deduplica por URL normalizada, conservando el primer aparecido.
 */
function deduplicarPorUrl_(articulos) {
  var vistos = {};
  var unicos = [];
  for (var i = 0; i < articulos.length; i++) {
    var clave = normalizarUrl_(articulos[i].url);
    if (vistos[clave]) continue;
    vistos[clave] = true;
    unicos.push(articulos[i]);
  }
  return unicos;
}

// ---------- Utilidades ---------------------------------------------------

/** Texto de un hijo directo por nombre (sin namespace). '' si no existe. */
function textoHijo_(elem, nombre) {
  var hijo = elem.getChild(nombre);
  return hijo ? hijo.getText() : '';
}

/** Normaliza una URL para comparar: minúsculas, sin barra final. */
function normalizarUrl_(url) {
  return String(url).trim().toLowerCase().replace(/\/+$/, '');
}

/** Colapsa espacios y recorta. XmlService ya decodifica entidades y CDATA. */
function limpiar_(texto) {
  return String(texto).replace(/\s+/g, ' ').trim();
}
