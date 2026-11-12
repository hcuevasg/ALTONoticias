/**
 * GitHub.gs — Fase 4
 * Publica la edición en GitHub Pages vía la API de contenidos de GitHub.
 * Escribe 3 archivos (cada PUT es un commit):
 *   1. docs/index.html               → la edición de HOY (se sobreescribe)
 *   2. docs/ediciones/FECHA.html      → la edición fechada, permanente
 *   3. docs/ediciones/indice.json     → append del manifiesto (dedup por fecha)
 *
 * Secrets en Propiedades del Script: GITHUB_PAT, GITHUB_REPO (ej. "hcuevasg/ALTONoticias").
 *
 * Verificación: ejecutar testPublicar(). Deben aparecer los 3 archivos en el repo
 * y la edición renderizada en https://<usuario>.github.io/<repo>/.
 */

var GITHUB_API    = 'https://api.github.com';
var GITHUB_BRANCH = 'main';
var DOCS_DIR      = 'docs';

// Estado de la última corrida (para los avisos por correo de Codigo.gs).
var ultimoErrorGitHub_  = '';    // último error HTTP de la API, ej. "PUT docs/… → HTTP 401: …"
var patVencimientoRaw_  = null;  // header github-authentication-token-expiration del PAT

/** Detalle del último error de la API, listo para anexar al correo de fallo. */
function detalleErrorGitHub() {
  if (!ultimoErrorGitHub_) return '';
  var pista = ultimoErrorGitHub_.indexOf('HTTP 401') !== -1
    ? '\n\nPista: HTTP 401 suele ser GITHUB_PAT vencido o revocado. Regenerá el token ' +
      '(fine-grained, Contents RW sobre el repo) y actualizá GITHUB_PAT en Propiedades del Script.'
    : '';
  return '\n\nDetalle: ' + ultimoErrorGitHub_ + pista;
}

/** Guarda la expiración del PAT que GitHub devuelve en cada response autenticado. */
function capturarVencimientoPat_(resp) {
  try {
    var headers = resp.getAllHeaders();
    for (var k in headers) {
      if (String(k).toLowerCase() === 'github-authentication-token-expiration') {
        patVencimientoRaw_ = String(headers[k]);
        return;
      }
    }
  } catch (e) { /* best-effort */ }
}

/**
 * Días que le quedan al GITHUB_PAT según el último response de la API.
 * @return {?number} días restantes (0 = vence hoy), o null si no se pudo saber.
 */
function diasRestantesPat() {
  if (!patVencimientoRaw_) return null;
  // Formatos vistos: "2026-08-06 03:00:00 UTC" e ISO "2026-08-06T03:00:00Z".
  var m = String(patVencimientoRaw_).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  var exp = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Math.floor((exp - Date.now()) / 86400000);
}

/**
 * Publica una edición completa. Escribe index.html, la edición fechada y
 * actualiza indice.json. Devuelve un resumen o null si algo falla.
 * @param {Object} edicion      objeto del contrato (para fecha/título/indice).
 * @param {string} htmlEdicion  HTML completo (de renderEdicion()).
 */
function publicarEdicion(edicion, htmlEdicion) {
  ultimoErrorGitHub_ = '';
  var props = PropertiesService.getScriptProperties();
  var pat  = props.getProperty('GITHUB_PAT');
  var repo = props.getProperty('GITHUB_REPO');
  if (!pat || !repo) {
    ultimoErrorGitHub_ = 'Faltan GITHUB_PAT y/o GITHUB_REPO en Propiedades del Script.';
    Logger.log('✗ %s', ultimoErrorGitHub_);
    return null;
  }

  var fecha = edicion.fecha;
  var rutaEdicion = DOCS_DIR + '/ediciones/' + fecha + '.html';
  var rutaIndex   = DOCS_DIR + '/index.html';
  var rutaIndice  = DOCS_DIR + '/ediciones/indice.json';

  // 1) Edición fechada (permanente).
  if (!escribirArchivo_(repo, pat, rutaEdicion, htmlEdicion,
                        'Edición ' + fecha)) return null;
  Logger.log('✓ %s', rutaEdicion);

  // 2) index.html = edición de hoy (sobreescribe).
  if (!escribirArchivo_(repo, pat, rutaIndex, htmlEdicion,
                        'Edición de hoy: ' + fecha)) return null;
  Logger.log('✓ %s', rutaIndex);

  // 3) Append al manifiesto (read-modify-write, dedup por fecha).
  var titulo = (edicion.titular_principal && edicion.titular_principal.titular)
    ? edicion.titular_principal.titular
    : 'Edición del ' + fecha;
  if (!actualizarIndice_(repo, pat, rutaIndice, fecha, titulo)) return null;
  Logger.log('✓ %s (append)', rutaIndice);

  var base = 'https://' + repo.split('/')[0] + '.github.io/' + repo.split('/')[1];
  return {
    hoy:     base + '/',
    edicion: base + '/ediciones/' + fecha + '.html',
    archivo: base + '/archivo.html'
  };
}

/**
 * Lee indice.json, agrega/actualiza la entrada de la fecha y lo reescribe.
 */
function actualizarIndice_(repo, pat, ruta, fecha, titulo) {
  var actual = obtenerArchivo_(repo, pat, ruta);
  var lista = [];
  var sha = null;

  if (actual) {
    sha = actual.sha;
    try {
      lista = JSON.parse(actual.texto) || [];
      if (!Array.isArray(lista)) lista = [];
    } catch (e) {
      Logger.log('  ⚠ indice.json ilegible, se reinicia: %s', e.message);
      lista = [];
    }
  }

  // Dedup por fecha: si ya existe, se actualiza el título; si no, se agrega.
  var entrada = { fecha: fecha, titulo: titulo, archivo: 'ediciones/' + fecha + '.html' };
  var encontrada = false;
  for (var i = 0; i < lista.length; i++) {
    if (lista[i] && lista[i].fecha === fecha) { lista[i] = entrada; encontrada = true; break; }
  }
  if (!encontrada) lista.push(entrada);

  var json = JSON.stringify(lista, null, 2) + '\n';
  return escribirArchivo_(repo, pat, ruta, json, 'Índice: ' + fecha, sha);
}

// ---------- API de GitHub (contenidos) -----------------------------------

/**
 * GET de un archivo. Devuelve {sha, texto} o null si no existe (404).
 */
function obtenerArchivo_(repo, pat, ruta) {
  var url = GITHUB_API + '/repos/' + repo + '/contents/' + codificarRuta_(ruta) +
            '?ref=' + GITHUB_BRANCH;
  var resp = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    headers: cabecerasGitHub_(pat)
  });

  capturarVencimientoPat_(resp);
  var codigo = resp.getResponseCode();
  if (codigo === 404) return null;
  if (codigo !== 200) {
    ultimoErrorGitHub_ = 'GET ' + ruta + ' → HTTP ' + codigo + ': ' + resp.getContentText().slice(0, 300);
    Logger.log('✗ %s', ultimoErrorGitHub_);
    return null;
  }

  var data = JSON.parse(resp.getContentText());
  var base64 = String(data.content || '').replace(/\n/g, '');
  var texto = '';
  if (base64) {
    texto = Utilities.newBlob(Utilities.base64Decode(base64)).getDataAsString('UTF-8');
  }
  return { sha: data.sha, texto: texto };
}

/**
 * PUT (crea o actualiza) un archivo. Si no se pasa sha, lo resuelve solo.
 * @return {boolean} true si HTTP 200/201.
 */
function escribirArchivo_(repo, pat, ruta, contenido, mensaje, sha) {
  // Si no nos dieron sha, averiguar si el archivo ya existe (para actualizar).
  if (sha === undefined) {
    var existente = obtenerArchivo_(repo, pat, ruta);
    sha = existente ? existente.sha : null;
  }

  var payload = {
    message: mensaje,
    content: Utilities.base64Encode(contenido, Utilities.Charset.UTF_8),
    branch: GITHUB_BRANCH
  };
  if (sha) payload.sha = sha;

  var url = GITHUB_API + '/repos/' + repo + '/contents/' + codificarRuta_(ruta);
  var resp = UrlFetchApp.fetch(url, {
    method: 'put',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: cabecerasGitHub_(pat),
    payload: JSON.stringify(payload)
  });

  capturarVencimientoPat_(resp);
  var codigo = resp.getResponseCode();
  if (codigo === 200 || codigo === 201) return true;
  ultimoErrorGitHub_ = 'PUT ' + ruta + ' → HTTP ' + codigo + ': ' + resp.getContentText().slice(0, 400);
  Logger.log('✗ %s', ultimoErrorGitHub_);
  return false;
}

/** Cabeceras estándar de la API de GitHub (User-Agent es obligatorio). */
function cabecerasGitHub_(pat) {
  return {
    'Authorization': 'Bearer ' + pat,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ALTO-Barrido-de-Prensa'
  };
}

/** Codifica cada segmento de la ruta (deja las barras). */
function codificarRuta_(ruta) {
  return ruta.split('/').map(encodeURIComponent).join('/');
}

// ---------- Verificación -------------------------------------------------

/**
 * Punto de entrada de verificación de la Fase 4.
 * Corre el pipeline completo y publica en Pages.
 */
function testPublicar() {
  Logger.log('=== Fase 4 · prueba de publicación ===');

  var articulos = recolectarTitulares();
  var edicion = generarEdicion(articulos);
  if (!edicion) { Logger.log('✗ Sin edición; revisá Fases 1-2.'); return; }

  var html = renderEdicion(edicion);
  var res = publicarEdicion(edicion, html);
  if (!res) { Logger.log('✗ No se pudo publicar.'); return; }

  Logger.log('✓ Publicado. Esperá ~1 min a que Pages reconstruya y abrí:');
  Logger.log('   Hoy:     %s', res.hoy);
  Logger.log('   Edición: %s', res.edicion);
  Logger.log('   Archivo: %s', res.archivo);

  var dias = diasRestantesPat();
  Logger.log('   PAT: %s', dias === null ? 'sin dato de vencimiento' : dias + ' días restantes');
}
