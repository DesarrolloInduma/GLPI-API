require('dotenv').config();

const {
  crearTicketGLPI,
  buscarUsuarioGLPIPorEmail,
  buscarUsuarioGLPIPorLogin,
  agregarUsuarioATicket,
  subirDocumentoGLPI,
  vincularDocumentoATicket,
} = require('../services/glpi');

const {
  obtenerCorreos,
  obtenerAdjuntosDeCorreo,
  obtenerDetalleAdjunto,
  marcarCorreoLeido,
} = require('../services/outlook.service');

const {
  obtenerMessageIdPorTicket,
  buscarTicketIdPorMessageId,
  guardarMessageIdParaTicket,
} = require('../services/email-map');

(async function(){
  try {
    console.log('Obteniendo mensajes recientes...');
    const correos = await obtenerCorreos();
    const lista = Array.isArray(correos.value) ? correos.value : (Array.isArray(correos) ? correos : []);
    console.log('Mensajes obtenidos:', lista.length);
    const take = Math.min(10, lista.length);
    for (let i=0;i<take;i++){
      const correo = lista[i];
      console.log('\n--- Mensaje', i+1, 'id=', correo.id, 'subject=', correo.subject);

      if (!correo.id) continue;

      if (correo.parentMessageId) {
        const ticketRelacionado = await buscarTicketIdPorMessageId(correo.parentMessageId);
        if (ticketRelacionado) {
          console.log('Es respuesta vinculada a ticket', ticketRelacionado, ' - saltando');
          continue;
        }
      }

      const ya = await buscarTicketIdPorMessageId(correo.id);
      if (ya) {
        console.log('Mensaje ya procesado y vinculado a ticket', ya, ' - saltando');
        continue;
      }

      const asunto = correo.subject || 'Sin asunto';
      const descripcion = correo.body?.content || correo.bodyPreview || 'Sin contenido';
      const email = correo.from?.emailAddress?.address || correo.sender?.emailAddress?.address || 'sin-correo';
      const nombreSolicitante = correo.from?.emailAddress?.name || correo.sender?.emailAddress?.name || '';

      console.log('Creando ticket en GLPI para mensaje', correo.id, 'remitente=', email);
      try {
        const ticket = await crearTicketGLPI(asunto, descripcion, email, nombreSolicitante, 0);
        console.log('Respuesta crearTicketGLPI:', ticket);
        if (ticket?.id) {
          await guardarMessageIdParaTicket(ticket.id, correo.id);
          console.log('Guardado mapeo ticket', ticket.id, '->', correo.id);
          try { await marcarCorreoLeido(correo.id); } catch(e){/*no critical*/}
        }
      } catch (e) {
        console.error('Error creando ticket para mensaje', correo.id, e.response?.data || e.message || e);
      }
    }
  } catch (e) {
    console.error('Error general:', e.response?.data || e.message || e);
    process.exit(1);
  }
})();
