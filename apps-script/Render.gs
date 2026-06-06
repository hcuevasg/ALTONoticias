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
  delictual: 3
};
var MAX_PALABRAS_BAJADA_CORREO = 30;

// Topes del boletín ALTO (lo de mayor valor → más espacio).
var TOPE_BOLETIN_CLIENTES = 10;
var TOPE_BOLETIN_MO = 5;

var BASE_PAGES = 'https://hcuevasg.github.io/ALTONoticias';
var LOGO_URL   = BASE_PAGES + '/assets/alto-logo.png';

// Paleta de marca ALTO + stacks de fuente para el correo (caen a web-safe).
var C_RED = '#E84244', C_BLUE = '#4174B9', C_GREY = '#B0B6B8';
var C_INK = '#15181D', C_INK2 = '#4A4F57', C_INK3 = '#7C828B', C_LINE = '#E1DDD4';
var F_DISP = "Archivo,'Helvetica Neue',Arial,sans-serif";
var F_MONO = "'IBM Plex Mono','Courier New',monospace";
var F_BODY = "'IBM Plex Sans',Arial,sans-serif";

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
  html = reemplazar_(html, '{{BOLETIN}}', renderBoletinEdicion_(edicion.boletin));
  return html;
}

/**
 * Boletín de Inteligencia ALTO para Pages (clientes afectados + MO + riesgo).
 * Muestra TODO (sin topes; los topes son solo del correo). Devuelve '' si vacío.
 */
function renderBoletinEdicion_(boletin) {
  if (!boletin) return '';
  var clientes = boletin.clientes_afectados || [];
  var modus = boletin.nuevos_modus_operandi || [];
  var riesgo = boletin.riesgo_por_industria || [];
  if (!clientes.length && !modus.length && !riesgo.length) return '';

  var bloques = ['<section class="seccion">', '  <h2 class="seclbl">Boletín de Inteligencia ALTO</h2>'];

  // Semáforo de riesgo.
  if (riesgo.length) {
    var chips = riesgo.map(function (r) {
      return '<span class="chip ' + chipClaseRiesgo_(r.nivel) + '">' +
        escaparHtml_(r.industria) + ' · ' + escaparHtml_(r.nivel) + '</span>';
    }).join('');
    bloques.push('  <div class="riesgo">' + chips + '</div>');
  }

  // Clientes afectados (todos).
  if (clientes.length) {
    bloques.push('  <p class="sublbl">Clientes afectados · últimas 48 h (' + clientes.length + ')</p>');
    clientes.forEach(function (c) {
      var cab = escaparHtml_(c.cliente);
      if (c.industria) cab += ' · ' + escaparHtml_(c.industria);
      if (c.tipo_amenaza) cab += ' · ' + escaparHtml_(c.tipo_amenaza);
      bloques.push(
        '  <div class="cliente">' +
          '<p class="cliente__cab">' + cab + '</p>' +
          '<h3 class="cliente__titular"><a href="' + escaparHtml_(c.url) + '">' + escaparHtml_(c.titular) + '</a></h3>' +
          (c.impacto ? '<p class="cliente__impacto">' + escaparHtml_(c.impacto) + '</p>' : '') +
          (c.oportunidad_comercial ? '<div class="oportunidad"><b>Oportunidad comercial</b>' + escaparHtml_(c.oportunidad_comercial) + '</div>' : '') +
        '</div>'
      );
    });
  }

  // Nuevos modus operandi.
  if (modus.length) {
    bloques.push('  <p class="sublbl">Nuevos modus operandi</p>');
    var items = modus.map(function (m) {
      return '<li><a href="' + escaparHtml_(m.url) + '">' + escaparHtml_(m.descripcion) + '</a></li>';
    }).join('');
    bloques.push('  <ul class="mo">' + items + '</ul>');
  }

  bloques.push('</section>');
  return bloques.join('\n');
}

/** Clase CSS del chip de riesgo según nivel. */
function chipClaseRiesgo_(nivel) {
  var n = String(nivel || '').toLowerCase();
  if (n.indexOf('alto') !== -1)  return 'chip--alto';
  if (n.indexOf('medio') !== -1) return 'chip--medio';
  return 'chip--bajo';
}

/** Hero de portada (titular principal). */
function renderPortada_(tp) {
  if (!tp || !tp.url) return '';
  return [
    '<section class="hero">',
    '  <p class="kick">Inteligencia de Prensa</p>',
    '  <h1><a href="' + escaparHtml_(tp.url) + '">' + escaparHtml_(tp.titular) + '</a></h1>',
    '  <p class="hero__bajada">' + escaparHtml_(tp.bajada) + '</p>',
    '  <p class="hero__fuente">' + escaparHtml_(tp.fuente) + '</p>',
    '</section>'
  ].join('\n');
}

/** Todas las secciones con artículos (las vacías y clientes se omiten). */
function renderSecciones_(secciones) {
  var bloques = [];
  for (var s = 0; s < secciones.length; s++) {
    var sec = secciones[s];
    if (sec.id === 'clientes') continue;   // privacidad: clientes solo en el correo, nunca en Pages
    if (!sec.articulos || !sec.articulos.length) continue;

    var arts = [];
    for (var a = 0; a < sec.articulos.length; a++) {
      arts.push(renderArticuloEdicion_(sec.articulos[a]));
    }
    bloques.push([
      '<section class="seccion">',
      '  <h2 class="seclbl">' + escaparHtml_(sec.titulo) + '</h2>',
      '  <div class="articulos">',
      arts.join('\n'),
      '  </div>',
      '</section>'
    ].join('\n'));
  }
  return bloques.join('\n');
}

/** Un artículo en la edición completa (bajada sin truncar). */
function renderArticuloEdicion_(art) {
  var meta = ['<span class="art__fuente">' + escaparHtml_(art.fuente) + '</span>'];
  if (art.fecha) meta.push('<span>' + escaparHtml_(art.fecha) + '</span>');
  meta.push('<span class="relevancia">' + puntosRelevancia_(art.relevancia) + '</span>');

  return [
    '<article class="art">',
    '  <h3 class="art__titular"><a href="' + escaparHtml_(art.url) + '">' + escaparHtml_(art.titular) + '</a></h3>',
    '  <p class="art__bajada">' + escaparHtml_(art.bajada) + '</p>',
    '  <p class="art__meta">' + meta.join(' ') + '</p>',
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

  // Boletín ALTO: topar clientes/MO; el riesgo va completo.
  var bol = edicion.boletin || { clientes_afectados: [], nuevos_modus_operandi: [], riesgo_por_industria: [] };
  var boletin = {
    clientes: (bol.clientes_afectados || []).slice(0, TOPE_BOLETIN_CLIENTES),
    modus: (bol.nuevos_modus_operandi || []).slice(0, TOPE_BOLETIN_MO),
    riesgo: bol.riesgo_por_industria || []
  };
  boletin.clientes.forEach(function (c) {
    palabras += contarPalabras_(c.titular) + contarPalabras_(c.impacto) + contarPalabras_(c.oportunidad_comercial);
  });
  boletin.modus.forEach(function (m) { palabras += contarPalabras_(m.descripcion); });

  var minutos = Math.max(1, Math.round(palabras / 200));
  var edicionUrl = BASE_PAGES + '/ediciones/' + encodeURIComponent(edicion.fecha) + '.html';

  var html = construirHtmlCorreo_(edicion, seccionesCorreo, boletin, minutos, edicionUrl);
  return { html: html, minutos: minutos, palabras: palabras };
}

/** Arma el HTML del correo con estilos inline (compatibilidad Outlook). */
function construirHtmlCorreo_(edicion, seccionesCorreo, boletin, minutos, edicionUrl) {
  var tp = edicion.titular_principal;

  var cuerpo = [];

  // BOLETÍN ALTO primero (lo de mayor valor para el lector comercial/interno).
  cuerpo.push(renderBoletinCorreo_(boletin));

  // Diario de prensa.
  cuerpo.push(headingCorreo_('Diario de prensa'));

  // Portada del correo (titular principal).
  cuerpo.push(
    '<div style="padding-bottom:20px;margin-bottom:6px;border-bottom:1.5px solid ' + C_INK + ';">' +
      '<div style="font-family:' + F_MONO + ';font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:' + C_RED + ';font-weight:bold;margin-bottom:9px;">Inteligencia de Prensa</div>' +
      '<a href="' + escaparHtml_(tp.url) + '" style="color:' + C_INK + ';text-decoration:none;">' +
        '<div style="font-family:' + F_DISP + ';font-size:27px;font-weight:800;line-height:1.04;letter-spacing:-.02em;">' + escaparHtml_(tp.titular) + '</div>' +
      '</a>' +
      '<div style="font-family:' + F_BODY + ';font-size:15px;line-height:1.45;color:' + C_INK2 + ';margin-top:9px;">' + escaparHtml_(tp.bajada) + '</div>' +
      '<div style="font-family:' + F_MONO + ';font-size:10px;color:' + C_RED + ';text-transform:uppercase;letter-spacing:.1em;margin-top:9px;">' + escaparHtml_(tp.fuente) + '</div>' +
    '</div>'
  );

  // Secciones topadas del diario.
  for (var s = 0; s < seccionesCorreo.length; s++) {
    var sec = seccionesCorreo[s];
    cuerpo.push(seclblCorreo_(sec.titulo));
    for (var a = 0; a < sec.arts.length; a++) {
      var item = sec.arts[a];
      cuerpo.push(
        '<div style="margin-bottom:15px;">' +
          '<a href="' + escaparHtml_(item.art.url) + '" style="color:' + C_INK + ';text-decoration:none;">' +
            '<div style="font-family:' + F_DISP + ';font-size:16px;font-weight:700;line-height:1.22;">' + escaparHtml_(item.art.titular) + '</div>' +
          '</a>' +
          '<div style="font-family:' + F_BODY + ';font-size:13.5px;color:' + C_INK2 + ';margin-top:4px;line-height:1.4;">' + escaparHtml_(item.bajada) + '</div>' +
          '<div style="font-family:' + F_MONO + ';font-size:10px;color:' + C_BLUE + ';margin-top:5px;text-transform:uppercase;letter-spacing:.06em;font-weight:600;">' + escaparHtml_(item.art.fuente) + '</div>' +
        '</div>'
      );
    }
  }

  return [
    '<div style="background:#E7E3DB;padding:26px 0;margin:0;">',
    '<table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td align="center">',
    '<table width="640" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;width:100%;background:#ffffff;">',

    // Banda oscura (igual que el pie) con logo + meta.
    '<tr><td style="background:' + C_INK + ';padding:22px 30px;">',
    '  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>',
    '    <td align="left" style="vertical-align:middle;"><span style="background:#fff;border-radius:4px;padding:9px 13px;display:inline-block;"><img src="' + LOGO_URL + '" alt="ALTO" height="24" style="height:24px;width:auto;display:block;"></span></td>',
    '    <td align="right" style="vertical-align:middle;font-family:' + F_MONO + ';font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#fff;line-height:1.7;">Barrido de Prensa · Boletín<br><b style="font-weight:600;">Edición · ' + escaparHtml_(edicion.fecha) + '</b><br>⏱ Lectura ~' + minutos + ' min</td>',
    '  </tr></table>',
    '</td></tr>',

    // Cuerpo.
    '<tr><td style="padding:28px 30px 8px;">',
    cuerpo.join('\n'),
    '</td></tr>',

    // Botón a la edición completa.
    '<tr><td style="padding:14px 30px 30px;">',
    '  <a href="' + escaparHtml_(edicionUrl) + '" style="display:inline-block;background:' + C_RED + ';color:#ffffff;font-family:' + F_MONO + ';font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;text-decoration:none;padding:13px 22px;">Ver edición completa y archivo →</a>',
    '</td></tr>',

    // Pie oscuro.
    '<tr><td style="background:' + C_INK + ';padding:16px 30px;">',
    '  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>',
    '    <td align="left" style="font-family:' + F_MONO + ';font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#fff;"><b style="color:' + C_RED + ';">ALTO</b> · Barrido de Prensa</td>',
    '    <td align="right" style="font-family:' + F_MONO + ';font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:' + C_GREY + ';">Uso interno</td>',
    '  </tr></table>',
    '</td></tr>',

    '</table>',
    '</td></tr></table>',
    '</div>'
  ].join('\n');
}

/** Bloque del boletín ALTO (riesgo + clientes afectados + nuevos MO). */
function renderBoletinCorreo_(boletin) {
  if (!boletin || (!boletin.clientes.length && !boletin.modus.length && !boletin.riesgo.length)) return '';

  var bloques = [seclblCorreo_('Boletín de Inteligencia ALTO')];

  // Riesgo por industria (semáforo).
  if (boletin.riesgo.length) {
    var chips = boletin.riesgo.map(function (r) {
      var c = colorRiesgo_(r.nivel);
      return '<span style="display:inline-block;background:' + c.bg + ';color:' + c.fg +
        ';font-family:' + F_MONO + ';font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;padding:5px 10px;margin:0 6px 7px 0;">' +
        escaparHtml_(r.industria) + ' · ' + escaparHtml_(r.nivel) + '</span>';
    }).join('');
    bloques.push('<div style="margin-bottom:20px;">' + chips + '</div>');
  }

  // Clientes afectados.
  if (boletin.clientes.length) {
    bloques.push(subLabelCorreo_('Clientes afectados · últimas 48 h (' + boletin.clientes.length + ')'));
    boletin.clientes.forEach(function (c) {
      var enc = escaparHtml_(c.cliente);
      if (c.industria) enc += ' · ' + escaparHtml_(c.industria);
      if (c.tipo_amenaza) enc += ' · ' + escaparHtml_(c.tipo_amenaza);
      bloques.push(
        '<div style="border-left:3px solid ' + C_RED + ';padding-left:13px;margin-bottom:18px;">' +
          '<div style="font-family:' + F_MONO + ';font-size:10px;color:' + C_RED + ';text-transform:uppercase;font-weight:bold;letter-spacing:.08em;">' + enc + '</div>' +
          '<a href="' + escaparHtml_(c.url) + '" style="color:' + C_INK + ';text-decoration:none;">' +
            '<div style="font-family:' + F_DISP + ';font-size:16px;font-weight:700;line-height:1.22;margin-top:4px;">' + escaparHtml_(c.titular) + '</div>' +
          '</a>' +
          (c.impacto ? '<div style="font-family:' + F_BODY + ';font-size:13px;color:' + C_INK2 + ';margin-top:5px;line-height:1.4;">' + escaparHtml_(c.impacto) + '</div>' : '') +
          (c.oportunidad_comercial ? '<div style="background:#EEF3FB;border-left:2px solid ' + C_BLUE + ';padding:9px 12px;margin-top:8px;font-family:' + F_BODY + ';font-size:12.5px;color:' + C_INK + ';line-height:1.4;"><b style="font-family:' + F_MONO + ';font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:' + C_BLUE + ';">Oportunidad comercial</b><br>' + escaparHtml_(c.oportunidad_comercial) + '</div>' : '') +
        '</div>'
      );
    });
  }

  // Nuevos modus operandi.
  if (boletin.modus.length) {
    bloques.push(subLabelCorreo_('Nuevos modus operandi'));
    boletin.modus.forEach(function (m) {
      bloques.push(
        '<div style="margin-bottom:10px;padding-left:16px;position:relative;font-family:' + F_BODY + ';font-size:13.5px;line-height:1.42;color:' + C_INK + ';">' +
          '<span style="color:' + C_RED + ';font-size:11px;position:absolute;left:0;top:1px;">&#9650;</span>' +
          '<a href="' + escaparHtml_(m.url) + '" style="color:' + C_INK + ';text-decoration:none;">' + escaparHtml_(m.descripcion) + '</a>' +
        '</div>'
      );
    });
  }

  return bloques.join('\n');
}

/** Etiqueta de sección del correo (filete superior ink + barra roja, mono). */
function seclblCorreo_(texto) {
  return '<div style="font-family:' + F_MONO + ';font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:' + C_RED +
    ';font-weight:bold;margin:26px 0 14px;border-top:1.5px solid ' + C_INK + ';padding-top:13px;">' +
    '<span style="display:inline-block;width:16px;height:2px;background:' + C_RED + ';vertical-align:middle;margin-right:8px;"></span>' +
    escaparHtml_(texto) + '</div>';
}
// Compat: el nombre anterior sigue funcionando.
function headingCorreo_(texto) { return seclblCorreo_(texto); }

/** Sub-etiqueta mono (dentro de una sección). */
function subLabelCorreo_(texto) {
  return '<div style="font-family:' + F_MONO + ';font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:' + C_INK2 +
    ';font-weight:600;margin:6px 0 13px;">' + escaparHtml_(texto) + '</div>';
}

/** Color del chip de riesgo según nivel (paleta ALTO). */
function colorRiesgo_(nivel) {
  var n = String(nivel || '').toLowerCase();
  if (n.indexOf('alto') !== -1)  return { bg: '#FBE0E0', fg: C_RED };
  if (n.indexOf('medio') !== -1) return { bg: '#F5ECD6', fg: '#9A7A16' };
  if (n.indexOf('bajo') !== -1)  return { bg: '#E6EEF7', fg: C_BLUE };
  return { bg: '#ECEAE3', fg: C_INK2 };
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
  afirmar_('banda roja presente', htmlEdicion.indexOf('class="band"') !== -1);
  afirmar_('hero presente', htmlEdicion.indexOf('class="hero"') !== -1);
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
