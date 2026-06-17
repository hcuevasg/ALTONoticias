/**
 * CorreoAlto.gs — Ingesta por correo para la sección "ALTO en la Prensa".
 *
 * Lee una etiqueta de Gmail (LABEL_ALTO) y convierte cada correo (alertas de Google,
 * newsletter/alertas de El Mercurio, reenvíos manuales) en titulares para el corpus 'alto'.
 * Resuelve la brecha del paywall SIN login: el medio/alerta nos manda la nota por correo
 * (incluido contenido de pago) y acá la ingerimos. Claude cura en alto_prensa y el dedup
 * global (claveTitulo_) funde el solapamiento con Google News / Bing.
 *
 * SETUP (una sola vez, en Gmail):
 *   1) Creá la etiqueta "alto-prensa".
 *   2) Creá filtros que le apliquen esa etiqueta a:
 *      - Google Alerts (de googlealerts-noreply@google.com) para "Grupo ALTO",
 *        "Jorge Nazer", "Ángeles Kassis", "ALTO Chile".
 *      - (Opcional) la alerta/newsletter de El Mercurio por palabra clave.
 *      - (Opcional) el clipping diario del servicio de prensa, si existe.
 *      - Reenvíos manuales de comunicaciones (reenviá la nota y etiquetala).
 *   3) Al re-desplegar, autorizá el nuevo permiso de Gmail (solo lectura).
 *
 * Solo LEE el correo (scope gmail.readonly); no marca, mueve ni borra nada. Procesa los
 * últimos DIAS_CORREO días por corrida; el dedup y filtrarNoVistos_ (Memoria.gs) evitan
 * repetir entre ediciones. Poné CORREO_ALTO_ACTIVO = false (en Fuentes.gs) para desactivar.
 */

var LABEL_ALTO       = 'alto-prensa';
var DIAS_CORREO      = 2;    // ventana de búsqueda en Gmail (alineada con MAX_HORAS_ANTIGUEDAD)
var MAX_HILOS_CORREO = 30;   // tope de hilos a procesar por corrida

/** Verificación: ejecutá testCorreoAlto() (necesita la etiqueta y el permiso de Gmail). */
function testCorreoAlto() {
  Logger.log('=== Ingesta de correo (ALTO en la Prensa) ===');
  var arts = recolectarCorreoAlto_();
  Logger.log('Titulares extraídos: %s', arts.length);
  for (var i = 0; i < Math.min(arts.length, 30); i++) {
    Logger.log('%s. [%s] %s — %s', i + 1, arts[i].fuente, arts[i].titular, arts[i].url);
  }
}

/**
 * Lee LABEL_ALTO en Gmail y devuelve titulares para la sección 'alto'.
 * Falla suave: si no hay etiqueta/permiso, loguea y devuelve [] (no rompe el barrido).
 * @return {Array<Object>} {titular,url,fuente,fecha,etiqueta,seccion:'alto',industria,cliente}
 */
function recolectarCorreoAlto_() {
  var arts = [];
  var query = 'label:' + LABEL_ALTO + ' newer_than:' + DIAS_CORREO + 'd';

  var hilos;
  try { hilos = GmailApp.search(query, 0, MAX_HILOS_CORREO); }
  catch (e) { Logger.log('  ⚠ No se pudo leer Gmail (%s). ¿Existe la etiqueta y el permiso?', e.message); return arts; }
  if (!hilos.length) return arts;

  for (var h = 0; h < hilos.length; h++) {
    var msgs = hilos[h].getMessages();
    for (var m = 0; m < msgs.length; m++) {
      var msg = msgs[m];
      var remitente = '', asunto = '', html = '', fechaMsg = null;
      try {
        remitente = msg.getFrom() || '';
        asunto = msg.getSubject() || '';
        fechaMsg = msg.getDate();
        html = msg.getBody() || '';
      } catch (e) { continue; }

      var items = /googlealerts/i.test(remitente)
        ? parsearGoogleAlerts_(html)
        : parsearCorreoGenerico_(html, asunto);

      for (var k = 0; k < items.length; k++) {
        var it = items[k];
        if (!it.url) continue;
        arts.push({
          titular: limpiar_(it.titular || asunto || '(sin título)'),
          url: it.url.trim(),
          fuente: it.fuente || dominioDeUrl_(it.url) || 'Correo',
          fecha: fechaMsg ? fechaMsg.toUTCString() : '',
          etiqueta: 'ALTO',
          seccion: 'alto', industria: '', cliente: ''
        });
      }
    }
  }
  return arts;
}

// ---------- Parsers por tipo de correo ----------------------------------

/**
 * Google Alerts: cada artículo es un <a> cuyo href es un redirect de Google
 * (…/url?...&url=REAL&…). Sacamos la URL real y el texto del ancla como titular.
 */
function parsearGoogleAlerts_(html) {
  var items = [];
  var re = /<a[^>]+href="([^"]*\/url\?[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(html)) !== null) {
    var real = urlRealDeGoogle_(desescaparEntidades_(m[1]));   // decodifica &amp; del href
    if (!real || esLinkBasura_(real)) continue;
    var titulo = limpiar_(quitarHtml_(m[2]));
    if (!titulo) continue;
    items.push({ url: real, titular: titulo, fuente: dominioDeUrl_(real) });
  }
  return items;
}

/**
 * Correo genérico (newsletter / clipping / reenvío manual): extrae enlaces http(s) con
 * texto, descartando basura típica (gestión de alerta, redes, unsubscribe, imágenes).
 * Conservador a propósito: ante la duda, Claude filtra después lo que no sea de ALTO.
 */
function parsearCorreoGenerico_(html, asunto) {
  var items = [], vistos = {};
  var re = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(html)) !== null) {
    var url = desescaparEntidades_(m[1]);                 // decodifica &amp; del href
    if (esLinkBasura_(url) || vistos[url]) continue;
    vistos[url] = true;
    var texto = limpiar_(quitarHtml_(m[2]));
    // Si el ancla es la propia URL (link pelado) o viene vacía, usá el ASUNTO como titular.
    if (!texto || /^https?:\/\//i.test(texto)) texto = asunto || '';
    items.push({ url: url, titular: texto, fuente: dominioDeUrl_(url) });
  }
  return items;
}

// ---------- Utilidades ---------------------------------------------------

/** Extrae la URL real de un redirect de Google (param url= o q=); si no, la propia si es http. */
function urlRealDeGoogle_(href) {
  var m = /[?&]url=([^&]+)/i.exec(href);
  if (m) { try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; } }
  m = /[?&]q=([^&]+)/i.exec(href);
  if (m) { try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; } }
  return /^https?:\/\//i.test(href) ? href : '';
}

/** Host de una URL, como nombre de fuente legible (sin www.). */
function dominioDeUrl_(url) {
  var m = /^https?:\/\/(?:www\.)?([^\/?#]+)/i.exec(String(url));
  return m ? m[1] : '';
}

/** Quita etiquetas HTML y desescapa entidades básicas del texto de un ancla. */
function quitarHtml_(s) {
  return desescaparEntidades_(String(s).replace(/<[^>]+>/g, ' '));
}

/** Desescapa entidades HTML básicas (sirve para texto y para URLs con &amp;). */
function desescaparEntidades_(s) {
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

/** true si el link es ruido (gestión de alerta, redes sociales, unsubscribe, assets…). */
function esLinkBasura_(url) {
  return /(\/alerts|google\.[^\/]+\/(?:preferences|support|policies)|\/unsub|unsubscribe|list-manage|mailchimp|facebook\.com|twitter\.com|\/\/x\.com|linkedin\.com|instagram\.com|youtube\.com|wa\.me|whatsapp|mailto:|\.(?:png|jpe?g|gif|svg|css|js)(?:$|[?#]))/i.test(String(url));
}
