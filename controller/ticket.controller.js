const {
  obtenerCorreos,
  obtenerCorreosNoLeidos,
  marcarCorreoLeido,
  obtenerCorreoPorId,
  obtenerAdjuntosDeCorreo,
  obtenerDetalleAdjunto,
} = require("../services/outlook.service");

const {
  obtenerTicketsGLPI,
  crearTicketGLPI,
  agregarRespuestaTicketGLPI,
  obtenerUsersGLPI,
  buscarUsuarioGLPIPorEmail,
  buscarUsuarioGLPIPorLogin,
  agregarUsuarioATicket,
  subirDocumentoGLPI,
  vincularDocumentoATicket,
} = require("../services/glpi");

const {
  buscarTicketIdPorMessageId,
  buscarTicketIdPorConversationId,
  guardarMessageIdParaTicket,
  lockMessageId,
  unlockMessageId,
} = require("../services/email-map");

// =============================
// 🧹 LIMPIAR RESPUESTA DE CORREO
// =============================
function limpiarRespuestaCorreo(html) {
  if (!html) return "";

  const separadores = [
    "De:",
    "From:",
    "-----Original Message-----",
    "Tu mensaje original:",
    "Asunto del ticket:",
  ];

  let limpio = html;

  for (const sep of separadores) {
    const index = limpio.indexOf(sep);
    if (index !== -1) {
      limpio = limpio.substring(0, index);
    }
  }

  return limpio.trim();
}

// =============================
// PROCESAR CORREOS
// =============================
async function procesarCorreosNoLeidos(req = null, res = null) {
  try {
    const correosNoLeidos = await obtenerCorreosNoLeidos();
    let correos = Array.isArray(correosNoLeidos) ? [...correosNoLeidos] : [];

    const resultados = [];
    const procesadosIds = new Set();

    for (const correo of correos) {
      let lockPath = null;
      let convLockPath = null;

      try {
        if (!correo?.id || procesadosIds.has(correo.id)) continue;
        procesadosIds.add(correo.id);

        if (correo.conversationId) {
          try {
            convLockPath = await lockMessageId(`conv:${correo.conversationId}`);
          } catch {
            continue;
          }
        }

        try {
          lockPath = await lockMessageId(correo.id);
        } catch {
          continue;
        }

        // =============================
        // 🔥 DETECTAR SI ES RESPUESTA
        // =============================
        let ticketRelacionado = null;

        if (correo.parentMessageId) {
          ticketRelacionado = await buscarTicketIdPorMessageId(
            correo.parentMessageId
          );
        }

        if (!ticketRelacionado && correo.conversationId) {
          ticketRelacionado = await buscarTicketIdPorConversationId(
            correo.conversationId
          );
        }

        // =============================
        // 🔥 SI ES RESPUESTA → AGREGAR A GLPI
        // =============================
        if (ticketRelacionado) {
          console.log(`📩 Respuesta detectada → ticket ${ticketRelacionado}`);

          let contenido =
            correo.body?.content ||
            correo.bodyPreview ||
            "Sin contenido";

          // 🧹 LIMPIEZA AQUÍ
          contenido = limpiarRespuestaCorreo(contenido);

          await agregarRespuestaTicketGLPI(ticketRelacionado, contenido);

          await guardarMessageIdParaTicket(
            ticketRelacionado,
            correo.id,
            correo.conversationId
          );

          await marcarCorreoLeido(correo.id);

          resultados.push({
            correoId: correo.id,
            ticketId: ticketRelacionado,
            tipo: "RESPUESTA",
            estado: "OK",
          });

          continue;
        }

        // =============================
        // EVITAR DUPLICADOS
        // =============================
        const existe = await buscarTicketIdPorMessageId(correo.id);
        if (existe) {
          await marcarCorreoLeido(correo.id);
          continue;
        }

        // =============================
        // CREAR TICKET
        // =============================
        const asunto = correo.subject || "Sin asunto";

        let descripcion =
          correo.body?.content ||
          correo.bodyPreview ||
          "Sin contenido";

        // 🧹 TAMBIÉN LIMPIAMOS AQUÍ (opcional pero recomendado)
        descripcion = limpiarRespuestaCorreo(descripcion);

        const email =
          correo.from?.emailAddress?.address || "sin-correo";

        const nombre =
          correo.from?.emailAddress?.name || "";

        // =============================
        // ADJUNTOS
        // =============================
        const docIds = [];
        try {
          const adjuntos = await obtenerAdjuntosDeCorreo(correo.id);

          for (const adj of adjuntos) {
            const detalle = await obtenerDetalleAdjunto(correo.id, adj.id);

            if (!detalle.contentBytes) continue;

            const docId = await subirDocumentoGLPI(
              detalle.name,
              detalle.contentBytes,
              detalle.contentType
            );

            docIds.push(docId);
          }
        } catch (e) {
          console.error("Error adjuntos:", e.message);
        }

        // =============================
        // CREAR TICKET EN GLPI
        // =============================
        const ticket = await crearTicketGLPI(
          asunto,
          descripcion,
          email,
          nombre,
          0
        );

        if (ticket?.id) {
          await guardarMessageIdParaTicket(
            ticket.id,
            correo.id,
            correo.conversationId
          );

          for (const docId of docIds) {
            await vincularDocumentoATicket(ticket.id, docId);
          }
        }

        await marcarCorreoLeido(correo.id);

        resultados.push({
          correoId: correo.id,
          ticketId: ticket?.id,
          tipo: "NUEVO",
          estado: "OK",
        });

      } catch (error) {
        resultados.push({
          correoId: correo.id,
          estado: "ERROR",
          error: error.message,
        });
      } finally {
        if (lockPath) await unlockMessageId(correo.id);
        if (convLockPath)
          await unlockMessageId(`conv:${correo.conversationId}`);
      }
    }

    if (res) {
      return res.json({ ok: true, resultados });
    }

    return resultados;
  } catch (error) {
    if (res) {
      return res.status(500).json({ ok: false, error: error.message });
    }
    throw error;
  }
}

// =============================
async function obtenerTickets(req, res) {
  const tickets = await obtenerTicketsGLPI();
  res.json({ ok: true, tickets });
}

async function crearTicket(req, res) {
  const { asunto, descripcion, email } = req.body;

  const ticket = await crearTicketGLPI(
    asunto,
    descripcion,
    email,
    "",
    0
  );

  res.json({ ok: true, ticket });
}

async function crearTicketDesdeCorreo(req, res) {
  const correo = await obtenerCorreoPorId(req.params.id);

  const ticket = await crearTicketGLPI(
    correo.subject,
    limpiarRespuestaCorreo(correo.body?.content),
    correo.from?.emailAddress?.address,
    correo.from?.emailAddress?.name,
    0
  );

  await guardarMessageIdParaTicket(
    ticket.id,
    correo.id,
    correo.conversationId
  );

  res.json({ ok: true, ticket });
}

async function responderTicket(req, res) {
  const { id } = req.params;
  const { contenido } = req.body;

  const seguimiento = await agregarRespuestaTicketGLPI(id, contenido);

  res.json({ ok: true, seguimiento });
}

async function obtenerUsers(req, res) {
  const users = await obtenerUsersGLPI();
  res.json({ ok: true, users });
}

// =============================
module.exports = {
  obtenerTickets,
  crearTicket,
  crearTicketDesdeCorreo,
  responderTicket,
  procesarCorreosNoLeidos,
  obtenerUsers,
};