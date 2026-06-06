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

    var edicion = generarEdicion(articulos);               // Fase 2
    if (!edicion) throw new Error('No se pudo generar la edición (Claude).');

    var html = renderEdicion(edicion);                     // Fase 3
    var res = publicarEdicion(edicion, html);              // Fase 4
    if (!res) throw new Error('No se pudo publicar en GitHub Pages.');
    Logger.log('Publicado: %s', res.edicion);

    if (!enviarCorreo(edicion)) throw new Error('No se pudo enviar el correo.'); // Fase 5

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
      subject: 'ALTO · Barrido de Prensa — FALLÓ la edición de hoy',
      body: 'El barrido diario no pudo completarse.\n\nMotivo: ' + motivo +
            '\n\nRevisá el registro de ejecución en Apps Script.',
      name: 'ALTO · Barrido de Prensa'
    });
  } catch (e) {
    Logger.log('  (no se pudo enviar el aviso de fallo: %s)', e.message);
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
