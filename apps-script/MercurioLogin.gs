/**
 * MercurioLogin.gs — INTENTO EXPERIMENTAL de login en El Mercurio (suscripción digital).
 *
 * ⛔ RESULTADO (probado 2026-06-16): CONFIRMADO NO VIABLE desde Apps Script. El HTML que
 *    devuelve el servidor NO trae un campo type=password — el paso de la contraseña lo
 *    inyecta JavaScript (igual que La Tercera/Piano y DF/SPA). Los inputs del formulario del
 *    servidor son una ficha de contacto (name/lastname/rutContact/phone/email/subject/
 *    enviar_bt) + txtUsername; sin password. Solo se obtuvo la cookie 'MERS'. No es cuestión
 *    de afinar la heurística: UrlFetchApp no ejecuta JS, así que los 3 medios de pago quedan
 *    fuera del login automático. El Mercurio/Emol ya se cubre vía site: (público), que es lo
 *    que consume el boletín. Se conserva como registro del intento; se puede borrar sin riesgo.
 *
 * ⚠️ ESTADO: experimental, NO conectado al barrido diario.
 *
 * CÓMO PROBAR
 *   1) Apps Script → Configuración del proyecto → Propiedades del script, agregá:
 *        EM_USUARIO   = RUT o email de suscriptor (ej. 9035436-1)
 *        EM_PASSWORD  = la contraseña
 *      ⚠️ NO pongas las credenciales en el código ni en el repositorio (es público).
 *   2) (Opcional) EM_ARTICULO_PRUEBA = URL de una nota de pago para verificar el acceso.
 *   3) Ejecutá  mercurioDiagnosticoLogin()  y leé el registro de ejecución.
 *
 * CÓMO LEER EL RESULTADO
 *   - Si tras el POST la respuesta SIGUE mostrando el formulario (campo de contraseña)
 *     → el login NO funcionó (campos/SSO distintos a lo que asume la heurística).
 *   - Si redirige (302/303) o desaparece el formulario y aparecen cookies → posible éxito.
 *   - El diagnóstico imprime la acción y los campos detectados para poder afinar el POST.
 *
 * POR QUÉ PUEDE FALLAR AUNQUE EL LOGIN "ENTRE": el artículo vive en otro dominio
 *   (www.elmercurio.com / digital.elmercurio.com / emol.com) y la cookie de sesión podría
 *   no propagarse sin un segundo salto SSO. Por eso el paso final verifica el acceso real.
 */

var EM_LOGIN_URL = 'https://suscripciondigital.elmercurio.com/MERCL/Login.aspx';
var EM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Punto de entrada: intenta loguear y reporta cada paso en el registro. */
function mercurioDiagnosticoLogin() {
  Logger.log('=== Diagnóstico de login · El Mercurio (experimental) ===');

  var cred = emCredenciales_();
  if (!cred) {
    Logger.log('✗ Faltan EM_USUARIO / EM_PASSWORD en Propiedades del script. Cargalas y reintentá.');
    return;
  }

  var r = emIniciarSesion_(cred);
  Logger.log(r.ok ? '✓ El POST de login NO devolvió el formulario (posible éxito).'
                  : '✗ El login no parece haber funcionado.');
  Logger.log('  Detalle: %s', r.mensaje);

  var nCookies = r.cookies ? Object.keys(r.cookies).length : 0;
  Logger.log(nCookies ? '  Cookies obtenidas: ' + Object.keys(r.cookies).join(', ')
                      : '  (no se obtuvieron cookies)');

  var art = PropertiesService.getScriptProperties().getProperty('EM_ARTICULO_PRUEBA');
  if (r.ok && art) {
    emVerificarArticulo_(art, r.cookies);
  } else if (r.ok) {
    Logger.log('  (configurá EM_ARTICULO_PRUEBA con una nota de pago para verificar el acceso real)');
  }
}

/** Lee las credenciales de Propiedades del script. @return {?{usuario,password}} */
function emCredenciales_() {
  var p = PropertiesService.getScriptProperties();
  var u = p.getProperty('EM_USUARIO'), c = p.getProperty('EM_PASSWORD');
  if (!u || !c) return null;
  return { usuario: u.trim(), password: c };
}

/**
 * Intenta el login: GET de la página (cookies + campos del form) → POST con credenciales.
 * @return {{ok:boolean, mensaje:string, cookies:Object}}
 */
function emIniciarSesion_(cred) {
  // 1) GET: capturamos cookies de sesión y el HTML del formulario.
  var get;
  try {
    get = UrlFetchApp.fetch(EM_LOGIN_URL, {
      muteHttpExceptions: true, followRedirects: true,
      headers: { 'User-Agent': EM_UA }
    });
  } catch (e) {
    return { ok: false, cookies: {}, mensaje: 'GET de login falló: ' + e.message };
  }
  if (get.getResponseCode() !== 200) {
    return { ok: false, cookies: {}, mensaje: 'GET de login devolvió HTTP ' + get.getResponseCode() };
  }

  var cookies = emLeerCookies_(get.getAllHeaders(), {});
  var html = get.getContentText();

  var accion = emAccionFormulario_(html, EM_LOGIN_URL);
  var campos = emCamposFormulario_(html);   // hidden + defaults (incluye __VIEWSTATE, etc.)
  Logger.log('  Formulario → acción: %s', accion);
  Logger.log('  Campos ocultos/base: %s', Object.keys(campos).join(', ') || '(ninguno)');

  // Heurística para ubicar usuario y contraseña entre los inputs.
  var campoUser = emDetectarCampo_(html, /usuario|rut|email|correo|user|login/i, /^(text|email)$/i);
  var campoPass = emDetectarCampo_(html, /pass|clave|contrasena|contraseña/i, /^password$/i);
  if (!campoPass) {
    return { ok: false, cookies: cookies,
             mensaje: 'No se encontró campo type=password; el login probablemente se renderiza por JavaScript.' };
  }
  Logger.log('  Campo usuario: %s | campo contraseña: %s', campoUser || '(no detectado)', campoPass);

  // Completamos credenciales y, si existe, el botón submit (ASP.NET suele necesitar su name).
  if (campoUser) campos[campoUser] = cred.usuario;
  campos[campoPass] = cred.password;
  var boton = emBotonSubmit_(html);
  if (boton) campos[boton.nombre] = boton.valor;

  // 2) POST sin seguir redirección, para capturar el Set-Cookie del 302 de éxito.
  var post;
  try {
    post = UrlFetchApp.fetch(accion, {
      method: 'post', muteHttpExceptions: true, followRedirects: false,
      contentType: 'application/x-www-form-urlencoded',
      payload: emFormEncode_(campos),
      headers: {
        'User-Agent': EM_UA,
        'Cookie': emCookieHeader_(cookies),
        'Referer': EM_LOGIN_URL,
        'Origin': emOrigen_(EM_LOGIN_URL)
      }
    });
  } catch (e) {
    return { ok: false, cookies: cookies, mensaje: 'POST de login falló: ' + e.message };
  }

  cookies = emLeerCookies_(post.getAllHeaders(), cookies);
  var codigo = post.getResponseCode();
  var cuerpo = post.getContentText();

  // Señales de éxito: redirección o que la respuesta ya no muestre un campo de contraseña.
  var redirige = codigo === 301 || codigo === 302 || codigo === 303;
  var sigueElForm = /type\s*=\s*["']?password/i.test(cuerpo);
  var ok = redirige || !sigueElForm;

  var msg = 'HTTP ' + codigo;
  if (redirige)      msg += ' (redirección → ' + emUbicacion_(post.getAllHeaders()) + ')';
  else if (sigueElForm) msg += ' (la respuesta AÚN muestra el formulario de login)';
  else               msg += ' (la respuesta ya no muestra el formulario)';

  return { ok: ok, cookies: cookies, mensaje: msg };
}

/** Descarga el artículo de prueba con la sesión y reporta si lo ve completo o bloqueado. */
function emVerificarArticulo_(url, cookies) {
  try {
    var r = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true, followRedirects: true,
      headers: { 'User-Agent': EM_UA, 'Cookie': emCookieHeader_(cookies) }
    });
    var cuerpo = r.getContentText();
    var muro = /(suscr[ií]base|contenido exclusivo|inicia sesi[oó]n para|reg[ií]strate para|paywall)/i.test(cuerpo);
    Logger.log('  Artículo de prueba: HTTP %s · %s caracteres · %s',
               r.getResponseCode(), cuerpo.length,
               muro ? 'parece BLOQUEADO (muro de pago detectado)' : 'sin muro evidente (¿acceso?)');
  } catch (e) {
    Logger.log('  Artículo de prueba: error %s', e.message);
  }
}

// ---------- Utilidades de cookies / formulario --------------------------------

/** Acumula cookies (name=value) desde las cabeceras Set-Cookie sobre las previas. */
function emLeerCookies_(headers, previas) {
  var jar = {};
  Object.keys(previas || {}).forEach(function (k) { jar[k] = previas[k]; });
  var sc = headers ? (headers['Set-Cookie'] || headers['set-cookie']) : null;
  if (!sc) return jar;
  var lista = Array.isArray(sc) ? sc : [sc];
  lista.forEach(function (linea) {
    var par = String(linea).split(';')[0];   // 'name=value'
    var i = par.indexOf('=');
    if (i > 0) jar[par.slice(0, i).trim()] = par.slice(i + 1).trim();
  });
  return jar;
}

/** Arma la cabecera Cookie: 'a=1; b=2'. */
function emCookieHeader_(jar) {
  return Object.keys(jar).map(function (k) { return k + '=' + jar[k]; }).join('; ');
}

/** action del <form>, resuelto a URL absoluta (relativa al login si hace falta). */
function emAccionFormulario_(html, baseUrl) {
  var m = /<form[^>]*\baction\s*=\s*["']([^"']*)["']/i.exec(html);
  var accion = m ? m[1] : '';
  if (!accion) return baseUrl;                          // form sin action → postea a sí mismo
  if (/^https?:\/\//i.test(accion)) return accion;      // absoluta
  if (accion.charAt(0) === '/') return emOrigen_(baseUrl) + accion;
  return baseUrl.replace(/[^\/]*$/, '') + accion.replace(/^\.\//, ''); // relativa al directorio
}

/** Todos los <input> con name (menos botones): hidden + defaults. @return {Object} */
function emCamposFormulario_(html) {
  var campos = {}, re = /<input\b[^>]*>/ig, tag;
  while ((tag = re.exec(html)) !== null) {
    var t = tag[0];
    var nombre = emAttr_(t, 'name');
    if (!nombre) continue;
    var tipo = (emAttr_(t, 'type') || 'text').toLowerCase();
    if (tipo === 'submit' || tipo === 'button' || tipo === 'image' || tipo === 'reset') continue;
    campos[nombre] = emAttr_(t, 'value') || '';
  }
  return campos;
}

/** Primer botón submit/image con name (ASP.NET lo usa para identificar el postback). */
function emBotonSubmit_(html) {
  var re = /<input\b[^>]*>/ig, tag;
  while ((tag = re.exec(html)) !== null) {
    var t = tag[0];
    var tipo = (emAttr_(t, 'type') || '').toLowerCase();
    if (tipo === 'submit' || tipo === 'image') {
      var n = emAttr_(t, 'name');
      if (n) return { nombre: n, valor: emAttr_(t, 'value') || '' };
    }
  }
  return null;
}

/** Nombre del primer input cuyo name/id matchea reNombre y type matchea reTipo. */
function emDetectarCampo_(html, reNombre, reTipo) {
  var re = /<input\b[^>]*>/ig, tag;
  // 1ª pasada: por nombre/id + tipo.
  while ((tag = re.exec(html)) !== null) {
    var t = tag[0];
    var nombre = emAttr_(t, 'name');
    if (!nombre) continue;
    var tipo = (emAttr_(t, 'type') || 'text').toLowerCase();
    var id = emAttr_(t, 'id');
    if (reTipo.test(tipo) && (reNombre.test(nombre) || reNombre.test(id))) return nombre;
  }
  // 2ª pasada: solo por tipo (sirve para el único type=password).
  re.lastIndex = 0;
  while ((tag = re.exec(html)) !== null) {
    var t2 = tag[0];
    var nombre2 = emAttr_(t2, 'name');
    var tipo2 = (emAttr_(t2, 'type') || 'text').toLowerCase();
    if (nombre2 && reTipo.test(tipo2)) return nombre2;
  }
  return '';
}

/** Valor de un atributo HTML dentro de una etiqueta (comillas dobles, simples o sin comillas). */
function emAttr_(tag, nombre) {
  var re = new RegExp('\\b' + nombre + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i');
  var m = re.exec(tag);
  if (!m) return '';
  return (m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3])) || '';
}

/** Codifica un objeto como application/x-www-form-urlencoded. */
function emFormEncode_(obj) {
  return Object.keys(obj).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]);
  }).join('&');
}

/** 'https://host' de una URL. */
function emOrigen_(url) {
  var m = /^(https?:\/\/[^\/]+)/i.exec(url);
  return m ? m[1] : '';
}

/** Cabecera Location de una respuesta (para ver a dónde redirige el login). */
function emUbicacion_(headers) {
  return (headers && (headers['Location'] || headers['location'])) || '(sin Location)';
}
