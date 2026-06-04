const {
  obtenerTicketsGLPI,
  obtenerTicketGLPI,
  crearTicketGLPI,
  obtenerUsersGLPI,
  obtenerSolicitanteTicketGLPI,
  agregarRespuestaTicketGLPI,
  buscarUsuarioGLPIPorEmail,
  buscarUsuarioGLPIPorLogin,
  agregarUsuarioATicket,
  subirDocumentoGLPI,
  vincularDocumentoATicket,
} = require("../services/glpi");

const {
  obtenerCorreoPorId,
  obtenerCorreosNoLeidos,
  marcarCorreoLeido,
  obtenerAdjuntosDeCorreo,
  obtenerDetalleAdjunto,
  enviarCorreo,
} = require("../services/outlook.service");

const {
  marcarSeguimientosEnviados,
} = require("../services/followup-state");

const ESTADOS_TICKET = {
  1: "Nuevo",
  2: "En curso (asignado)",
  3: "En curso (planificado)",
  4: "En espera",
  5: "Resuelto",
  6: "Cerrado",
};

function obtenerNombreEstadoTicket(status) {
  return ESTADOS_TICKET[Number(status)] || `Estado ${status}`;
}

function escaparHtml(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function obtenerTickets(req, res) {
  try {
    const tickets = await obtenerTicketsGLPI();

    return res.json({
      ok: true,
      tickets,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message, url: error.config?.url
    });
  }
}

async function crearTicket(req, res) {
  try {
    const { asunto, descripcion } = req.body;

    const ticket = await crearTicketGLPI(asunto, descripcion);

    return res.json({
      ok: true,
      ticket,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
}

async function crearTicketDesdeCorreo(req, res) {
  try {
    const { id } = req.params;

    const correo = await obtenerCorreoPorId(id);

    const asunto = correo.subject || "Sin asunto";
    const descripcion = correo.bodyPreview || "Sin contenido";

    const email =
      correo.from?.emailAddress?.address ||
      correo.sender?.emailAddress?.address ||
      "sin-correo";

    const nombreSolicitante =
      correo.from?.emailAddress?.name || correo.sender?.emailAddress?.name;

    const ticket = await crearTicketGLPI(
      asunto,
      descripcion,
      email,
      nombreSolicitante,
    );

    return res.json({
      ok: true,
      correo: {
        id: correo.id,
        asunto,
        email,
      },
      ticket,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
}

async function responderTicket(req, res) {
  try {
    const { id } = req.params;
    const respuesta = req.body.respuesta || req.body.content || req.body.contenido;

    if (!respuesta || !String(respuesta).trim()) {
      return res.status(400).json({
        ok: false,
        error: "Falta la respuesta del ticket",
      });
    }

    const ticket = await obtenerTicketGLPI(id);
    const seguimiento = await agregarRespuestaTicketGLPI(id, respuesta);
    const solicitante = await obtenerSolicitanteTicketGLPI(id);

    if (!solicitante?.email) {
      return res.status(404).json({
        ok: false,
        error: "No se encontró el correo del remitente/solicitante del ticket",
        seguimiento,
      });
    }

    const estado = obtenerNombreEstadoTicket(ticket.status);
    const asunto = `Respuesta al ticket #${id} - ${ticket.name || "Sin asunto"}`;
    const respuestaCorreo = escaparHtml(respuesta).replace(/\r?\n/g, "<br>");

    // Extraer posibles enlaces a documentos en el contenido del ticket para hacerlos accesibles
    let archivosHtml = '';
    try {
      const contenidoTicket = String(ticket.content || '');
      const re = /document\.send\.php\?docid=(\d+)/gi;
      const ids = [];
      let mm;
      while ((mm = re.exec(contenidoTicket)) !== null) {
        if (mm[1] && !ids.includes(mm[1])) ids.push(mm[1]);
      }
      if (ids.length) {
        const baseUrl = String(process.env.GLPI_URL || '').replace('/apirest.php', '');
        archivosHtml = '<p style="margin-top:12px;"><strong>Documentos adjuntos:</strong></p><ul>';
        for (const did of ids) {
          const url = `${baseUrl}/front/document.send.php?docid=${did}`;
          archivosHtml += `<li><a href="${url}" target="_blank" rel="noopener noreferrer">Abrir documento ${did}</a></li>`;
        }
        archivosHtml += '</ul>';
      }
    } catch (e) {
      archivosHtml = '';
    }

    const contenidoCorreo = `
      <p>Hola,</p>
      <p>Se agregó una respuesta a tu caso <strong>#${escaparHtml(id)}</strong>.</p>
      <p><strong>Estado actual:</strong> ${escaparHtml(estado)}</p>
      <hr>
      <div style="background-color: #f9f9f9; padding: 15px; border: 1px solid #ddd; border-radius: 4px;">
        ${respuestaCorreo}
        ${archivosHtml}
        <p style="margin-top: 16px;">Por favor confirme si la solución proporcionada resolvió el inconveniente reportado para que podamos proceder a cerrar el ticket. Si aún necesita asistencia, responda a este mensaje con más detalles y lo atenderemos con prioridad.</p>
      </div>
    `;

    await enviarCorreo(solicitante.email, asunto, contenidoCorreo);

    if (seguimiento?.id) {
      marcarSeguimientosEnviados([seguimiento.id], true);
    }

    return res.json({
      ok: true,
      ticketId: Number(id),
      estado,
      destinatario: solicitante.email,
      seguimiento,
    });
  } catch (error) {
    console.error(error.response?.data || error);

    return res.status(500).json({
      ok: false,
      error: error.response?.data?.error?.message || error.message,
    });
  }
}

async function procesarCorreosNoLeidos(req, res) {
  try {
    const correos = await obtenerCorreosNoLeidos();

    const resultados = [];

    for (const correo of correos) {
      try {
        const asunto = correo.subject || "Sin asunto";
        let descripcion = correo.body?.content || correo.bodyPreview || "Sin contenido";

        const email =
          correo.from?.emailAddress?.address ||
          correo.sender?.emailAddress?.address ||
          "sin-correo";

        const nombreSolicitante =
          correo.from?.emailAddress?.name || correo.sender?.emailAddress?.name;

        const toRecipients = Array.isArray(correo.toRecipients)
          ? correo.toRecipients
          : [];
        const ccRecipients = Array.isArray(correo.ccRecipients)
          ? correo.ccRecipients
          : [];

        const recipients = [...toRecipients, ...ccRecipients];

        const outlookUserLower = String(process.env.OUTLOOK_USER || "")
          .trim()
          .toLowerCase();

        let tecnicoId = 0;
        let metodoAsignacion = "none";
        let correoTecnico = null;

        // Buscar en to y cc el primer destinatario que exista en GLPI (por email o por login)
        for (const d of recipients) {
          const addr = d?.emailAddress?.address;
          if (!addr) continue;
          const addrLower = String(addr).trim().toLowerCase();
          if (outlookUserLower && addrLower === outlookUserLower) continue;

          // Intentar por email primero
          const usuarioGLPI = await buscarUsuarioGLPIPorEmail(addr);
          let id = usuarioGLPI?.id || 0;
          let metodo = "";

          if (id) {
            metodo = "email";
          } else {
            // Fallback: buscar por login (parte antes del @)
            const login = String(addr).split("@")[0]?.trim();
            if (login) {
              const userByLogin = await buscarUsuarioGLPIPorLogin(login);
              id = userByLogin?.id || 0;
              if (id) metodo = "login";
            }
          }

          if (id) {
            tecnicoId = id;
            metodoAsignacion = metodo || "email";
            correoTecnico = addr;
            break;
          }
        }

        // Obtener y subir adjuntos ANTES de crear el ticket para poder incluirlos en el HTML
        let adjuntosSubidos = 0;
        let errorAdjuntos;
        const docIdsParaVincular = [];
        try {
          const adjuntos = await obtenerAdjuntosDeCorreo(correo.id);
          for (const adj of adjuntos) {
            try {
              if (adj["@odata.type"] !== "#microsoft.graph.fileAttachment" && !adj.contentBytes) {
                continue;
              }
              const detalle = await obtenerDetalleAdjunto(correo.id, adj.id);
              if (!detalle.contentBytes) continue;
              
              const nombre = detalle.name || adj.name || "adjunto";
              const mime = detalle.contentType || adj.contentType || "application/octet-stream";
              
              const docId = await subirDocumentoGLPI(nombre, detalle.contentBytes, mime);
              docIdsParaVincular.push(docId);
              adjuntosSubidos++;

              // Si es una imagen inline, reemplazar el 'cid:' en el HTML por la URL del documento en GLPI
              if (adj.isInline && adj.contentId && correo.body?.contentType === 'html') {
                const baseUrl = String(process.env.GLPI_URL).replace('/apirest.php', '');
                const docUrl = `${baseUrl}/front/document.send.php?docid=${docId}`;
                const cidRegex = new RegExp(`cid:${adj.contentId}`, 'gi');
                descripcion = descripcion.replace(cidRegex, docUrl);
              }
            } catch (adjError) {
              console.error(`Error subiendo adjunto ${adj.name}:`, adjError.response?.data || adjError.message);
            }
          }
        } catch (attachError) {
          errorAdjuntos = attachError.response?.data || attachError.message;
          console.error("Error obteniendo adjuntos del correo:", errorAdjuntos);
        }

        const ticket = await crearTicketGLPI(
          asunto,
          descripcion, // Ahora el HTML tiene las URLs de las imágenes inline actualizadas
          email,
          nombreSolicitante,
          tecnicoId,
        );

        // Vincular los documentos subidos al nuevo ticket
        if (ticket?.id) {
          for (const docId of docIdsParaVincular) {
            try {
              await vincularDocumentoATicket(ticket.id, docId);
            } catch (e) {
              console.error(`Error vinculando doc ${docId} al ticket ${ticket.id}:`, e.message);
            }
          }
        }

        // Reglas: si se asigna a X, también asignar a Y
        const asignacionDoble = {
          7: 52,
          37: 53,
          55: 63,
        };

        const adicionalId = asignacionDoble[tecnicoId] || 0;
        let asignadoAdicional = false;
        let errorAsignadoAdicional;

        if (adicionalId && ticket?.id) {
          try {
            await agregarUsuarioATicket(ticket.id, adicionalId, 2);
            asignadoAdicional = true;
          } catch (error) {
            asignadoAdicional = false;
            errorAsignadoAdicional =
              error.response?.data?.error?.message || error.message;
          }
        }

        let correoMarcadoLeido = true;
        let errorMarcarLeido;

        try {
          await marcarCorreoLeido(correo.id);
        } catch (error) {
          correoMarcadoLeido = false;
          errorMarcarLeido =
            error.response?.data?.error?.message || error.message;
        }

        resultados.push({
          correoId: correo.id,
          asunto,
          ticket,
          estado: "OK",
          autoAsignado: tecnicoId !== 0,
          correoTecnico: correoTecnico || null,
          tecnicoId,
          metodoAsignacion,
          ...(adicionalId
            ? { asignadoAdicionalId: adicionalId, asignadoAdicional }
            : {}),
          ...(errorAsignadoAdicional && { errorAsignadoAdicional }),
          correoMarcadoLeido,
          ...(errorMarcarLeido && { errorMarcarLeido }),
        });
      } catch (error) {
        resultados.push({
          correoId: correo.id,
          estado: "ERROR",
          error: error.message,
        });
      }
    }

    if (res) {
      return res.json({
        ok: true,
        procesados: resultados.length,
        resultados,
      });
    }
    
    return resultados;
  } catch (error) {
    console.error(error);
    if (res) {
      return res.status(500).json({
        ok: false,
        error: error.message,
      });
    }
    
    throw error;
  }
}

async function obtenerUsers(req, res) {
  try {
    const tickets = await obtenerUsersGLPI();

    res.json({
      ok: true,
      tickets,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
}

module.exports = {
  obtenerTickets,
  crearTicket,
  crearTicketDesdeCorreo,
  responderTicket,
  procesarCorreosNoLeidos,
  obtenerUsers,
};
