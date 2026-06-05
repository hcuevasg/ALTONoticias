/**
 * Claude.gs — Fase 2
 * Arma el prompt, llama UNA vez a la API de Anthropic y devuelve el objeto JSON
 * de la edición, validado de forma defensiva contra el contrato (esquema/contrato.json).
 *
 * Diseño anti-alucinación (regla dura "todo artículo DEBE tener url real"):
 * al modelo se le pasan los titulares NUMERADOS y SIN url. El modelo referencia
 * cada artículo solo por su `id` y aporta únicamente lo editorial (bajada,
 * relevancia, cliente). Acá resolvemos id → {titular, fuente, url, fecha} reales
 * desde la lista que ya tenemos. Así el modelo no puede inventar ni alterar una URL.
 *
 * Verificación: setear ANTHROPIC_API_KEY en Propiedades del Script y ejecutar
 * testClaude(). Debe loguear un JSON parseable y conforme al contrato.
 */

var CLAUDE_ENDPOINT = 'https://api.anthropic.com/v1/messages';
var CLAUDE_MODELO   = 'claude-sonnet-4-6';   // Sonnet vigente (rotan; confirmado en docs)
var CLAUDE_VERSION  = '2023-06-01';          // header anthropic-version
var CLAUDE_MAX_TOKENS = 8000;                // holgado para ~30 artículos; sin streaming

// Secciones fijas del diario (orden e ids del contrato).
var SECCIONES = [
  { id: 'chile',     titulo: 'Chile en los últimos días' },
  { id: 'politica',  titulo: 'Política — Chile y el mundo' },
  { id: 'delictual', titulo: 'Tendencias delictuales' },
  { id: 'clientes',  titulo: 'Monitoreo de clientes' }
];

/**
 * Punto de entrada de verificación de la Fase 2.
 * Recolecta titulares (Fase 1), genera la edición con Claude y la loguea.
 */
function testClaude() {
  Logger.log('=== Fase 2 · prueba de generación con Claude ===');

  var articulos = recolectarTitulares();   // de Fuentes.gs
  if (!articulos.length) {
    Logger.log('✗ No hay titulares; revisá Fase 1 antes de seguir.');
    return;
  }
  Logger.log('Titulares de entrada: %s', articulos.length);

  var edicion = generarEdicion(articulos);
  if (!edicion) {
    Logger.log('✗ No se pudo generar una edición válida.');
    return;
  }

  // Resumen verificable.
  Logger.log('✓ JSON válido. Fecha: %s', edicion.fecha);
  Logger.log('★ Titular principal [%s]: %s', edicion.titular_principal.fuente,
             edicion.titular_principal.titular);
  Logger.log('   %s', edicion.titular_principal.url);
  for (var s = 0; s < edicion.secciones.length; s++) {
    var sec = edicion.secciones[s];
    Logger.log('— %s (%s): %s artículos', sec.titulo, sec.id, sec.articulos.length);
    for (var a = 0; a < Math.min(sec.articulos.length, 3); a++) {
      var art = sec.articulos[a];
      Logger.log('    • [rel %s] %s — %s', art.relevancia, art.titular, art.fuente);
    }
  }
}

/**
 * Orquesta una llamada al modelo y devuelve el contrato completo de la edición.
 * @param {Array<Object>} articulos  Salida de recolectarTitulares() (Fase 1).
 * @return {Object|null} objeto conforme a esquema/contrato.json, o null si falla.
 */
function generarEdicion(articulos) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) {
    Logger.log('✗ Falta ANTHROPIC_API_KEY en Propiedades del Script.');
    return null;
  }

  var promptUsuario = construirPromptUsuario_(articulos);
  var textoModelo = llamarClaude_(apiKey, PROMPT_SISTEMA, promptUsuario);
  if (!textoModelo) return null;

  var seleccion = parsearJsonDefensivo_(textoModelo);
  if (!seleccion) {
    Logger.log('✗ La respuesta del modelo no fue JSON parseable.');
    return null;
  }

  return expandirAContrato_(seleccion, articulos);
}

// ---------- Prompt -------------------------------------------------------

var PROMPT_SISTEMA = [
  'Sos analista de inteligencia de prensa para Chile. Armás el "diario" diario de ALTO.',
  'Te paso una lista NUMERADA de titulares reales de hoy, cada uno con su id, fuente y etiqueta de origen.',
  '',
  'Tarea: curá los más relevantes y distribuilos en 4 secciones fijas:',
  '  - chile: Chile en los últimos días',
  '  - politica: Política — Chile y el mundo',
  '  - delictual: Tendencias delictuales (robos, portonazos, encerronas, crimen organizado, prevención)',
  '  - clientes: Monitoreo de clientes',
  'Elegí UN titular principal: la noticia más importante del día.',
  '',
  'Para cada artículo seleccionado:',
  '  - Escribí una "bajada" de ~30 palabras en español (2-3 frases, informativa y neutral).',
  '  - Asigná "relevancia" entera de 1 a 5 (5 = más relevante).',
  'Referenciá cada artículo SOLO por su número de id. NO inventes ids ni artículos.',
  'NO copies el titular ni la fuente: los completamos nosotros a partir del id.',
  'Descartá ruido (farándula, publicidad, deportes triviales) salvo que sea muy relevante.',
  'En esta prueba la sección "clientes" puede quedar vacía (articulos: []); está bien.',
  'Ordená cada sección por relevancia descendente.',
  '',
  'Devolvé EXCLUSIVAMENTE un objeto JSON con esta forma EXACTA, sin texto adicional,',
  'sin explicaciones y SIN fences de markdown:',
  '{',
  '  "titular_principal": { "id": <n>, "bajada": "<texto>" },',
  '  "secciones": [',
  '    { "id": "chile",     "articulos": [ { "id": <n>, "bajada": "<texto>", "relevancia": <1-5> } ] },',
  '    { "id": "politica",  "articulos": [ { "id": <n>, "bajada": "<texto>", "relevancia": <1-5> } ] },',
  '    { "id": "delictual", "articulos": [ { "id": <n>, "bajada": "<texto>", "relevancia": <1-5> } ] },',
  '    { "id": "clientes",  "articulos": [ { "id": <n>, "bajada": "<texto>", "relevancia": <1-5>, "cliente": "<nombre>" } ] }',
  '  ]',
  '}',
  'Las 4 secciones deben estar presentes aunque "articulos" sea [].'
].join('\n');

/** Construye el mensaje de usuario: fecha + lista numerada (sin urls). */
function construirPromptUsuario_(articulos) {
  var hoy = Utilities.formatDate(new Date(), 'America/Santiago', 'yyyy-MM-dd');
  var lineas = ['Fecha de la edición: ' + hoy, '', 'Titulares disponibles:'];
  for (var i = 0; i < articulos.length; i++) {
    var art = articulos[i];
    lineas.push('[' + (i + 1) + '] (' + art.fuente + ' · ' + art.etiqueta + ') ' + art.titular);
  }
  return lineas.join('\n');
}

// ---------- Llamada a la API --------------------------------------------

/**
 * Una sola llamada a /v1/messages. Devuelve el texto del modelo o null.
 * Sin prompt caching: la ejecución es diaria y el TTL del cache (5 min/1 h)
 * siempre estaría frío, así que cachear solo sumaría costo de escritura.
 */
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
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': CLAUDE_VERSION
      },
      payload: JSON.stringify(payload)
    });
  } catch (e) {
    Logger.log('✗ Falló el fetch a Anthropic: %s', e.message);
    return null;
  }

  var codigo = resp.getResponseCode();
  var cuerpo = resp.getContentText();
  if (codigo !== 200) {
    Logger.log('✗ Anthropic HTTP %s: %s', codigo, cuerpo.slice(0, 500));
    return null;
  }

  var data;
  try {
    data = JSON.parse(cuerpo);
  } catch (e) {
    Logger.log('✗ Respuesta de Anthropic no es JSON: %s', e.message);
    return null;
  }

  // El texto está en el primer bloque de tipo "text".
  if (!data.content || !data.content.length) {
    Logger.log('✗ Respuesta sin content. stop_reason: %s', data.stop_reason);
    return null;
  }
  for (var i = 0; i < data.content.length; i++) {
    if (data.content[i].type === 'text') return data.content[i].text;
  }
  Logger.log('✗ No vino bloque de texto. stop_reason: %s', data.stop_reason);
  return null;
}

// ---------- Parseo y expansión ------------------------------------------

/** Parseo defensivo: quita fences, aísla el objeto {...} y JSON.parse en try/catch. */
function parsearJsonDefensivo_(texto) {
  var t = String(texto).trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();   // fences
  var ini = t.indexOf('{');
  var fin = t.lastIndexOf('}');
  if (ini === -1 || fin === -1 || fin < ini) return null;
  t = t.slice(ini, fin + 1);
  try {
    return JSON.parse(t);
  } catch (e) {
    Logger.log('  (parse) %s', e.message);
    return null;
  }
}

/**
 * Expande la selección del modelo (ids + editorial) al contrato completo,
 * resolviendo cada id contra la lista real. Descarta ids inválidos o sin url.
 */
function expandirAContrato_(seleccion, articulos) {
  var hoy = Utilities.formatDate(new Date(), 'America/Santiago', 'yyyy-MM-dd');

  function resolver(item, esCliente) {
    var idx = parseInt(item && item.id, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= articulos.length) return null;
    var fuente = articulos[idx];
    if (!fuente.url) return null;   // regla dura: sin url se descarta
    var art = {
      titular: fuente.titular,
      fuente: fuente.fuente,
      url: fuente.url,
      fecha: fechaIso_(fuente.fecha) || hoy,
      bajada: limpiar_(item.bajada || ''),
      relevancia: acotarRelevancia_(item.relevancia)
    };
    if (esCliente && item.cliente) art.cliente = limpiar_(item.cliente);
    return art;
  }

  // Titular principal (con fallback si el id no resuelve).
  var tp = resolver(seleccion.titular_principal, false);
  if (!tp) {
    Logger.log('  ⚠ titular_principal sin id válido; usando el primer artículo disponible.');
    tp = resolver({ id: 1, bajada: '' }, false);
  }
  var titularPrincipal = tp ? {
    titular: tp.titular, fuente: tp.fuente, url: tp.url, bajada: tp.bajada
  } : { titular: '', fuente: '', url: '', bajada: '' };

  // Secciones: respetamos el orden fijo del contrato.
  var porId = {};
  var secEntrada = (seleccion.secciones || []);
  for (var i = 0; i < secEntrada.length; i++) porId[secEntrada[i].id] = secEntrada[i];

  var secciones = [];
  for (var s = 0; s < SECCIONES.length; s++) {
    var def = SECCIONES[s];
    var entrada = porId[def.id] || { articulos: [] };
    var arts = [];
    var lista = entrada.articulos || [];
    for (var a = 0; a < lista.length; a++) {
      var art = resolver(lista[a], def.id === 'clientes');
      if (art) arts.push(art);
    }
    arts.sort(function (x, y) { return y.relevancia - x.relevancia; });
    secciones.push({ id: def.id, titulo: def.titulo, articulos: arts });
  }

  return { fecha: hoy, titular_principal: titularPrincipal, secciones: secciones };
}

// ---------- Utilidades ---------------------------------------------------

/** Acota la relevancia a un entero 1..5 (default 3 si viene rara). */
function acotarRelevancia_(v) {
  var n = parseInt(v, 10);
  if (isNaN(n)) return 3;
  return Math.max(1, Math.min(5, n));
}

/** Intenta normalizar una fecha de pubDate RSS a ISO yyyy-MM-dd; '' si no puede. */
function fechaIso_(texto) {
  if (!texto) return '';
  var d = new Date(texto);
  if (isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, 'America/Santiago', 'yyyy-MM-dd');
}

// limpiar_() se define en Fuentes.gs (scope global compartido en Apps Script).
