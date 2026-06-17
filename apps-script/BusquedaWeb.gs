/**
 * BusquedaWeb.gs — Búsqueda web (Google Programmable Search) para "ALTO en la Prensa".
 *
 * Amplía el recall MÁS ALLÁ de Google News / Bing: busca en TODO el índice web de Google,
 * donde suelen aparecer los "rebotes libres" de una noticia (sitio propio, gremios, LinkedIn
 * público, otros medios) aunque el medio de pago no la indexe. Es la pieza clave para acercar
 * el sistema a un servicio de clipping pagado, a costo $0 (cuota gratis: 100 búsquedas/día;
 * acá usamos ~1 por corrida).
 *
 * SETUP (una sola vez):
 *   1) Creá un Programmable Search Engine en https://programmablesearchengine.google.com
 *      con la opción "Buscar en toda la web". Copiá su ID (cx).
 *   2) En Google Cloud, habilitá "Custom Search API" y creá una API key.
 *   3) Apps Script → Propiedades del script:
 *        GOOGLE_CSE_KEY = <api key>
 *        GOOGLE_CSE_CX  = <id del motor (cx)>
 *   4) Activá CSE_ALTO_ACTIVO (en Fuentes.gs).
 *
 * Falla suave: sin key/cx, loguea y devuelve [] (no rompe el barrido). La recencia la impone
 * dateRestrict=dN del lado de Google. Claude cura y el dedup global funde solapamientos.
 */

var CSE_QUERY_ALTO = '"Grupo ALTO" OR "Jorge Nazer" OR "Ángeles Kassis" OR "ALTO Chile" OR "ALTO S.A."';
var CSE_DIAS = 2;   // dateRestrict: últimos N días

/** Verificación: cargá las propiedades y ejecutá testBusquedaWebAlto(). */
function testBusquedaWebAlto() {
  Logger.log('=== Búsqueda web CSE (ALTO en la Prensa) ===');
  var arts = recolectarCSEAlto_();
  Logger.log('Resultados: %s', arts.length);
  for (var i = 0; i < arts.length; i++) {
    Logger.log('%s. [%s] %s — %s', i + 1, arts[i].fuente, arts[i].titular, arts[i].url);
  }
}

/**
 * Busca menciones de ALTO en la web vía Custom Search JSON API.
 * @return {Array<Object>} {titular,url,fuente,fecha,etiqueta,seccion:'alto',industria,cliente}
 */
function recolectarCSEAlto_() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('GOOGLE_CSE_KEY'), cx = props.getProperty('GOOGLE_CSE_CX');
  if (!key || !cx) { Logger.log('  ⚠ Falta GOOGLE_CSE_KEY/GOOGLE_CSE_CX; se omite la búsqueda web.'); return []; }

  var url = 'https://www.googleapis.com/customsearch/v1?key=' + encodeURIComponent(key) +
            '&cx=' + encodeURIComponent(cx) + '&q=' + encodeURIComponent(CSE_QUERY_ALTO) +
            '&num=10&hl=es&gl=cl&lr=lang_es&dateRestrict=d' + CSE_DIAS;

  var resp;
  try { resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true }); }
  catch (e) { Logger.log('  ⚠ CSE fetch falló: %s', e.message); return []; }
  if (resp.getResponseCode() !== 200) {
    Logger.log('  ⚠ CSE HTTP %s: %s', resp.getResponseCode(), resp.getContentText().slice(0, 200));
    return [];
  }

  var data;
  try { data = JSON.parse(resp.getContentText()); } catch (e) { Logger.log('  ⚠ CSE: respuesta no-JSON.'); return []; }

  var items = data.items || [];
  var arts = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (!it.link || !it.title) continue;
    arts.push({
      titular: limpiar_(it.title),
      url: String(it.link).trim(),
      fuente: it.displayLink ? String(it.displayLink).replace(/^www\./, '') : dominioDeUrl_(it.link),
      fecha: fechaDeCSE_(it),
      etiqueta: 'ALTO',
      seccion: 'alto', industria: '', cliente: ''
    });
  }
  return arts;
}

/** Intenta sacar una fecha de los metatags del resultado CSE (si el sitio la expone). */
function fechaDeCSE_(item) {
  var mt = item.pagemap && item.pagemap.metatags && item.pagemap.metatags[0];
  if (!mt) return '';
  return String(mt['article:published_time'] || mt['og:updated_time'] ||
                mt['date'] || mt['pubdate'] || '');
}
