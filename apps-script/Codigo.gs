/**
 * Codigo.gs — Fase 6
 * Orquestador del barrido diario y gestión del trigger temporal.
 *
 * barridoDiario() es la función que dispara el trigger cada mañana:
 *   Fuentes → Claude (1 llamada) → Render → GitHub Pages → Correo.
 *
 * Puesta en marcha (una vez): ejecutar instalarTriggerDiario().
 * Verificación: ejecutar barridoDiario() a mano (debe actualizar Pages y llegar
 * el correo) y revisar que el trigger quede listado (ícono de reloj).
 */

/**
 * Punto de entrada del trigger: arma y publica la edición del día y manda el correo.
 * Diseñado para fallar de forma segura: si Claude o la publicación fallan, NO se
 * envía el correo (que enlaza a Pages), y se avisa por mail del fallo.
 */
function barridoDiario() {
  var inicio = new Date();
  Logger.log('=== Barrido diario · %s ===',
             Utilities.formatDate(inicio, 'America/Santiago', 'yyyy-MM-dd HH:mm'));

  try {
    var articulos = recolectarTitulares();                 // Fase 1
    if (!articulos.length) throw new Error('No se recolectaron titulares.');
    Logger.log('Titulares recolectados: %s', articulos.length);

    articulos = filtrarNoVistos_(articulos);               // Mejora #1: no repetir lo ya publicado

    var edicion = generarEdicion(articulos);               // Fase 2
    if (!edicion) throw new Error('No se pudo generar la edición (Claude).');

    var html = renderEdicion(edicion);                     // Fase 3
    var res = publicarEdicion(edicion, html);              // Fase 4
    if (!res) throw new Error('No se pudo publicar en GitHub Pages.' + detalleErrorGitHub());
    Logger.log('Publicado: %s', res.edicion);

    if (!enviarCorreo(edicion)) throw new Error('No se pudo enviar el correo.'); // Fase 5

    registrarPublicados_(edicion);     // Mejora #1: recordar lo ya reportado
    registrarOportunidades_(edicion);  // Mejora #6: volcar oportunidades al Sheet
    avisarVencimientoPat_();           // Mejora #7: alerta si el GITHUB_PAT está por vencer

    var seg = Math.round((new Date() - inicio) / 1000);
    Logger.log('✓ Barrido completado en %s s.', seg);
  } catch (e) {
    Logger.log('✗ Barrido falló: %s', e.message);
    alertarFallo_(e.message);
  }
}

/** Avisa por correo si el barrido falla (best-effort). */
function alertarFallo_(motivo) {
  var destino = PropertiesService.getScriptProperties().getProperty('CORREO_DESTINO');
  if (!destino) return;
  try {
    MailApp.sendEmail({
      to: destino,
      subject: 'ALTO · Informe de Prensa — FALLÓ la edición de hoy',
      body: 'El barrido diario no pudo completarse.\n\nMotivo: ' + motivo +
            '\n\nRevisá el registro de ejecución en Apps Script.',
      name: 'ALTO · Informe de Prensa'
    });
  } catch (e) {
    Logger.log('  (no se pudo enviar el aviso de fallo: %s)', e.message);
  }
}

/**
 * Mejora #7: si al GITHUB_PAT le quedan ≤ DIAS_AVISO_PAT días, avisa por correo
 * (best-effort). La expiración sale del header que GitHub devuelve en cada
 * request autenticado, capturado durante la publicación de hoy.
 */
var DIAS_AVISO_PAT = 7;

function avisarVencimientoPat_() {
  var dias = diasRestantesPat();
  if (dias === null || dias > DIAS_AVISO_PAT) return;

  var destino = PropertiesService.getScriptProperties().getProperty('CORREO_DESTINO');
  if (!destino) return;

  var cuando = dias <= 0 ? 'HOY' : 'en ' + dias + (dias === 1 ? ' día' : ' días');
  try {
    MailApp.sendEmail({
      to: destino,
      subject: '⚠ ALTO · El token de GitHub vence ' + cuando,
      body: [
        'El GITHUB_PAT que publica el Informe de Prensa en GitHub Pages vence ' + cuando + '.',
        '',
        'Si vence, el barrido diario dejará de publicarse (y no saldrá el correo).',
        '',
        'Para renovarlo:',
        '1. GitHub (cuenta hcuevasg) → Settings → Developer settings → Fine-grained tokens.',
        '2. Regenerá el token del repo hcuevasg/ALTONoticias con permiso Contents: Read and write.',
        '   Elegí una expiración larga (fecha custom).',
        '3. Apps Script → Configuración del proyecto → Propiedades del script → actualizá GITHUB_PAT.',
        '',
        'Este aviso se repite con cada barrido hasta que renueves el token.'
      ].join('\n'),
      name: 'ALTO · Informe de Prensa'
    });
    Logger.log('⚠ Aviso de vencimiento del PAT enviado (%s días restantes).', dias);
  } catch (e) {
    Logger.log('  (no se pudo enviar el aviso de vencimiento: %s)', e.message);
  }
}

// ---------- Trigger temporal --------------------------------------------

/**
 * Instala (o reinstala) el trigger diario entre las 7 y 8 am de Santiago.
 * Ejecutar UNA vez a mano. Idempotente: borra triggers previos del barrido.
 */
function instalarTriggerDiario() {
  borrarTriggersBarrido_();
  ScriptApp.newTrigger('barridoDiario')
    .timeBased()
    .everyDays(1)
    .atHour(7)                       // ventana 7:00–7:59
    .inTimezone('America/Santiago')
    .create();
  Logger.log('✓ Trigger diario instalado: barridoDiario, 7–8 am America/Santiago.');
}

/** Quita el trigger diario (por si querés pausar el sistema). */
function desinstalarTriggerDiario() {
  var n = borrarTriggersBarrido_();
  Logger.log('✓ Triggers del barrido eliminados: %s.', n);
}

/** Borra todos los triggers que apunten a barridoDiario. Devuelve cuántos. */
function borrarTriggersBarrido_() {
  var triggers = ScriptApp.getProjectTriggers();
  var n = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'barridoDiario') {
      ScriptApp.deleteTrigger(triggers[i]);
      n++;
    }
  }
  return n;
}
