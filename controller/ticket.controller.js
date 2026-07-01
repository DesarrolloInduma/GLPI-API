const {
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

// ================= CONFIG =================
const TECNICOS_PERMITIDOS = [7, 63, 66];

const ASIGNACIONES_DOBLES = {
  7: 52,
  66: 53,
  63: 55,
};

// ================= UTIL =================
function limpiarRespuestaCorreo(html) {
  if (!html) return "";

  const separadores = [
    "De:", "From:", "-----Original Message-----",
    "Tu mensaje original:", "Asunto del ticket:"
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

// ================= PROCESO PRINCIPAL =================
async function procesarCorreosNoLeidos(req = null, res = null) {
  try {
    const correos = await obtenerCorreosNoLeidos();
    const resultados = [];
    const procesadosIds = new Set();

    for (const correo of correos) {
      let lockPath = null;
      let convLockPath = null;

      try {
        if (!correo?.id || procesadosIds.has(correo.id)) continue;
        procesadosIds.add(correo.id);

        // ================= LOCK =================
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

        // ================= REMITENTE =================
        const email = correo.from?.emailAddress?.address || "sin-correo";
        const nombre = correo.from?.emailAddress?.name || "";

        const usuario = await buscarUsuarioGLPIPorEmail(email);
        const solicitanteId = usuario?.id || null;

        const esTecnico =
          solicitanteId && TECNICOS_PERMITIDOS.includes(solicitanteId);

        console.log("📧 FROM:", email, "| ID:", solicitanteId, "| Técnico:", esTecnico);

        // ================= DETECTAR TICKET =================
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

        // ================= RESPUESTAS =================
        if (ticketRelacionado) {
          let contenido =
            correo.body?.content || correo.bodyPreview || "Sin contenido";
          contenido = limpiarRespuestaCorreo(contenido);

          if (esTecnico) {
            console.log("🛠️ Respuesta de técnico → SE AGREGA");

            await agregarRespuestaTicketGLPI(ticketRelacionado, contenido);

            resultados.push({
              correoId: correo.id,
              ticketId: ticketRelacionado,
              tipo: "RESPUESTA_TECNICO",
            });
          } else {
            console.log("👤 Cliente respondió → IGNORADO");

            resultados.push({
              correoId: correo.id,
              ticketId: ticketRelacionado,
              tipo: "RESPUESTA_CLIENTE_IGNORADA",
            });
          }

          await guardarMessageIdParaTicket(
            ticketRelacionado,
            correo.id,
            correo.conversationId
          );

          await marcarCorreoLeido(correo.id);
          continue;
        }

        // ================= DUPLICADOS =================
        if (await buscarTicketIdPorMessageId(correo.id)) {
          await marcarCorreoLeido(correo.id);
          continue;
        }

        // ================= NUEVO TICKET =================
        const asunto = correo.subject || "Sin asunto";
        let descripcion =
          correo.body?.content || correo.bodyPreview || "Sin contenido";
        descripcion = limpiarRespuestaCorreo(descripcion);

        // ================= DETECTAR TÉCNICO =================
        const toRecipients = correo.toRecipients || [];
        const ccRecipients = correo.ccRecipients || [];

        let tecnicoId = 0;

        console.log(
          "📨 Destinatarios TO:",
          toRecipients.map((r) => r?.emailAddress?.address)
        );
        console.log(
          "📨 Destinatarios CC:",
          ccRecipients.map((r) => r?.emailAddress?.address)
        );

        const buscarTecnicoEn = async (lista) => {
          for (const d of lista) {
            const addr = d?.emailAddress?.address;
            if (!addr) continue;

            let user = await buscarUsuarioGLPIPorEmail(addr);
            let id = user?.id || 0;

            if (!id) {
              const login = addr.split("@")[0];
              const userByLogin = await buscarUsuarioGLPIPorLogin(login);
              id = userByLogin?.id || 0;
            }

            console.log("🔍 Buscando técnico:", addr, "=>", id);

            if (id && TECNICOS_PERMITIDOS.includes(id)) {
              return id;
            }
          }
          return 0;
        };

        tecnicoId = await buscarTecnicoEn(toRecipients);
        if (!tecnicoId) {
          tecnicoId = await buscarTecnicoEn(ccRecipients);
        }

        // 🔥 FALLBACK
        if (!tecnicoId) {
          tecnicoId = 7;
          console.log("⚠️ Fallback técnico:", tecnicoId);
        }

        // ================= ADJUNTOS =================
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
          console.error("❌ Error adjuntos:", e.message);
        }

        // ================= CREAR TICKET =================
        const ticket = await crearTicketGLPI(
          asunto,
          descripcion,
          email,
          nombre,
          tecnicoId
        );

        if (ticket?.id) {
          await guardarMessageIdParaTicket(
            ticket.id,
            correo.id,
            correo.conversationId
          );

          console.log(`✅ Ticket #${ticket.id} creado con técnico ${tecnicoId}`);

          // ================= ASIGNACIÓN DOBLE =================
          const adicional = ASIGNACIONES_DOBLES[tecnicoId];

          if (adicional) {
            try {
              await agregarUsuarioATicket(ticket.id, adicional, 2);
              console.log(`✅ Técnico adicional ${adicional}`);
            } catch (e) {
              console.error("❌ Error asignación doble:", e.message);
            }
          }

          // ================= VINCULAR ADJUNTOS =================
          for (const docId of docIds) {
            await vincularDocumentoATicket(ticket.id, docId);
          }
        }

        await marcarCorreoLeido(correo.id);

        resultados.push({
          correoId: correo.id,
          ticketId: ticket?.id,
          tecnicoId,
          tipo: "NUEVO",
        });

      } catch (error) {
        console.error(`❌ Error procesando correo ${correo.id}:`, error.message);

        resultados.push({
          correoId: correo.id,
          error: error.message,
        });
      } finally {
        if (lockPath) await unlockMessageId(correo.id);
        if (convLockPath)
          await unlockMessageId(`conv:${correo.conversationId}`);
      }
    }

    if (res) return res.json({ ok: true, resultados });
    return resultados;

  } catch (error) {
    console.error("❌ Error general:", error.message);

    if (res)
      return res.status(500).json({
        ok: false,
        error: error.message,
      });

    throw error;
  }
}

// ================= REST =================
async function obtenerTickets(req, res) {
  const tickets = await obtenerTicketsGLPI();
  res.json({ ok: true, tickets });
}

async function crearTicket(req, res) {
  const { asunto, descripcion, email } = req.body;
  const ticket = await crearTicketGLPI(asunto, descripcion, email, "", 0);
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

module.exports = {
  obtenerTickets,
  crearTicket,
  crearTicketDesdeCorreo,
  responderTicket,
  procesarCorreosNoLeidos,
  obtenerUsers,
};