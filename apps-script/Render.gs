/**
 * Render.gs — Fase 3
 * Del MISMO objeto de edición (esquema/contrato.json) produce DOS salidas HTML:
 *   - renderEdicion(edicion): la edición COMPLETA, para GitHub Pages (CSS estático).
 *   - renderCorreo(edicion):  el digest TOPADO, para el correo (estilos inline).
 *
 * El control del tiempo de lectura (<5 min) NO se delega al modelo: se impone acá
 * con topes deterministas. Editá TOPE_CORREO / MAX_PALABRAS_BAJADA_CORREO y listo.
 *
 * Verificación: ejecutar testRender() y revisar el registro (aserciones + el HTML
 * del correo, que podés pegar en un .html y abrir). El diseño del diario completo
 * se verifica en Pages en la Fase 4.
 */

// --- Presupuesto del correo (control determinista del <5 min) -------------
var TOPE_CORREO = {
  titular_principal: 1,
  chile: 3,
  politica: 3,
  delictual: 3,
  clientes: 5            // sección de mayor valor → más espacio
};
var MAX_PALABRAS_BAJADA_CORREO = 30;

var BASE_PAGES = 'https://hcuevasg.github.io/ALTONoticias';

// ======================================================================
//  EDICIÓN COMPLETA (Pages)
// ======================================================================

/**
 * Renderiza la edición completa a HTML usando plantilla-edicion.html.
 * Descarta secciones vacías. Cada artículo ya trae url real (regla dura).
 * @param {Object} edicion  objeto conforme al contrato.
 * @return {string} HTML completo.
 */
function renderEdicion(edicion) {
  var plantilla = HtmlService
    .createTemplateFromFile('plantilla-edicion')
    .getRawContent();

  var html = plantilla;
  html = reemplazar_(html, '{{FECHA}}', escaparHtml_(edicion.fecha));
  html = reemplazar_(html, '{{FECHA_LARGA}}', escaparHtml_(fechaLarga_(edicion.fecha)));
  html = reemplazar_(html, '{{PORTADA}}', renderPortada_(edicion.titular_principal));
  html = reemplazar_(html, '{{SECCIONES}}', renderSecciones_(edicion.secciones));
  return html;
}

/** Bloque de portada (titular principal). */
function renderPortada_(tp) {
  if (!tp || !tp.url) return '';
  return [
    '<div class="portada">',
    '  <h2 class="portada__titular"><a href="' + escaparHtml_(tp.url) + '">' + escaparHtml_(tp.titular) + '</a></h2>',
    '  <p class="portada__bajada">' + escaparHtml_(tp.bajada) + '</p>',
    '  <p class="portada__fuente">' + escaparHtml_(tp.fuente) + '</p>',
    '</div>'
  ].join('\n');
}

/** Todas las secciones con artículos (las vacías se omiten). */
function renderSecciones_(secciones) {
  var bloques = [];
  for (var s = 0; s < secciones.length; s++) {
    var sec = secciones[s];
    if (!sec.articulos || !sec.articulos.length) continue;

    var arts = [];
    for (var a = 0; a < sec.articulos.length; a++) {
      arts.push(renderArticuloEdicion_(sec.articulos[a], sec.id === 'clientes'));
    }
    bloques.push([
      '<section class="seccion">',
      '  <h2 class="seccion__titulo">' + escaparHtml_(sec.titulo) + '</h2>',
      '  <div class="articulos">',
      arts.join('\n'),
      '  </div>',
      '</section>'
    ].join('\n'));
  }
  return bloques.join('\n');
}

/** Un artículo en la edición completa (bajada sin truncar). */
function renderArticuloEdicion_(art, esCliente) {
  var meta = ['<span class="articulo__fuente">' + escaparHtml_(art.fuente) + '</span>'];
  if (esCliente && art.cliente) {
    meta.push('<span class="articulo__cliente">' + escaparHtml_(art.cliente) + '</span>');
  }
  if (art.fecha) meta.push('<span>' + escaparHtml_(art.fecha) + '</span>');
  meta.push('<span class="relevancia">' + puntosRelevancia_(art.relevancia) + '</span>');

  return [
    '<article class="articulo">',
    '  <h3 class="articulo__titular"><a href="' + escaparHtml_(art.url) + '">' + escaparHtml_(art.titular) + '</a></h3>',
    '  <p class="articulo__bajada">' + escaparHtml_(art.bajada) + '</p>',
    '  <p class="articulo__meta">' + meta.join('\n    ') + '</p>',
    '</article>'
  ].join('\n');
}

// ======================================================================
//  CORREO (digest topado, estilos inline)
// ======================================================================

/**
 * Renderiza el digest del correo: brief completo pero topado por TOPE_CORREO,
 * con sello de tiempo de lectura arriba y botón a la edición completa.
 * @param {Object} edicion
 * @return {{html:string, minutos:number, palabras:number}}
 */
function renderCorreo(edicion) {
  var tp = edicion.titular_principal;
  var palabras = contarPalabras_(tp.titular) + contarPalabras_(tp.bajada);

  // Topar y truncar cada sección; ir acumulando palabras de lo que SÍ entra.
  var seccionesCorreo = [];
  for (var i = 0; i < edicion.secciones.length; i++) {
    var sec = edicion.secciones[i];
    var tope = TOPE_CORREO[sec.id] || 0;
    var elegidos = sec.articulos.slice()
      .sort(function (x, y) { return y.relevancia - x.relevancia; })
      .slice(0, tope);
    if (!elegidos.length) continue;

    var arts = [];
    for (var a = 0; a < elegidos.length; a++) {
      var art = elegidos[a];
      var bajada = truncarPalabras_(art.bajada, MAX_PALABRAS_BAJADA_CORREO);
      palabras += contarPalabras_(art.titular) + contarPalabras_(bajada);
      arts.push({ art: art, bajada: bajada, esCliente: sec.id === 'clientes' });
    }
    seccionesCorreo.push({ titulo: sec.titulo, arts: arts });
  }

  var minutos = Math.max(1, Math.round(palabras / 200));
  var edicionUrl = BASE_PAGES + '/ediciones/' + encodeURIComponent(edicion.fecha) + '.html';

  var html = construirHtmlCorreo_(edicion, seccionesCorreo, minutos, edicionUrl);
  return { html: html, minutos: minutos, palabras: palabras };
}

/** Arma el HTML del correo con estilos inline (compatibilidad Outlook). */
function construirHtmlCorreo_(edicion, seccionesCorreo, minutos, edicionUrl) {
  var tp = edicion.titular_principal;

  var cuerpo = [];

  // Portada del correo.
  cuerpo.push(
    '<div style="border-bottom:2px solid #1a1a1a;padding-bottom:18px;margin-bottom:8px;">' +
      '<a href="' + escaparHtml_(tp.url) + '" style="color:#1a1a1a;text-decoration:none;">' +
        '<div style="font-size:24px;font-weight:bold;line-height:1.2;">' + escaparHtml_(tp.titular) + '</div>' +
      '</a>' +
      '<div style="font-size:16px;color:#4a4a4a;margin-top:8px;">' + escaparHtml_(tp.bajada) + '</div>' +
      '<div style="font-family:Arial,sans-serif;font-size:11px;color:#8a1c1c;text-transform:uppercase;letter-spacing:.06em;margin-top:8px;">' + escaparHtml_(tp.fuente) + '</div>' +
    '</div>'
  );

  // Secciones topadas.
  for (var s = 0; s < seccionesCorreo.length; s++) {
    var sec = seccionesCorreo[s];
    cuerpo.push(
      '<div style="font-family:Arial,sans-serif;font-size:13px;font-weight:bold;text-transform:uppercase;letter-spacing:.12em;color:#1a1a1a;border-bottom:2px solid #8a1c1c;padding-bottom:6px;margin:26px 0 14px;">' +
      escaparHtml_(sec.titulo) + '</div>'
    );
    for (var a = 0; a < sec.arts.length; a++) {
      var item = sec.arts[a];
      var metaCorreo = escaparHtml_(item.art.fuente);
      if (item.esCliente && item.art.cliente) {
        metaCorreo += ' · <strong style="color:#8a1c1c;">' + escaparHtml_(item.art.cliente) + '</strong>';
      }
      cuerpo.push(
        '<div style="margin-bottom:16px;">' +
          '<a href="' + escaparHtml_(item.art.url) + '" style="color:#1a1a1a;text-decoration:none;">' +
            '<div style="font-size:17px;font-weight:bold;line-height:1.25;">' + escaparHtml_(item.art.titular) + '</div>' +
          '</a>' +
          '<div style="font-size:14px;color:#4a4a4a;margin-top:4px;">' + escaparHtml_(item.bajada) + '</div>' +
          '<div style="font-family:Arial,sans-serif;font-size:11px;color:#1f4e79;margin-top:4px;">' + metaCorreo + '</div>' +
        '</div>'
      );
    }
  }

  return [
    '<div style="background:#f7f4ec;padding:24px 0;font-family:Georgia,\'Times New Roman\',serif;color:#1a1a1a;margin:0;">',
    '<table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td align="center">',
    '<table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;background:#fffdf8;border:1px solid #d8d2c4;">',

    // Cabecera con sello de lectura.
    '<tr><td style="padding:24px 28px;border-bottom:3px double #1a1a1a;text-align:center;">',
    '  <div style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:.25em;color:#8a1c1c;font-weight:bold;text-transform:uppercase;">Inteligencia de Prensa</div>',
    '  <div style="font-size:30px;font-weight:bold;margin-top:4px;">ALTO · Barrido de Prensa</div>',
    '  <div style="font-family:Arial,sans-serif;font-size:12px;color:#4a4a4a;margin-top:8px;">' + escaparHtml_(fechaLarga_(edicion.fecha)) + ' &nbsp;·&nbsp; ⏱ Lectura: ~' + minutos + ' min</div>',
    '</td></tr>',

    // Cuerpo.
    '<tr><td style="padding:24px 28px;">',
    cuerpo.join('\n'),
    '</td></tr>',

    // Botón a la edición completa.
    '<tr><td style="padding:4px 28px 28px;text-align:center;">',
    '  <a href="' + escaparHtml_(edicionUrl) + '" style="display:inline-block;background:#8a1c1c;color:#fffdf8;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;text-decoration:none;padding:12px 22px;border-radius:3px;">Ver edición completa y archivo →</a>',
    '</td></tr>',

    // Pie.
    '<tr><td style="padding:16px 28px 28px;border-top:1px solid #d8d2c4;font-family:Arial,sans-serif;font-size:11px;color:#4a4a4a;text-align:center;line-height:1.6;">',
    '  <strong>ALTO · Barrido de Prensa</strong><br>Documento de inteligencia de prensa · Uso interno',
    '</td></tr>',

    '</table>',
    '</td></tr></table>',
    '</div>'
  ].join('\n');
}

// ======================================================================
//  Verificación
// ======================================================================

/**
 * Punto de entrada de verificación de la Fase 3.
 * Corre el pipeline (Fuentes → Claude → Render) y loguea aserciones + el correo.
 */
function testRender() {
  Logger.log('=== Fase 3 · prueba de render ===');

  var articulos = recolectarTitulares();
  var edicion = generarEdicion(articulos);
  if (!edicion) { Logger.log('✗ Sin edición; revisá Fases 1-2.'); return; }

  // --- Edición completa ---
  var htmlEdicion = renderEdicion(edicion);
  Logger.log('— Edición completa: %s caracteres', htmlEdicion.length);
  afirmar_('masthead presente', htmlEdicion.indexOf('class="masthead"') !== -1);
  afirmar_('portada presente', htmlEdicion.indexOf('class="portada"') !== -1);
  afirmar_('sin placeholders sin reemplazar', htmlEdicion.indexOf('{{') === -1);
  for (var s = 0; s < edicion.secciones.length; s++) {
    var sec = edicion.secciones[s];
    if (sec.articulos.length) {
      afirmar_('sección "' + sec.titulo + '" en HTML',
               htmlEdicion.indexOf(sec.titulo) !== -1);
    }
  }

  // --- Correo (topado) ---
  var correo = renderCorreo(edicion);
  Logger.log('— Correo: %s caracteres · %s palabras · ⏱ ~%s min',
             correo.html.length, correo.palabras, correo.minutos);
  Logger.log('   Topes aplicados (full → correo):');
  for (var i = 0; i < edicion.secciones.length; i++) {
    var sc = edicion.secciones[i];
    var tope = TOPE_CORREO[sc.id] || 0;
    var enCorreo = Math.min(sc.articulos.length, tope);
    Logger.log('     %s: %s → %s', sc.titulo, sc.articulos.length, enCorreo);
  }

  // HTML del correo, para pegar en un .html y abrir en el navegador.
  Logger.log('----- INICIO HTML CORREO -----');
  Logger.log(correo.html);
  Logger.log('----- FIN HTML CORREO -----');
}

function afirmar_(nombre, cond) {
  Logger.log('   %s %s', cond ? '✓' : '✗', nombre);
}

// ======================================================================
//  Utilidades de render
// ======================================================================

/** Reemplazo literal de todas las apariciones (sin regex, URLs seguras). */
function reemplazar_(str, token, valor) {
  return str.split(token).join(valor);
}

/** Escapa texto para HTML (sirve también para atributos: escapa comillas). */
function escaparHtml_(texto) {
  return String(texto == null ? '' : texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Relevancia 1-5 como puntos llenos/vacíos. */
function puntosRelevancia_(rel) {
  var n = Math.max(1, Math.min(5, parseInt(rel, 10) || 1));
  return new Array(n + 1).join('●') + new Array(5 - n + 1).join('○');
}

/** Cuenta palabras (para el tiempo de lectura). */
function contarPalabras_(texto) {
  var t = String(texto || '').trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

/** Trunca a n palabras, agregando … si se recortó. */
function truncarPalabras_(texto, n) {
  var palabras = String(texto || '').trim().split(/\s+/);
  if (palabras.length <= n) return palabras.join(' ');
  return palabras.slice(0, n).join(' ') + '…';
}

// Nombres en español para la fecha larga (GAS no da meses en es fácilmente).
var MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
var DIAS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** 'yyyy-MM-dd' → 'viernes 5 de junio de 2026'. */
function fechaLarga_(iso) {
  var p = String(iso).split('-');
  if (p.length !== 3) return String(iso);
  var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
  return DIAS_ES[d.getDay()] + ' ' + d.getDate() + ' de ' + MESES_ES[d.getMonth()] + ' de ' + d.getFullYear();
}
