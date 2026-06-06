/**
 * Oportunidades.gs — Mejora #6: pipeline comercial.
 * Vuelca cada cliente afectado del boletín a una pestaña "Oportunidades" del Sheet
 * (append-only), con una columna "Estado" para que el equipo comercial la trabaje.
 * Requiere scope de ESCRITURA de Sheets (spreadsheets). La pestaña se crea sola.
 *
 * No duplica: como Memoria.gs (#1) filtra antes lo ya publicado, los clientes
 * afectados de cada corrida son nuevos.
 */

var HOJA_OPORTUNIDADES = 'Oportunidades';
var CABECERA_OPORTUNIDADES = ['Fecha', 'Cliente', 'Industria', 'Tipo de amenaza',
  'Oportunidad comercial', 'Titular', 'Fuente', 'URL', 'Relevancia', 'Estado'];

/** Agrega una fila por cada cliente afectado del día a la pestaña Oportunidades. */
function registrarOportunidades_(edicion) {
  var clientes = (edicion.boletin && edicion.boletin.clientes_afectados) || [];
  if (!clientes.length) { Logger.log('Oportunidades: nada que registrar.'); return; }

  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) { Logger.log('✗ Falta SHEET_ID; no se registran oportunidades.'); return; }

  var ss;
  try { ss = SpreadsheetApp.openById(id); }
  catch (e) { Logger.log('✗ No se pudo abrir el Sheet para oportunidades: %s', e.message); return; }

  var hoja = ss.getSheetByName(HOJA_OPORTUNIDADES);
  if (!hoja) {
    hoja = ss.insertSheet(HOJA_OPORTUNIDADES);
    hoja.appendRow(CABECERA_OPORTUNIDADES);
  }

  clientes.forEach(function (c) {
    hoja.appendRow([
      edicion.fecha, c.cliente, c.industria, c.tipo_amenaza,
      c.oportunidad_comercial, c.titular, c.fuente, c.url, c.relevancia, ''
    ]);
  });
  Logger.log('Oportunidades: %s filas agregadas.', clientes.length);
}
