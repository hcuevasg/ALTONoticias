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
// Paleta "Informe de Prensa" (correo): azul marino institucional + apoyos.
var C_NAVY = '#1B3452', C_NAVYSOFT = '#B9C4D6', C_BODY = '#5C6470', C_META = '#8A93A0';
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
//  CORREO — "Informe de Prensa" (digest topado, estilos inline)
//  Diseño: header azul marino + secciones numeradas con pastilla +
//  titular en bold corrido con la bajada + fuente roja/fecha + lema footer.
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
  var numero = 1;

  // 1 · ALTO en la Prensa.
  cuerpo.push(altoCorreoHtml_(altoItems, numero++));

  // 2 · Clientes ALTO (riesgo + clientes afectados).
  cuerpo.push(renderInteligenciaCorreo_(boletin, numero++));

  // 3+ · Barrido: el titular principal abre como destacado la primera sección.
  var heroHtml = (tp && tp.url) ?
    '<div style="margin-bottom:22px;">' +
      '<a href="' + escaparHtml_(tp.url) + '" style="color:' + C_NAVY + ';text-decoration:none;">' +
        '<div style="font-family:' + F_DISP + ';font-size:21px;font-weight:800;line-height:1.15;letter-spacing:-.01em;color:' + C_NAVY + ';">' + escaparHtml_(tp.titular) + '</div>' +
      '</a>' +
      '<div style="font-family:' + F_BODY + ';font-size:14px;line-height:1.5;color:' + C_BODY + ';margin-top:7px;">' + escaparHtml_(tp.bajada) + '</div>' +
      fuenteMetaCorreo_(tp.fuente, tp.fecha) +
    '</div>' : '';

  if (!seccionesCorreo.length && heroHtml) {
    cuerpo.push(seclblCorreo_(numero++, 'Actualidad Chile'));
    cuerpo.push(heroHtml);
  }

  seccionesCorreo.forEach(function (sec, i) {
    cuerpo.push(seclblCorreo_(numero++, sec.titulo));
    if (i === 0 && heroHtml) cuerpo.push(heroHtml);
    sec.arts.forEach(function (item) {
      cuerpo.push(articuloCorreoHtml_(item.art, item.bajada));
    });
    if (sec.id === 'delictual') cuerpo.push(moCorreoHtml_(boletin.modus));
  });

  return [
    '<div style="background:#EEF1F5;padding:26px 0;margin:0;">',
    '<table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td align="center">',
    '<table width="640" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;">',
    '<tr><td style="background:' + C_NAVY + ';padding:24px 30px;border-radius:10px 10px 0 0;">',
    '  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>',
    '    <td align="left" style="vertical-align:middle;">',
    '      <div style="font-family:' + F_DISP + ';font-size:25px;font-weight:900;letter-spacing:.01em;line-height:1;color:#ffffff;">INFORME DE PRENSA</div>',
    '      <div style="font-family:' + F_MONO + ';font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:' + C_NAVYSOFT + ';margin-top:8px;">Edici&oacute;n &ndash; ' + escaparHtml_(fechaBarra_(edicion.fecha)) + ' &nbsp;&middot;&nbsp; &#9201; Lectura ~' + minutos + ' min</div>',
    '    </td>',
    '    <td align="right" style="vertical-align:middle;white-space:nowrap;">',
    '      <span style="background:#ffffff;border-radius:6px;padding:8px 12px;display:inline-block;vertical-align:middle;"><img src="' + LOGO_URL + '" alt="ALTO" height="22" style="height:22px;width:auto;display:block;"></span>',
    '      <span style="display:inline-block;vertical-align:middle;width:1px;height:26px;background:#4A5F7E;margin:0 12px;"></span>',
    '      <span style="font-size:15px;vertical-align:middle;letter-spacing:2px;">🇨🇱🇨🇴🇺🇸🇲🇽</span>',
    '    </td>',
    '  </tr></table>',
    '</td></tr>',
    '<tr><td style="padding:16px 34px 8px;">',
    cuerpo.join('\n'),
    '</td></tr>',
    '<tr><td align="center" style="padding:16px 34px 4px;">',
    '  <a href="' + escaparHtml_(edicionUrl) + '" style="display:inline-block;background:' + C_RED + ';color:#ffffff;font-family:' + F_DISP + ';font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;text-decoration:none;padding:12px 26px;border-radius:22px;">Ver edici&oacute;n completa y archivo &rarr;</a>',
    '</td></tr>',
    '<tr><td align="center" style="padding:18px 34px 10px;">',
    '  <div style="display:inline-block;background:' + C_NAVY + ';color:#ffffff;font-family:' + F_BODY + ';font-size:13px;padding:13px 34px;border-radius:24px;">Creando juntos comunidades <b>m&aacute;s seguras</b></div>',
    '</td></tr>',
    '<tr><td align="center" style="padding:0 34px 26px;font-family:' + F_MONO + ';font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:' + C_META + ';">ALTO &middot; Informe de Prensa &middot; Uso interno</td></tr>',
    '</table></td></tr></table></div>'
  ].join('\n');
}

/** Artículo del correo: titular en bold corrido con la bajada + fuente/fecha. */
function articuloCorreoHtml_(art, bajada) {
  return '<div style="margin-bottom:19px;">' +
    '<div style="font-family:' + F_BODY + ';font-size:13.5px;line-height:1.5;color:' + C_BODY + ';">' +
      '<a href="' + escaparHtml_(art.url) + '" style="text-decoration:none;">' +
        '<span style="font-family:' + F_DISP + ';font-weight:800;color:' + C_NAVY + ';">' + escaparHtml_(conPunto_(art.titular)) + '</span>' +
      '</a> ' + escaparHtml_(bajada) +
    '</div>' +
    fuenteMetaCorreo_(art.fuente, art.fecha) +
  '</div>';
}

/** Línea de fuente: FUENTE en rojo • fecha DD | MM | YYYY en azul marino. */
function fuenteMetaCorreo_(fuente, fecha) {
  var b = '<div style="font-family:' + F_MONO + ';font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-top:6px;">' +
    '<span style="color:' + C_RED + ';">' + escaparHtml_(fuente) + '</span>';
  if (fecha) {
    b += '<span style="color:' + C_META + ';font-weight:400;"> &nbsp;&bull;&nbsp; </span>' +
         '<span style="color:' + C_NAVY + ';font-weight:600;">' + escaparHtml_(fechaBarra_(fecha)) + '</span>';
  }
  return b + '</div>';
}

/** 2 · Clientes ALTO (correo): riesgo + clientes afectados. */
function renderInteligenciaCorreo_(boletin, numero) {
  var b = [seclblCorreo_(numero, 'Clientes ALTO')];

  if (boletin.riesgo.length) {
    var chips = boletin.riesgo.map(function (r) {
      var c = colorRiesgo_(r.nivel);
      return '<span style="display:inline-block;background:' + c.bg + ';color:' + c.fg +
        ';font-family:' + F_MONO + ';font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;padding:5px 11px;margin:0 6px 7px 0;border-radius:11px;">' +
        escaparHtml_(r.industria) + ' · ' + escaparHtml_(r.nivel) + '</span>';
    }).join('');
    b.push('<div style="margin-bottom:18px;">' + chips + '</div>');
  }

  if (boletin.clientes.length) {
    boletin.clientes.forEach(function (c) {
      var enc = c.cliente || '';
      if (c.industria) enc += ' · ' + c.industria;
      if (c.tipo_amenaza) enc += ' · ' + c.tipo_amenaza;
      b.push(
        '<div style="margin-bottom:19px;">' +
          '<div style="font-family:' + F_BODY + ';font-size:13.5px;line-height:1.5;color:' + C_BODY + ';">' +
            '<a href="' + escaparHtml_(c.url) + '" style="text-decoration:none;">' +
              '<span style="font-family:' + F_DISP + ';font-weight:800;color:' + C_NAVY + ';">' + escaparHtml_(conPunto_(c.titular)) + '</span>' +
            '</a>' + (c.impacto ? ' ' + escaparHtml_(c.impacto) : '') +
          '</div>' +
          fuenteMetaCorreo_(enc, c.fecha) +
          (c.oportunidad_comercial ? '<div style="background:#EEF2F8;border-left:3px solid ' + C_NAVY + ';padding:10px 14px;margin-top:9px;font-family:' + F_BODY + ';font-size:12.5px;color:' + C_INK + ';line-height:1.45;border-radius:0 8px 8px 0;"><b style="font-family:' + F_MONO + ';font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:' + C_NAVY + ';">Oportunidad comercial</b><br>' + escaparHtml_(c.oportunidad_comercial) + '</div>' : '') +
        '</div>'
      );
    });
  } else {
    b.push('<div style="font-family:' + F_BODY + ';font-size:13px;color:' + C_META + ';font-style:italic;margin-bottom:6px;">Sin novedades de clientes en las últimas 48 h.</div>');
  }

  return b.join('\n');
}

/** Sub-bloque "Nuevos modus operandi" para el correo (dentro de delictual). */
function moCorreoHtml_(modus) {
  if (!modus.length) return '';
  var b = [subLabelCorreo_('Nuevos modus operandi')];
  modus.forEach(function (m) {
    b.push(
      '<div style="margin-bottom:10px;padding-left:16px;position:relative;font-family:' + F_BODY + ';font-size:13.5px;line-height:1.45;color:' + C_BODY + ';">' +
        '<span style="display:inline-block;width:6px;height:6px;background:' + C_RED + ';border-radius:3px;position:absolute;left:0;top:7px;"></span>' +
        '<a href="' + escaparHtml_(m.url) + '" style="color:' + C_NAVY + ';text-decoration:none;font-weight:600;">' + escaparHtml_(m.descripcion) + '</a>' +
        (m.fecha ? ' <span style="font-family:' + F_MONO + ';font-size:10px;color:' + C_META + ';">&bull; ' + escaparHtml_(fechaBarra_(m.fecha)) + '</span>' : '') +
      '</div>'
    );
  });
  return b.join('\n');
}

/** 1 · ALTO en la Prensa (correo): titulares estilo prensa o nota de vacío. */
function altoCorreoHtml_(altoItems, numero) {
  var b = [seclblCorreo_(numero, 'ALTO en la Prensa')];
  if (altoItems && altoItems.length) {
    altoItems.forEach(function (item) {
      b.push(articuloCorreoHtml_(item.art, item.bajada));
    });
  } else {
    b.push('<div style="font-family:' + F_BODY + ';font-size:13px;color:' + C_META + ';font-style:italic;margin-bottom:6px;">Sin menciones de ALTO en las últimas 48 h.</div>');
  }
  return b.join('\n');
}

/** Cabecera de sección: línea + pastilla azul con número + título en mayúsculas. */
function seclblCorreo_(numero, texto) {
  return '<div style="margin:26px 0 16px;">' +
    '<span style="display:inline-block;width:20px;height:3px;background:' + C_NAVY + ';vertical-align:middle;"></span>' +
    '<span style="display:inline-block;background:' + C_NAVY + ';color:#ffffff;font-family:' + F_DISP + ';font-size:12px;font-weight:700;line-height:1;padding:5px 11px;border-radius:11px;vertical-align:middle;margin-right:11px;">' + escaparHtml_(String(numero)) + '</span>' +
    '<span style="font-family:' + F_DISP + ';font-size:17px;font-weight:800;letter-spacing:.03em;text-transform:uppercase;color:' + C_NAVY + ';vertical-align:middle;">' + escaparHtml_(texto) + '</span>' +
  '</div>';
}

function subLabelCorreo_(texto) {
  return '<div style="font-family:' + F_MONO + ';font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:' + C_NAVY +
    ';font-weight:700;margin:6px 0 13px;">' + escaparHtml_(texto) + '</div>';
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
  afirmar_('header Informe de Prensa', correo.html.indexOf('INFORME DE PRENSA') !== -1);
  afirmar_('sección ALTO en la Prensa', correo.html.indexOf('ALTO en la Prensa') !== -1);
  afirmar_('sección Clientes ALTO', correo.html.indexOf('Clientes ALTO') !== -1);
  afirmar_('lema en footer', correo.html.indexOf('Creando juntos comunidades') !== -1);
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

/** 'YYYY-MM-DD' → 'DD | MM | YYYY' (formato del encabezado del Informe). */
function fechaBarra_(iso) {
  var p = String(iso || '').split('-');
  if (p.length !== 3) return String(iso || '');
  return p[2] + ' | ' + p[1] + ' | ' + p[0];
}

/** Asegura punto final en el titular (estilo run-in del Informe). */
function conPunto_(texto) {
  var t = String(texto || '').trim();
  return /[.!?…:"»”]$/.test(t) ? t : t + '.';
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
