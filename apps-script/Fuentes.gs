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
// Precisión de clientes: Google News matchea el cliente en el CUERPO, no solo en el
// titular, y a Claude solo le pasamos el titular → atribuciones de notas donde el
// cliente no es el protagonista. Con esto en true, descartamos toda nota 'clientes'
// cuyo TITULAR no nombre al cliente (o un alias). Poné false para volver al modo laxo.
var EXIGIR_CLIENTE_EN_TITULAR = true;
// Geografía: la sección "nuestros clientes" SOLO debe traer incidentes ocurridos EN CHILE.
// Descarta notas de clientes cuyo TITULAR menciona un país o ciudad extranjera (= lugar del
// hecho). A propósito NO incluye gentilicios (ej. "venezolana", "peruano"): un delito EN
// CHILE cometido por una banda extranjera sigue siendo chileno y debe quedar. Lista editable;
// se compara sin acentos y por palabra completa. Poné false para desactivar el backstop.
var SOLO_CLIENTES_CHILE = true;
var LUGARES_EXTRANJEROS = [
  // Países
  'peru', 'mexico', 'colombia', 'argentina', 'bolivia', 'ecuador', 'paraguay',
  'uruguay', 'venezuela', 'brasil', 'brazil', 'espana', 'estados unidos', 'eeuu',
  // Ciudades extranjeras de bajo riesgo de colisión (evito p.ej. "La Paz", "Mendoza",
  // "Madrid" porque chocan con calles/apellidos chilenos)
  'lima', 'cdmx', 'ciudad de mexico', 'guadalajara', 'monterrey', 'bogota', 'medellin',
  'quito', 'guayaquil', 'buenos aires', 'asuncion', 'montevideo', 'caracas', 'sao paulo'
];
var DIAS_DELICTUAL = 2;
var DIAS_TENDENCIA = 2;
var DIAS_CLIENTES  = 2;
// Filtro de recencia duro: descarta toda nota cuya fecha de publicación sea más
// vieja que esto (el when: de Google News no es estricto y deja pasar antiguas).
// Medido en HORAS desde el momento de la corrida, para que sea exactamente 48 h.
var MAX_HORAS_ANTIGUEDAD = 48;

// Sección "ALTO en la Prensa": menciones de Grupo ALTO. Dos queries que se complementan:
// (1) PRECISA — frases/nombres distintivos que por sí solos identifican a la empresa.
// Nazer/Kassis: apellidos distintivos, van con nombre+apellido. Varela/Hernández son nombres
// comunes → uso el PAR de apellidos ("Varela Anabalón", "Hernández Palma"), distintivo y robusto
// a variaciones de nombre. Las formas cortas ("Rodrigo Varela"/"Eduardo Hernández") quedan en la
// query ANCLADA (solo junto a "ALTO") para no traer homónimos.
var QUERY_ALTO = '("Grupo ALTO" OR "ALTO S.A." OR "ALTO Chile" OR "ALTO Inmune" OR "fiscalía privada" OR "Jorge Nazer" OR "Ángeles Kassis" OR "Varela Anabalón" OR "Hernández Palma")';
// (2) ANCLADA — la palabra ALTO emparejada con una señal fuerte de la empresa. Los voceros
// de nombre común (Eduardo Hernández, Rodrigo Varela) y PUCV (su socio de estudios) solo se
// usan JUNTO a "ALTO", para no traer "alto" como palabra suelta. Captura casos como el
// estudio "ALTO-PUCV..." que la query precisa no trae. La IA filtra falsos positivos.
var QUERY_ALTO_ANCLADA = 'ALTO ("Eduardo Hernández" OR "Rodrigo Varela" OR PUCV OR "prevención de pérdidas" OR "prevención del delito")';
var DIAS_ALTO = 2;
// Bing News como 2º índice para "ALTO en la Prensa": pesca menciones que Google News no
// rankea o no trae. Bing NO soporta when:Nd → la recencia la impone esReciente_ (48h).
// OJO: tampoco alcanza contenido de PAGO/impreso (igual que Google News). Poné false p/desactivar.
var ALTO_BING_ACTIVO = true;
// Ingesta por correo para "ALTO en la Prensa" (Google Alerts / alerta El Mercurio / clipping
// / reenvíos). Lee la etiqueta de Gmail definida en CorreoAlto.gs. Poné false p/desactivar.
var CORREO_ALTO_ACTIVO = true;
// Búsqueda web (Google Programmable Search) para "ALTO en la Prensa": pesca rebotes libres
// que News/Bing no indexan. DESACTIVADO: Google ya no permite habilitar "buscar en toda la
// web" en motores nuevos, y Google Alerts (que llega por correo vía CorreoAlto.gs) cubre el
// mismo caso. Para usarlo igual (restringido a dominios): poné true + GOOGLE_CSE_KEY/CX.
var CSE_ALTO_ACTIVO = false;

// ── Medios prioritarios (paywall, titulares públicos) ──────────────────────
// El cliente pidió sumar El Mercurio/Emol, La Tercera y DF a TODAS las secciones.
// El ARTÍCULO completo es de pago, pero los TITULARES son públicos y están indexados
// en Google News — que es justo lo que consume el boletín. NO requiere login.
// Para garantizar su presencia (una búsqueda amplia no siempre los rankea arriba),
// por cada sección lanzamos queries "espejo" restringidas a estos dominios con el
// operador site:. El dedup posterior (por URL y por titular) funde lo que ya hayan
// traído las queries amplias, así que no se duplican notas.
// Login automático de pago: solo El Mercurio es viable (formulario ASP.NET) y está en
// MercurioLogin.gs como experimento aparte. La Tercera (Piano) y DF (SPA) usan auth por
// JavaScript que UrlFetchApp no puede ejecutar → solo cobertura pública.
// Poné MEDIOS_PRIORITARIOS_ACTIVO = false para desactivar todo el bloque.
var MEDIOS_PRIORITARIOS_ACTIVO = true;
var MEDIOS_PRIORITARIOS = [
  { etiqueta: 'El Mercurio', dominios: ['emol.com', 'elmercurio.com'] },
  { etiqueta: 'La Tercera',  dominios: ['latercera.com'] },
  { etiqueta: 'DF',          dominios: ['df.cl'] }
];
var DIAS_PRIORITARIO = 2; // ventana de la query "general" (lo último de cada medio)
// Anclas temáticas para la query "general" de medios prioritarios: en vez de traer el
// feed COMPLETO del medio (deporte, tecnología, farándula), lo acota a lo relevante para
// el brief (Chile/política/economía/seguridad). Poné '' para volver al feed completo.
var TERMINOS_GENERAL_PRIORITARIO =
  'economía OR negocios OR empresas OR política OR gobierno OR seguridad OR ' +
  'delincuencia OR delito OR fraude OR justicia OR fiscalía OR mercado';

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

  // Conteo por medio prioritario (por nombre de fuente del feed) — confirma que los
  // tres entran al corpus, sobre todo El Mercurio/Emol.
  var patronesMedio = [
    { etiqueta: 'El Mercurio/Emol', re: /emol|mercurio/i },
    { etiqueta: 'La Tercera',       re: /tercera/i },
    { etiqueta: 'DF',               re: /financiero|\bdf\b/i }
  ];
  var conteoMedios = {};
  patronesMedio.forEach(function (p) { conteoMedios[p.etiqueta] = 0; });
  for (var m = 0; m < articulos.length; m++) {
    var f = articulos[m].fuente || '';
    patronesMedio.forEach(function (p) { if (p.re.test(f)) conteoMedios[p.etiqueta]++; });
  }
  Logger.log('Medios prioritarios (por fuente): %s', JSON.stringify(conteoMedios));

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

  // Ingesta por correo (sección 'alto'): se suma ANTES del dedup para fundir solapamientos
  // con Google News / Bing. Falla suave si no hay etiqueta/permiso de Gmail.
  if (CORREO_ALTO_ACTIVO) {
    var deCorreo = recolectarCorreoAlto_();
    if (deCorreo.length) {
      Logger.log('  + %s titulares desde correo (sección alto)', deCorreo.length);
      todos = todos.concat(deCorreo);
    }
  }

  // Búsqueda web (CSE): rebotes libres de menciones de ALTO que News/Bing no indexan.
  if (CSE_ALTO_ACTIVO) {
    var deCSE = recolectarCSEAlto_();
    if (deCSE.length) {
      Logger.log('  + %s titulares desde búsqueda web (sección alto)', deCSE.length);
      todos = todos.concat(deCSE);
    }
  }

  var unicos = deduplicar_(todos);
  Logger.log('Ítems %s → únicos %s (−%s dup)', todos.length, unicos.length, todos.length - unicos.length);
  return unicos;
}

// ---------- Lectura del Sheet -------------------------------------------

/** @return {Array<{url,etiqueta,seccion,industria,cliente}>} */
function leerFuentesDelSheet_() {
  var ss = abrirSheet_();
  if (!ss) return [];

  var specs = [];
  var terminosDelictual = [];   // se reúsan para las queries "espejo" de medios prioritarios
  var terminosTendencia = [];

  // 1) Prensa general (sección Chile/política): la URL se usa tal cual.
  recorrerHoja_(ss, 'FuentesGenerales', function (fila) {
    var url = String(fila[1] || '').trim();
    if (url) specs.push({ url: url, etiqueta: String(fila[0] || 'General').trim(),
                          seccion: 'general', industria: '', cliente: '' });
  });

  // 2) Temas delictuales (sección delictual pública): query when:2d.
  recorrerHoja_(ss, 'TemasDelictuales', function (fila) {
    var t = String(fila[1] || '').trim();
    if (t) {
      terminosDelictual.push(t);
      specs.push({ url: urlGoogleNews_(t, DIAS_DELICTUAL), etiqueta: String(fila[0] || 'Delictual').trim(),
                   seccion: 'delictual', industria: '', cliente: '' });
    }
  });

  // 3) Tendencias / nuevos modus operandi (sin cliente): query when:2d.
  recorrerHoja_(ss, 'Tendencias', function (fila) {
    var t = orTerminos_(fila[1]);
    if (t) {
      terminosTendencia.push(t);
      specs.push({ url: urlGoogleNews_(t, DIAS_TENDENCIA), etiqueta: String(fila[0] || 'Tendencia').trim(),
                   seccion: 'tendencia', industria: '', cliente: '' });
    }
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
      // terminosCliente: el chunk sin comillas, para filtrar por presencia en el titular.
      var terminosCliente = chunk.map(function (t) { return t.replace(/"/g, '').trim(); });
      specs.push({ url: urlGoogleNews_(q, DIAS_CLIENTES), etiqueta: ind,
                   seccion: 'clientes', industria: ind, cliente: '',
                   terminosCliente: terminosCliente });
    }
  });

  // 6) ALTO en la prensa: menciones de Grupo ALTO. Dos queries (precisa + anclada); el
  //    dedup por URL fusiona el solapamiento. La IA filtra falsos positivos.
  specs.push({ url: urlGoogleNews_(QUERY_ALTO, DIAS_ALTO), etiqueta: 'ALTO',
               seccion: 'alto', industria: '', cliente: '' });
  specs.push({ url: urlGoogleNews_(QUERY_ALTO_ANCLADA, DIAS_ALTO), etiqueta: 'ALTO',
               seccion: 'alto', industria: '', cliente: '' });
  // Bing News como 2º índice (solo query precisa; el dedup funde el solapamiento con Google).
  if (ALTO_BING_ACTIVO) {
    specs.push({ url: urlBingNews_(QUERY_ALTO), etiqueta: 'ALTO',
                 seccion: 'alto', industria: '', cliente: '' });
  }

  // 7) Medios prioritarios: queries "espejo" con site: para asegurar que El Mercurio,
  //    La Tercera y DF aparezcan en TODAS las secciones (titulares públicos, sin login).
  //    El dedup por URL/titular funde lo que ya hayan traído las queries amplias.
  if (MEDIOS_PRIORITARIOS_ACTIVO) {
    var sitios = clausulaSitiosPrioritarios_();   // (site:emol.com OR site:latercera.com OR …)

    // a) General: lo relevante de cada medio (una query por medio para conservar su
    //    etiqueta). Anclada a TERMINOS_GENERAL_PRIORITARIO para no traer el feed completo.
    var anclaGeneral = TERMINOS_GENERAL_PRIORITARIO
      ? '(' + TERMINOS_GENERAL_PRIORITARIO + ') ' : '';
    MEDIOS_PRIORITARIOS.forEach(function (m) {
      var soloEste = '(' + m.dominios.map(function (d) { return 'site:' + d; }).join(' OR ') + ')';
      specs.push({ url: urlGoogleNews_(anclaGeneral + soloEste, DIAS_PRIORITARIO), etiqueta: m.etiqueta,
                   seccion: 'general', industria: '', cliente: '' });
    });

    // b) Delictual: todos los temas en UNA query espejo restringida a los medios.
    //    (Si TemasDelictuales crece mucho, esta única query podría requerir chunking.)
    if (terminosDelictual.length) {
      var qDel = '(' + terminosDelictual.map(parentizar_).join(' OR ') + ') ' + sitios;
      specs.push({ url: urlGoogleNews_(qDel, DIAS_DELICTUAL), etiqueta: 'Delictual · medios',
                   seccion: 'delictual', industria: '', cliente: '' });
    }

    // c) Tendencias: ídem.
    if (terminosTendencia.length) {
      var qTen = '(' + terminosTendencia.map(parentizar_).join(' OR ') + ') ' + sitios;
      specs.push({ url: urlGoogleNews_(qTen, DIAS_TENDENCIA), etiqueta: 'Tendencia · medios',
                   seccion: 'tendencia', industria: '', cliente: '' });
    }

    // d) Clientes: una query espejo por industria (clientes × amenaza × medios), chunkeada
    //    igual que las normales y conservando los filtros de precisión (cliente en titular,
    //    solo Chile) vía terminosCliente.
    Object.keys(clientesPorInd).forEach(function (ind) {
      var amenaza = amenazasPorInd[ind];
      if (!amenaza) return;
      var terms = clientesPorInd[ind];
      for (var c = 0; c < terms.length; c += CLIENTES_POR_QUERY) {
        var chunk = terms.slice(c, c + CLIENTES_POR_QUERY);
        var q = '(' + chunk.join(' OR ') + ') ' + amenaza + ' ' + sitios;
        var terminosCliente = chunk.map(function (t) { return t.replace(/"/g, '').trim(); });
        specs.push({ url: urlGoogleNews_(q, DIAS_CLIENTES), etiqueta: ind + ' · medios',
                     seccion: 'clientes', industria: ind, cliente: '',
                     terminosCliente: terminosCliente });
      }
    });
  }

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

/** '(site:emol.com OR site:elmercurio.com OR site:latercera.com OR site:df.cl)' de MEDIOS_PRIORITARIOS. */
function clausulaSitiosPrioritarios_() {
  var sitios = [];
  MEDIOS_PRIORITARIOS.forEach(function (m) {
    m.dominios.forEach(function (d) { sitios.push('site:' + d); });
  });
  return sitios.length ? '(' + sitios.join(' OR ') + ')' : '';
}

/** Envuelve una expresión de términos en paréntesis si aún no lo está. */
function parentizar_(s) {
  s = String(s || '').trim();
  return /^\(.*\)$/.test(s) ? s : '(' + s + ')';
}

/** URL de búsqueda de Google News RSS (CL, español) con when:Nd. */
function urlGoogleNews_(query, dias) {
  return 'https://news.google.com/rss/search?q=' +
         encodeURIComponent(query + ' when:' + dias + 'd') +
         '&hl=es-419&gl=CL&ceid=CL:es';
}

/** URL de búsqueda de Bing News RSS (mercado es-CL). Bing no soporta ventana temporal
 *  nativa; la recencia la impone esReciente_ (48h). format=rss en minúscula (es sensible). */
function urlBingNews_(query) {
  return 'https://www.bing.com/news/search?q=' + encodeURIComponent(query) +
         '&format=rss&setmkt=es-CL';
}

// ---------- Parseo y dedup ----------------------------------------------

function parsearRespuesta_(resp, spec) {
  if (!resp || resp.getResponseCode() !== 200) return [];
  var raiz;
  try { raiz = XmlService.parse(resp.getContentText()).getRootElement(); }
  catch (e) { return []; }

  var canal = raiz.getChild('channel');
  var items = canal ? canal.getChildren('item') : raiz.getChildren('entry');

  var exigirTitular = EXIGIR_CLIENTE_EN_TITULAR && spec.seccion === 'clientes' &&
                      spec.terminosCliente && spec.terminosCliente.length;

  var articulos = [];
  for (var i = 0; i < items.length; i++) {
    var art = parsearItem_(items[i], { etiqueta: spec.etiqueta });
    if (!art || !esReciente_(art.fecha)) continue;
    // Filtro de precisión: la nota de cliente debe nombrarlo en el TITULAR.
    if (exigirTitular && !tituloMencionaCliente_(art.titular, spec.terminosCliente)) continue;
    // Filtro geográfico: solo incidentes de clientes ocurridos en Chile.
    if (SOLO_CLIENTES_CHILE && spec.seccion === 'clientes' && mencionaLugarExtranjero_(art.titular)) continue;
    art.seccion = spec.seccion;
    art.industria = spec.industria;
    art.cliente = spec.cliente;
    articulos.push(art);
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

/**
 * Deduplica por URL Y por clave de titular. El dedup por titular es necesario porque los
 * agregadores devuelven URLs de redirección distintas para el MISMO artículo (las dos
 * queries de ALTO, o Google News vs Bing, traen la misma nota con URLs distintas). La clave
 * de titular además ignora el sufijo de fuente ("Titular - El Mercurio" vs "Titular" de
 * Bing) para que esos dupes colapsen. Se queda con la primera aparición.
 * Nota: la dedup de "misma noticia en distintos medios con titulares distintos" la hace
 * Claude en la curación (ver PROMPT_SISTEMA), porque acá no hay forma de detectarla por texto.
 */
function deduplicar_(articulos) {
  var vistosUrl = {}, vistosTit = {}, unicos = [];
  for (var i = 0; i < articulos.length; i++) {
    var a = articulos[i];
    var claveUrl = normalizarUrl_(a.url);
    var claveTit = claveTitulo_(a);
    if (vistosUrl[claveUrl] || (claveTit && vistosTit[claveTit])) continue;
    vistosUrl[claveUrl] = true;
    if (claveTit) vistosTit[claveTit] = true;
    unicos.push(a);
  }
  return unicos;
}

// ---------- Utilidades ---------------------------------------------------

function textoHijo_(elem, nombre) {
  var hijo = elem.getChild(nombre);
  return hijo ? hijo.getText() : '';
}

/**
 * true si el titular nombra a alguno de los términos del cliente (nombre/alias).
 * Compara sin acentos y con límite de palabra para no matchear subcadenas
 * (ej.: "BCI" no debe gatillar dentro de otra palabra). Multipalabra ("Mall Plaza") OK.
 */
function tituloMencionaCliente_(titular, terminos) {
  var t = normalizarTexto_(titular);
  for (var i = 0; i < terminos.length; i++) {
    var term = normalizarTexto_(terminos[i]);
    if (!term) continue;
    var re = new RegExp('(^|[^a-z0-9])' + escaparRegex_(term) + '([^a-z0-9]|$)');
    if (re.test(t)) return true;
  }
  return false;
}
/** true si el texto menciona un país/ciudad extranjera de LUGARES_EXTRANJEROS. */
function mencionaLugarExtranjero_(texto) {
  return tituloMencionaCliente_(texto, LUGARES_EXTRANJEROS);
}

/** minúsculas + sin diacríticos (NFD); deja solo a-z0-9 como letras. */
function normalizarTexto_(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function escaparRegex_(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function normalizarUrl_(url) {
  return String(url).trim().toLowerCase().replace(/\/+$/, '');
}
/**
 * Clave de dedup por titular: minúsculas, sin acentos, espacios colapsados y SIN el sufijo
 * de atribución que Google News anexa al final ("Titular - El Mercurio"). Así el MISMO
 * artículo vía Google News (con sufijo) y vía Bing (sin sufijo, su título no lo trae) colapsa
 * en una sola clave. Se quita SOLO la fuente exacta del ítem (segura): no se hace un quite
 * genérico de "lo que sigue al último guion", para no fusionar artículos realmente distintos
 * cuyo titular contenga un guion.
 */
function claveTitulo_(art) {
  var t = normalizarTexto_(String(art.titular || '')).replace(/\s+/g, ' ').trim();
  var fuente = normalizarTexto_(String(art.fuente || '')).trim();
  if (fuente) t = t.replace(new RegExp('\\s[-|]\\s' + escaparRegex_(fuente) + '$'), '').trim();
  return t;
}
function limpiar_(texto) {
  return String(texto).replace(/\s+/g, ' ').trim();
}
