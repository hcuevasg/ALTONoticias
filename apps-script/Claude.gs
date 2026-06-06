/**
 * Claude.gs — Embudo de inteligencia (Niveles 2 y 3)
 * UNA llamada a Anthropic que produce DOS salidas desde el corpus detectado:
 *   1) Diario de prensa: titular_principal + secciones chile/politica/delictual.
 *   2) Boletín ALTO: clientes_afectados (con oportunidad comercial), nuevos
 *      modus operandi, y riesgo por industria.
 *
 * Anti-alucinación por id-indirection: al modelo se le pasan titulares numerados
 * SIN url; referencia por id y nosotros resolvemos url/fuente/fecha reales.
 *
 * Verificación: setear ANTHROPIC_API_KEY y ejecutar testClaude().
 */

var CLAUDE_ENDPOINT = 'https://api.anthropic.com/v1/messages';
var CLAUDE_MODELO   = 'claude-sonnet-4-6';
var CLAUDE_VERSION  = '2023-06-01';
var CLAUDE_MAX_TOKENS = 12000;

// Secciones del DIARIO de prensa (el boletín de clientes va aparte).
var SECCIONES = [
  { id: 'chile',     titulo: 'Actualidad Chile' },
  { id: 'politica',  titulo: 'Política Chile y El Mundo' },
  { id: 'delictual', titulo: 'Tendencias Delictuales' }
];

/** Punto de entrada de verificación. */
function testClaude() {
  Logger.log('=== Prueba del embudo (Claude) ===');

  var articulos = recolectarTitulares();
  if (!articulos.length) { Logger.log('✗ Sin titulares.'); return; }
  Logger.log('Titulares de entrada: %s', articulos.length);

  var edicion = generarEdicion(articulos);
  if (!edicion) { Logger.log('✗ No se pudo generar una edición válida.'); return; }

  Logger.log('✓ JSON válido. Fecha: %s', edicion.fecha);
  Logger.log('★ Titular: %s — %s', edicion.titular_principal.titular, edicion.titular_principal.fuente);
  for (var s = 0; s < edicion.secciones.length; s++) {
    Logger.log('— %s: %s artículos', edicion.secciones[s].titulo, edicion.secciones[s].articulos.length);
  }
  var b = edicion.boletin;
  Logger.log('▣ BOLETÍN ALTO');
  Logger.log('  Clientes afectados: %s', b.clientes_afectados.length);
  for (var c = 0; c < Math.min(b.clientes_afectados.length, 8); c++) {
    var ca = b.clientes_afectados[c];
    Logger.log('    • [%s/%s] %s | amenaza: %s | oportunidad: %s',
               ca.cliente, ca.industria, ca.titular, ca.tipo_amenaza, ca.oportunidad_comercial);
  }
  Logger.log('  Nuevos modus operandi: %s', b.nuevos_modus_operandi.length);
  for (var m = 0; m < Math.min(b.nuevos_modus_operandi.length, 5); m++) {
    Logger.log('    • %s', b.nuevos_modus_operandi[m].descripcion);
  }
  Logger.log('  Riesgo por industria:');
  for (var r = 0; r < b.riesgo_por_industria.length; r++) {
    var ri = b.riesgo_por_industria[r];
    Logger.log('    • %s: %s (%s)', ri.industria, ri.nivel, ri.motivo);
  }
}

/**
 * Genera el contrato completo (diario + boletín) a partir del corpus.
 * @param {Array<Object>} articulos  salida de recolectarTitulares().
 * @return {Object|null}
 */
function generarEdicion(articulos) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) { Logger.log('✗ Falta ANTHROPIC_API_KEY.'); return null; }

  var roster = leerRosterClientes_();
  var promptUsuario = construirPromptUsuario_(articulos, roster);

  var texto = llamarClaude_(apiKey, PROMPT_SISTEMA, promptUsuario);
  if (!texto) return null;

  var seleccion = parsearJsonDefensivo_(texto);
  if (!seleccion) { Logger.log('✗ Respuesta del modelo no parseable.'); return null; }

  return expandirAContrato_(seleccion, articulos);
}

// ---------- Prompt -------------------------------------------------------

var PROMPT_SISTEMA = [
  'Sos analista de inteligencia de ALTO, empresa de prevención de pérdidas y seguridad',
  'corporativa contra el crimen organizado (retail, utilities, logística, etc.).',
  '',
  'Recibís: (1) una lista NUMERADA de titulares reales de hoy, cada uno etiquetado por',
  'origen — "general", "delictual", "tendencia" o "clientes/<industria>"; y (2) un ROSTER',
  'de clientes de ALTO con su industria y alias.',
  '',
  'Producí DOS salidas en un solo JSON:',
  '',
  'A) DIARIO DE PRENSA (titular_principal + secciones chile, politica, delictual):',
  '   Curaduría general para un diario. Elegí UN titular principal del día.',
  '   Descartá farándula, deportes triviales, videojuegos y marketing.',
  '   En la sección delictual INCLUÍ además fallos judiciales relevantes: condenas,',
  '   formalizaciones, sentencias y operativos contra bandas.',
  '   Bajada de ~30 palabras en español; relevancia entera 1-5.',
  '',
  'B) BOLETÍN DE INTELIGENCIA ALTO:',
  '   - clientes_afectados: SOLO noticias que (i) mencionan a un cliente del ROSTER y',
  '     (ii) son un INCIDENTE o AMENAZA relevante para ALTO (robo, hurto, fraude, incendio,',
  '     encerrona, robo de carga/cable/cobre, banda, etc.). DESCARTÁ marketing, aperturas,',
  '     campañas, resultados financieros, lanzamientos. Atribuí el cliente EXACTO del roster',
  '     (usá los alias: si dice "Líder" es Walmart, "Sodimac" es Homecenter, "Movistar" es',
  '     Telefónica). INCLUÍ un cliente SOLO si es el protagonista/víctima explícito del',
  '     incidente (nombrado y claramente afectado). NO fuerces la atribución por conexiones',
  '     tangenciales: una nota de crimen organizado general NO es un cliente afectado solo',
  '     porque toca el sector. Ante la duda, NO lo incluyas.',
  '     industria = la del cliente en el roster. Completá tipo_amenaza,',
  '     impacto (1 frase) y oportunidad_comercial: qué servicio le vendería ALTO a partir',
  '     de esa noticia (inteligencia criminal, monitoreo de bandas, investigación, analítica',
  '     predictiva, prevención de pérdidas, peritaje, ciberinteligencia, etc.).',
  '   - nuevos_modus_operandi: de los titulares "tendencia"/"delictual", métodos nuevos o',
  '     virales de delito. descripcion breve (1-2 frases).',
  '   - riesgo_por_industria: por cada industria con hallazgos de clientes, nivel "Alto",',
  '     "Medio" o "Bajo" con un motivo breve. CALIBRÁ usando todo el rango: "Alto" solo si hay',
  '     incidentes graves Y recurrentes hoy; "Medio" para señales moderadas o aisladas; "Bajo"',
  '     para poca o nula actividad. NO marques todo "Alto".',
  '',
  'Reglas: referenciá cada artículo SOLO por su id. NO inventes ids ni artículos. NO copies',
  'el titular ni la fuente (los completamos por id). Ordená por relevancia descendente.',
  '',
  'Devolvé EXCLUSIVAMENTE este JSON, sin texto adicional y SIN fences de markdown:',
  '{',
  '  "titular_principal": { "id": <n>, "bajada": "<~30 palabras>" },',
  '  "secciones": [',
  '    { "id": "chile",     "articulos": [ { "id": <n>, "bajada": "<~30p>", "relevancia": <1-5> } ] },',
  '    { "id": "politica",  "articulos": [ { "id": <n>, "bajada": "<~30p>", "relevancia": <1-5> } ] },',
  '    { "id": "delictual", "articulos": [ { "id": <n>, "bajada": "<~30p>", "relevancia": <1-5> } ] }',
  '  ],',
  '  "boletin": {',
  '    "clientes_afectados": [',
  '      { "id": <n>, "cliente": "<roster>", "industria": "<roster>", "tipo_amenaza": "<...>",',
  '        "impacto": "<1 frase>", "oportunidad_comercial": "<servicio ALTO>", "relevancia": <1-5> }',
  '    ],',
  '    "nuevos_modus_operandi": [ { "id": <n>, "descripcion": "<1-2 frases>" } ],',
  '    "riesgo_por_industria": [ { "industria": "<nombre>", "nivel": "<Alto|Medio|Bajo>", "motivo": "<breve>" } ]',
  '  }',
  '}',
  'Las 3 secciones del diario deben estar presentes aunque "articulos" sea []. Si no hay',
  'clientes afectados, "clientes_afectados" puede ser [].'
].join('\n');

/** Mensaje de usuario: fecha + roster + lista numerada (sin urls). */
function construirPromptUsuario_(articulos, roster) {
  var hoy = Utilities.formatDate(new Date(), 'America/Santiago', 'yyyy-MM-dd');
  var lineas = ['Fecha de la edición: ' + hoy, ''];

  lineas.push('ROSTER DE CLIENTES (cliente — industria — alias):');
  for (var r = 0; r < roster.length; r++) {
    var cl = roster[r];
    lineas.push('  - ' + cl.nombre + ' — ' + cl.industria + (cl.alias ? (' — ' + cl.alias) : ''));
  }
  lineas.push('');

  lineas.push('TITULARES:');
  for (var i = 0; i < articulos.length; i++) {
    var art = articulos[i];
    var origen = art.seccion || 'general';
    if (art.seccion === 'clientes' && art.industria) origen = 'clientes/' + art.industria;
    lineas.push('[' + (i + 1) + '] (' + art.fuente + ' · ' + origen + ') ' + art.titular);
  }
  return lineas.join('\n');
}

// ---------- Llamada a la API --------------------------------------------

function llamarClaude_(apiKey, sistema, usuario) {
  var payload = {
    model: CLAUDE_MODELO,
    max_tokens: CLAUDE_MAX_TOKENS,
    system: sistema,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: usuario }]
  };

  var resp;
  try {
    resp = UrlFetchApp.fetch(CLAUDE_ENDPOINT, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-api-key': apiKey, 'anthropic-version': CLAUDE_VERSION },
      payload: JSON.stringify(payload)
    });
  } catch (e) {
    Logger.log('✗ Falló el fetch a Anthropic: %s', e.message);
    return null;
  }

  var codigo = resp.getResponseCode();
  var cuerpo = resp.getContentText();
  if (codigo !== 200) { Logger.log('✗ Anthropic HTTP %s: %s', codigo, cuerpo.slice(0, 500)); return null; }

  var data;
  try { data = JSON.parse(cuerpo); }
  catch (e) { Logger.log('✗ Respuesta no es JSON: %s', e.message); return null; }

  if (!data.content || !data.content.length) {
    Logger.log('✗ Sin content. stop_reason: %s', data.stop_reason); return null;
  }
  for (var i = 0; i < data.content.length; i++) {
    if (data.content[i].type === 'text') return data.content[i].text;
  }
  Logger.log('✗ Sin bloque de texto. stop_reason: %s', data.stop_reason);
  return null;
}

// ---------- Parseo y expansión ------------------------------------------

function parsearJsonDefensivo_(texto) {
  var t = String(texto).trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  var ini = t.indexOf('{'), fin = t.lastIndexOf('}');
  if (ini === -1 || fin === -1 || fin < ini) return null;
  try { return JSON.parse(t.slice(ini, fin + 1)); }
  catch (e) { Logger.log('  (parse) %s', e.message); return null; }
}

/** Expande la selección (ids + editorial) al contrato completo. */
function expandirAContrato_(seleccion, articulos) {
  var hoy = Utilities.formatDate(new Date(), 'America/Santiago', 'yyyy-MM-dd');

  function base(id) {
    var idx = parseInt(id, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= articulos.length) return null;
    var f = articulos[idx];
    if (!f.url) return null;   // regla dura
    return { titular: f.titular, fuente: f.fuente, url: f.url, fecha: fechaIso_(f.fecha) || hoy };
  }

  // Titular principal (con fallback).
  var tpBase = (seleccion.titular_principal && base(seleccion.titular_principal.id)) || base(1);
  var titularPrincipal = tpBase
    ? { titular: tpBase.titular, fuente: tpBase.fuente, url: tpBase.url, fecha: tpBase.fecha,
        bajada: limpiar_((seleccion.titular_principal && seleccion.titular_principal.bajada) || '') }
    : { titular: '', fuente: '', url: '', fecha: '', bajada: '' };

  // Secciones del diario.
  var porId = {};
  (seleccion.secciones || []).forEach(function (s) { porId[s.id] = s; });
  var secciones = SECCIONES.map(function (def) {
    var entrada = porId[def.id] || { articulos: [] };
    var arts = (entrada.articulos || []).map(function (it) {
      var b = base(it.id);
      if (!b) return null;
      b.bajada = limpiar_(it.bajada || '');
      b.relevancia = acotarRelevancia_(it.relevancia);
      return b;
    }).filter(Boolean);
    arts.sort(function (x, y) { return y.relevancia - x.relevancia; });
    return { id: def.id, titulo: def.titulo, articulos: arts };
  });

  // Boletín.
  var bol = seleccion.boletin || {};
  var clientesAfectados = (bol.clientes_afectados || []).map(function (it) {
    var b = base(it.id);
    if (!b || !it.cliente) return null;
    b.cliente = limpiar_(it.cliente);
    b.industria = limpiar_(it.industria || '');
    b.tipo_amenaza = limpiar_(it.tipo_amenaza || '');
    b.impacto = limpiar_(it.impacto || '');
    b.oportunidad_comercial = limpiar_(it.oportunidad_comercial || '');
    b.relevancia = acotarRelevancia_(it.relevancia);
    return b;
  }).filter(Boolean).sort(function (x, y) { return y.relevancia - x.relevancia; });

  var modusOperandi = (bol.nuevos_modus_operandi || []).map(function (it) {
    var b = base(it.id);
    if (!b) return null;
    b.descripcion = limpiar_(it.descripcion || '');
    return b;
  }).filter(Boolean);

  var riesgo = (bol.riesgo_por_industria || []).map(function (it) {
    return { industria: limpiar_(it.industria || ''), nivel: limpiar_(it.nivel || ''),
             motivo: limpiar_(it.motivo || '') };
  }).filter(function (x) { return x.industria; });

  return {
    fecha: hoy,
    titular_principal: titularPrincipal,
    secciones: secciones,
    boletin: {
      clientes_afectados: clientesAfectados,
      nuevos_modus_operandi: modusOperandi,
      riesgo_por_industria: riesgo
    }
  };
}

// ---------- Utilidades ---------------------------------------------------

function acotarRelevancia_(v) {
  var n = parseInt(v, 10);
  return isNaN(n) ? 3 : Math.max(1, Math.min(5, n));
}

function fechaIso_(texto) {
  if (!texto) return '';
  var d = new Date(texto);
  return isNaN(d.getTime()) ? '' : Utilities.formatDate(d, 'America/Santiago', 'yyyy-MM-dd');
}

// limpiar_() se define en Fuentes.gs (scope global compartido en Apps Script).
