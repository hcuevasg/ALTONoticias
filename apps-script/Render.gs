/**
 * Render.gs — JSON → dos HTML (Pages completo + correo topado), identidad ALTO.
 * Estructura (cliente): I · ALTO en la Prensa → II · Inteligencia (Monitoreo de
 * Clientes) → III · Barrido de Prensa (1 Actualidad Chile · 2 Política Chile y El
 * Mundo · 3 Tendencias Delictuales, que incluye fallos judiciales y, al final,
 * Nuevos modus operandi).
 */

// --- Presupuesto del correo (control determinista del <5 min) -------------
var TOPE_CORREO = { titular_principal: 1, chile: 3, politica: 3, delictual: 3 };
var MAX_PALABRAS_BAJADA_CORREO = 30;
var TOPE_BOLETIN_CLIENTES = 10;
var TOPE_BOLETIN_MO = 5;
var TOPE_ALTO = 5;

var BASE_PAGES = 'https://hcuevasg.github.io/ALTONoticias';
var LOGO_URL   = BASE_PAGES + '/assets/alto-logo.png';

var C_RED = '#E84244', C_BLUE = '#4174B9', C_GREY = '#B0B6B8';
var C_INK = '#15181D', C_INK2 = '#4A4F57', C_INK3 = '#7C828B', C_LINE = '#E1DDD4';
var F_DISP = "Archivo,'Helvetica Neue',Arial,sans-serif";
var F_MONO = "'IBM Plex Sans',Arial,sans-serif";
var F_BODY = "'IBM Plex Sans',Arial,sans-serif";

var NUM_SECCION = { chile: '1', politica: '2', delictual: '3' };

// ======================================================================
//  EDICIÓN COMPLETA (Pages)
// ======================================================================

function renderEdicion(edicion) {
  var html = HtmlService.createTemplateFromFile('plantilla-edicion').getRawContent();
  html = reemplazar_(html, '{{FECHA}}', escaparHtml_(edicion.fecha));
  html = reemplazar_(html, '{{FECHA_LARGA}}', escaparHtml_(fechaLarga_(edicion.fecha)));
  html = reemplazar_(html, '{{INTELIGENCIA}}', renderInteligenciaEdicion_(edicion.boletin));
  html = reemplazar_(html, '{{PRENSA}}', renderPrensaEdicion_(edicion));
  html = reemplazar_(html, '{{ALTO}}', renderAltoEdicion_(edicion.alto_prensa));
  return html;
}

/** I · ALTO en la Prensa — menciones de Grupo ALTO en prensa. */
function renderAltoEdicion_(items) {
  items = items || [];
  var b = ['<section class="seccion">',
           '  <h2 class="seclbl">I · ALTO en la Prensa</h2>'];
  if (items.length) {
    b.push('  <div class="articulos">' + items.map(renderArticuloEdicion_).join('\n') + '</div>');
  } else {
    b.push('  <p class="archivo-vacio">Sin menciones de ALTO en las últimas 48 h.</p>');
  }
  b.push('</section>');
  return b.join('\n');
}

/** I · Inteligencia — Monitoreo de Clientes (riesgo + clientes afectados). */
function renderInteligenciaEdicion_(boletin) {
  boletin = boletin || {};
  var clientes = boletin.clientes_afectados || [];
  var riesgo = boletin.riesgo_por_industria || [];

  var b = ['<section class="seccion">', '  <h2 class="seclbl">II · Inteligencia — Monitoreo de Clientes</h2>'];

  if (riesgo.length) {
    var chips = riesgo.map(function (r) {
      return '<span class="chip ' + chipClaseRiesgo_(r.nivel) + '">' +
        escaparHtml_(r.industria) + ' · ' + escaparHtml_(r.nivel) + '</span>';
    }).join('');
    b.push('  <div class="riesgo">' + chips + '</div>');
  }

  if (clientes.length) {
    b.push('  <p class="sublbl">Clientes afectados · últimas 48 h (' + clientes.length + ')</p>');
    clientes.forEach(function (c) {
      var cab = escaparHtml_(c.cliente);
      if (c.industria) cab += ' · ' + escaparHtml_(c.industria);
      if (c.tipo_amenaza) cab += ' · ' + escaparHtml_(c.tipo_amenaza);
      if (c.fecha) cab += ' · ' + escaparHtml_(c.fecha);
      b.push(
        '  <div class="cliente">' +
          '<p class="cliente__cab">' + cab + '</p>' +
          '<h3 class="cliente__titular"><a href="' + escaparHtml_(c.url) + '">' + escaparHtml_(c.titular) + '</a></h3>' +
          (c.impacto ? '<p class="cliente__impacto">' + escaparHtml_(c.impacto) + '</p>' : '') +
          (c.oportunidad_comercial ? '<div class="oportunidad"><b>Oportunidad comercial</b>' + escaparHtml_(c.oportunidad_comercial) + '</div>' : '') +
        '</div>'
      );
    });
  } else {
    b.push('  <p class="archivo-vacio">Sin novedades de clientes en las últimas 48 h.</p>');
  }

  b.push('</section>');
  return b.join('\n');
}

/** II · Barrido de Prensa (titular + 3 secciones; MO al final de delictual). */
function renderPrensaEdicion_(edicion) {
  var b = [];

  // Titular principal (hero) — encabeza el bloque II.
  var tp = edicion.titular_principal;
  if (tp && tp.url) {
    b.push(
      '<section class="hero">' +
        '<p class="kick">III · Barrido de Prensa</p>' +
        '<h1><a href="' + escaparHtml_(tp.url) + '">' + escaparHtml_(tp.titular) + '</a></h1>' +
        '<p class="hero__bajada">' + escaparHtml_(tp.bajada) + '</p>' +
        '<p class="hero__fuente">' + escaparHtml_(tp.fuente) + (tp.fecha ? ' · ' + escaparHtml_(tp.fecha) : '') + '</p>' +
      '</section>'
    );
  }

  // Secciones numeradas.
  (edicion.secciones || []).forEach(function (sec) {
    if (!sec.articulos || !sec.articulos.length) return;
    var num = NUM_SECCION[sec.id] ? (NUM_SECCION[sec.id] + ' · ') : '';
    var arts = sec.articulos.map(renderArticuloEdicion_).join('\n');
    var extra = '';
    if (sec.id === 'delictual') extra = moEdicionHtml_((edicion.boletin || {}).nuevos_modus_operandi || []);
    b.push(
      '<section class="seccion">' +
        '<h2 class="seclbl">' + num + escaparHtml_(sec.titulo) + '</h2>' +
        '<div class="articulos">' + arts + '</div>' +
        extra +
      '</section>'
    );
  });

  return b.join('\n');
}

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

/** Sub-bloque "Nuevos modus operandi" para Pages (dentro de delictual). */
function moEdicionHtml_(modus) {
  if (!modus.length) return '';
  var items = modus.map(function (m) {
    var f = m.fecha ? ' <span style="font-family:' + F_MONO + ';font-size:10px;color:' + C_INK3 + ';">· ' + escaparHtml_(m.fecha) + '</span>' : '';
    return '<li><a href="' + escaparHtml_(m.url) + '">' + escaparHtml_(m.descripcion) + '</a>' + f + '</li>';
  }).join('');
  return '<p class="sublbl">Nuevos modus operandi</p><ul class="mo">' + items + '</ul>';
}

function chipClaseRiesgo_(nivel) {
  var n = String(nivel || '').toLowerCase();
  if (n.indexOf('alto') !== -1)  return 'chip--alto';
  if (n.indexOf('medio') !== -1) return 'chip--medio';
  return 'chip--bajo';
}

// ======================================================================
//  CORREO (digest topado, estilos inline)
// ======================================================================

function renderCorreo(edicion) {
  var tp = edicion.titular_principal;
  var palabras = contarPalabras_(tp.titular) + contarPalabras_(tp.bajada);

  var seccionesCorreo = [];
  (edicion.secciones || []).forEach(function (sec) {
    var tope = TOPE_CORREO[sec.id] || 0;
    var elegidos = sec.articulos.slice()
      .sort(function (x, y) { return y.relevancia - x.relevancia; })
      .slice(0, tope);
    if (!elegidos.length) return;
    var arts = elegidos.map(function (art) {
      var bajada = truncarPalabras_(art.bajada, MAX_PALABRAS_BAJADA_CORREO);
      palabras += contarPalabras_(art.titular) + contarPalabras_(bajada);
      return { art: art, bajada: bajada };
    });
    seccionesCorreo.push({ id: sec.id, titulo: sec.titulo, arts: arts });
  });

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

  var altoItems = (edicion.alto_prensa || []).slice(0, TOPE_ALTO).map(function (art) {
    var bajada = truncarPalabras_(art.bajada, MAX_PALABRAS_BAJADA_CORREO);
    palabras += contarPalabras_(art.titular) + contarPalabras_(bajada);
    return { art: art, bajada: bajada };
  });

  var minutos = Math.max(1, Math.round(palabras / 200));
  var edicionUrl = BASE_PAGES + '/ediciones/' + encodeURIComponent(edicion.fecha) + '.html';
  return { html: construirHtmlCorreo_(edicion, seccionesCorreo, boletin, altoItems, minutos, edicionUrl),
           minutos: minutos, palabras: palabras };
}

function construirHtmlCorreo_(edicion, seccionesCorreo, boletin, altoItems, minutos, edicionUrl) {
  var tp = edicion.titular_principal;
  var cuerpo = [];

  // I · ALTO en la Prensa.
  cuerpo.push(altoCorreoHtml_(altoItems));

  // II · Inteligencia — Monitoreo de Clientes.
  cuerpo.push(renderInteligenciaCorreo_(boletin));

  // III · Barrido de Prensa (el titular encabeza el bloque).
  cuerpo.push(
    '<div style="padding-top:13px;margin-bottom:6px;border-top:1.5px solid ' + C_INK + ';">' +
      '<div style="font-family:' + F_MONO + ';font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:' + C_RED + ';font-weight:bold;margin-bottom:9px;">III · Barrido de Prensa</div>' +
      '<a href="' + escaparHtml_(tp.url) + '" style="color:' + C_INK + ';text-decoration:none;">' +
        '<div style="font-family:' + F_DISP + ';font-size:27px;font-weight:800;line-height:1.04;letter-spacing:-.02em;">' + escaparHtml_(tp.titular) + '</div>' +
      '</a>' +
      '<div style="font-family:' + F_BODY + ';font-size:15px;line-height:1.45;color:' + C_INK2 + ';margin-top:9px;">' + escaparHtml_(tp.bajada) + '</div>' +
      '<div style="font-family:' + F_MONO + ';font-size:10px;color:' + C_RED + ';text-transform:uppercase;letter-spacing:.1em;margin-top:9px;">' + escaparHtml_(tp.fuente) + (tp.fecha ? ' <span style="color:' + C_INK3 + ';">· ' + escaparHtml_(tp.fecha) + '</span>' : '') + '</div>' +
    '</div>'
  );

  seccionesCorreo.forEach(function (sec) {
    var num = NUM_SECCION[sec.id] ? (NUM_SECCION[sec.id] + ' · ') : '';
    cuerpo.push(seclblCorreo_(num + sec.titulo));
    sec.arts.forEach(function (item) {
      cuerpo.push(
        '<div style="margin-bottom:15px;">' +
          '<a href="' + escaparHtml_(item.art.url) + '" style="color:' + C_INK + ';text-decoration:none;">' +
            '<div style="font-family:' + F_DISP + ';font-size:16px;font-weight:700;line-height:1.22;">' + escaparHtml_(item.art.titular) + '</div>' +
          '</a>' +
          '<div style="font-family:' + F_BODY + ';font-size:13.5px;color:' + C_INK2 + ';margin-top:4px;line-height:1.4;">' + escaparHtml_(item.bajada) + '</div>' +
          '<div style="font-family:' + F_MONO + ';font-size:10px;color:' + C_BLUE + ';margin-top:5px;text-transform:uppercase;letter-spacing:.06em;font-weight:600;">' + escaparHtml_(item.art.fuente) + (item.art.fecha ? ' <span style="color:' + C_INK3 + ';font-weight:400;">· ' + escaparHtml_(item.art.fecha) + '</span>' : '') + '</div>' +
        '</div>'
      );
    });
    if (sec.id === 'delictual') cuerpo.push(moCorreoHtml_(boletin.modus));
  });

  return [
    '<div style="background:#E7E3DB;padding:26px 0;margin:0;">',
    '<table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td align="center">',
    '<table width="640" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;width:100%;background:#ffffff;">',
    '<tr><td style="background:' + C_INK + ';padding:22px 30px;">',
    '  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>',
    '    <td align="left" style="vertical-align:middle;"><span style="background:#fff;border-radius:4px;padding:9px 13px;display:inline-block;"><img src="' + LOGO_URL + '" alt="ALTO" height="24" style="height:24px;width:auto;display:block;"></span></td>',
    '    <td align="right" style="vertical-align:middle;font-family:' + F_MONO + ';font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#fff;line-height:1.7;">Inteligencia & Prensa<br><b style="font-weight:600;">Edición · ' + escaparHtml_(edicion.fecha) + '</b><br>⏱ Lectura ~' + minutos + ' min</td>',
    '  </tr></table>',
    '</td></tr>',
    '<tr><td style="padding:28px 30px 8px;">',
    cuerpo.join('\n'),
    '</td></tr>',
    '<tr><td style="padding:14px 30px 30px;">',
    '  <a href="' + escaparHtml_(edicionUrl) + '" style="display:inline-block;background:' + C_RED + ';color:#ffffff;font-family:' + F_MONO + ';font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;text-decoration:none;padding:13px 22px;">Ver edición completa y archivo →</a>',
    '</td></tr>',
    '<tr><td style="background:' + C_INK + ';padding:16px 30px;">',
    '  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>',
    '    <td align="left" style="font-family:' + F_MONO + ';font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#fff;"><b style="color:' + C_RED + ';">ALTO</b> · Barrido de Prensa</td>',
    '    <td align="right" style="font-family:' + F_MONO + ';font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:' + C_GREY + ';">Uso interno</td>',
    '  </tr></table>',
    '</td></tr>',
    '</table></td></tr></table></div>'
  ].join('\n');
}

/** I · Inteligencia — Monitoreo de Clientes (correo): riesgo + clientes. */
function renderInteligenciaCorreo_(boletin) {
  var b = [seclblCorreo_('II · Inteligencia — Monitoreo de Clientes')];

  if (boletin.riesgo.length) {
    var chips = boletin.riesgo.map(function (r) {
      var c = colorRiesgo_(r.nivel);
      return '<span style="display:inline-block;background:' + c.bg + ';color:' + c.fg +
        ';font-family:' + F_MONO + ';font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;padding:5px 10px;margin:0 6px 7px 0;">' +
        escaparHtml_(r.industria) + ' · ' + escaparHtml_(r.nivel) + '</span>';
    }).join('');
    b.push('<div style="margin-bottom:20px;">' + chips + '</div>');
  }

  if (boletin.clientes.length) {
    b.push(subLabelCorreo_('Clientes afectados · últimas 48 h (' + boletin.clientes.length + ')'));
    boletin.clientes.forEach(function (c) {
      var enc = escaparHtml_(c.cliente);
      if (c.industria) enc += ' · ' + escaparHtml_(c.industria);
      if (c.tipo_amenaza) enc += ' · ' + escaparHtml_(c.tipo_amenaza);
      if (c.fecha) enc += ' · ' + escaparHtml_(c.fecha);
      b.push(
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
  } else {
    b.push('<div style="font-family:' + F_BODY + ';font-size:13px;color:' + C_INK3 + ';font-style:italic;margin-bottom:6px;">Sin novedades de clientes en las últimas 48 h.</div>');
  }

  return b.join('\n');
}

/** Sub-bloque "Nuevos modus operandi" para el correo (dentro de delictual). */
function moCorreoHtml_(modus) {
  if (!modus.length) return '';
  var b = [subLabelCorreo_('Nuevos modus operandi')];
  modus.forEach(function (m) {
    b.push(
      '<div style="margin-bottom:10px;padding-left:16px;position:relative;font-family:' + F_BODY + ';font-size:13.5px;line-height:1.42;color:' + C_INK + ';">' +
        '<span style="display:inline-block;width:6px;height:6px;background:' + C_RED + ';position:absolute;left:0;top:7px;"></span>' +
        '<a href="' + escaparHtml_(m.url) + '" style="color:' + C_INK + ';text-decoration:none;">' + escaparHtml_(m.descripcion) + '</a>' +
        (m.fecha ? ' <span style="font-family:' + F_MONO + ';font-size:10px;color:' + C_INK3 + ';">· ' + escaparHtml_(m.fecha) + '</span>' : '') +
      '</div>'
    );
  });
  return b.join('\n');
}

/** III · ALTO en la Prensa (correo): titulares estilo prensa o nota de vacío. */
function altoCorreoHtml_(altoItems) {
  var b = [seclblCorreo_('I · ALTO en la Prensa')];
  if (altoItems && altoItems.length) {
    altoItems.forEach(function (item) {
      b.push(
        '<div style="margin-bottom:15px;">' +
          '<a href="' + escaparHtml_(item.art.url) + '" style="color:' + C_INK + ';text-decoration:none;">' +
            '<div style="font-family:' + F_DISP + ';font-size:16px;font-weight:700;line-height:1.22;">' + escaparHtml_(item.art.titular) + '</div>' +
          '</a>' +
          '<div style="font-family:' + F_BODY + ';font-size:13.5px;color:' + C_INK2 + ';margin-top:4px;line-height:1.4;">' + escaparHtml_(item.bajada) + '</div>' +
          '<div style="font-family:' + F_MONO + ';font-size:10px;color:' + C_BLUE + ';margin-top:5px;text-transform:uppercase;letter-spacing:.06em;font-weight:600;">' + escaparHtml_(item.art.fuente) + (item.art.fecha ? ' <span style="color:' + C_INK3 + ';font-weight:400;">· ' + escaparHtml_(item.art.fecha) + '</span>' : '') + '</div>' +
        '</div>'
      );
    });
  } else {
    b.push('<div style="font-family:' + F_BODY + ';font-size:13px;color:' + C_INK3 + ';font-style:italic;margin-bottom:6px;">Sin menciones de ALTO en las últimas 48 h.</div>');
  }
  return b.join('\n');
}

function seclblCorreo_(texto) {
  return '<div style="font-family:' + F_MONO + ';font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:' + C_RED +
    ';font-weight:bold;margin:26px 0 14px;border-top:1.5px solid ' + C_INK + ';padding-top:13px;">' +
    '<span style="display:inline-block;width:16px;height:2px;background:' + C_RED + ';vertical-align:middle;margin-right:8px;"></span>' +
    escaparHtml_(texto) + '</div>';
}
function headingCorreo_(texto) { return seclblCorreo_(texto); }

function subLabelCorreo_(texto) {
  return '<div style="font-family:' + F_MONO + ';font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:' + C_INK2 +
    ';font-weight:600;margin:6px 0 13px;">' + escaparHtml_(texto) + '</div>';
}

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

function testRender() {
  Logger.log('=== Prueba de render ===');
  var articulos = recolectarTitulares();
  var edicion = generarEdicion(articulos);
  if (!edicion) { Logger.log('✗ Sin edición.'); return; }

  var htmlEdicion = renderEdicion(edicion);
  Logger.log('— Edición: %s caracteres', htmlEdicion.length);
  afirmar_('banda presente', htmlEdicion.indexOf('class="band"') !== -1);
  afirmar_('Inteligencia primero', htmlEdicion.indexOf('Monitoreo de Clientes') !== -1);
  afirmar_('Barrido de Prensa presente', htmlEdicion.indexOf('Barrido de Prensa') !== -1);
  afirmar_('ALTO en la Prensa presente', htmlEdicion.indexOf('I · ALTO en la Prensa') !== -1);
  afirmar_('sin placeholders', htmlEdicion.indexOf('{{') === -1);

  var correo = renderCorreo(edicion);
  Logger.log('— Correo: %s caracteres · %s palabras · ⏱ ~%s min', correo.html.length, correo.palabras, correo.minutos);
  Logger.log('----- INICIO HTML CORREO -----');
  Logger.log(correo.html);
  Logger.log('----- FIN HTML CORREO -----');
}
function afirmar_(nombre, cond) { Logger.log('   %s %s', cond ? '✓' : '✗', nombre); }

// ======================================================================
//  Utilidades de render
// ======================================================================

function reemplazar_(str, token, valor) { return str.split(token).join(valor); }

function escaparHtml_(texto) {
  return String(texto == null ? '' : texto)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function puntosRelevancia_(rel) {
  var n = Math.max(1, Math.min(5, parseInt(rel, 10) || 1));
  return new Array(n + 1).join('●') + new Array(5 - n + 1).join('○');
}

function contarPalabras_(texto) {
  var t = String(texto || '').trim();
  return t ? t.split(/\s+/).length : 0;
}
function truncarPalabras_(texto, n) {
  var p = String(texto || '').trim().split(/\s+/);
  return p.length <= n ? p.join(' ') : p.slice(0, n).join(' ') + '…';
}

var MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
var DIAS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function fechaLarga_(iso) {
  var p = String(iso).split('-');
  if (p.length !== 3) return String(iso);
  var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
  return DIAS_ES[d.getDay()] + ' ' + d.getDate() + ' de ' + MESES_ES[d.getMonth()] + ' de ' + d.getFullYear();
}
