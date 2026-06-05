/**
 * Correo.gs — Fase 5
 * Envía el digest del día con MailApp. El cuerpo es el correo TOPADO de Render.gs
 * (renderCorreo): brief completo, con sello de tiempo de lectura arriba y botón a
 * la edición completa. HTML con estilos inline (compatibilidad Outlook).
 *
 * Secret en Propiedades del Script: CORREO_DESTINO (uno o varios, separados por coma).
 *
 * Verificación: ejecutar testCorreo(). Debe llegar el correo con el digest y el link.
 */

/**
 * Envía el digest de una edición a CORREO_DESTINO.
 * @param {Object} edicion  objeto del contrato.
 * @return {boolean} true si se envió.
 */
function enviarCorreo(edicion) {
  var destino = PropertiesService.getScriptProperties().getProperty('CORREO_DESTINO');
  if (!destino) {
    Logger.log('✗ Falta CORREO_DESTINO en Propiedades del Script.');
    return false;
  }

  var correo = renderCorreo(edicion);   // {html, minutos, palabras}
  var asunto = 'ALTO · Barrido de Prensa — ' + fechaLarga_(edicion.fecha) +
               '  (⏱ ~' + correo.minutos + ' min)';

  try {
    MailApp.sendEmail({
      to: destino,
      subject: asunto,
      htmlBody: correo.html,
      body: cuerpoTextoPlano_(edicion),   // fallback para clientes sin HTML
      name: 'ALTO · Barrido de Prensa'
    });
  } catch (e) {
    Logger.log('✗ Falló el envío: %s', e.message);
    return false;
  }

  Logger.log('✓ Correo enviado a %s (⏱ ~%s min, %s palabras).',
             destino, correo.minutos, correo.palabras);
  return true;
}

/** Fallback de texto plano (clientes que no renderizan HTML). */
function cuerpoTextoPlano_(edicion) {
  var tp = edicion.titular_principal;
  var url = BASE_PAGES + '/ediciones/' + edicion.fecha + '.html';
  return [
    'ALTO · Barrido de Prensa — ' + fechaLarga_(edicion.fecha),
    '',
    'Titular principal: ' + tp.titular,
    tp.bajada,
    'Fuente: ' + tp.fuente,
    '',
    'Ver la edición completa y el archivo:',
    url
  ].join('\n');
}

/**
 * Punto de entrada de verificación de la Fase 5.
 * Corre el pipeline completo y envía el correo.
 */
function testCorreo() {
  Logger.log('=== Fase 5 · prueba de correo ===');

  var articulos = recolectarTitulares();
  var edicion = generarEdicion(articulos);
  if (!edicion) { Logger.log('✗ Sin edición; revisá Fases 1-2.'); return; }

  var ok = enviarCorreo(edicion);
  if (ok) Logger.log('Revisá tu bandeja de entrada.');
}
