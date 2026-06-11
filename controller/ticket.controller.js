try {
    const correosNoLeidos = await obtenerCorreosNoLeidos();
    console.log(`procesarCorreosNoLeidos: encontrados ${Array.isArray(correosNoLeidos)?correosNoLeidos.length:0} correos no leídos`);
    console.log(
  `[DEBUG] Inicio proceso PID=${process.pid} ${new Date().toISOString()}`
);
    let correos = Array.isArray(correosNoLeidos) ? [...correosNoLeidos] : [];

    try {
      console.log('Obteniendo mensajes recientes para procesar además de los no leídos...');
      const todos = await obtenerCorreos();
      const lista = Array.isArray(todos.value) ? todos.value : (Array.isArray(todos) ? todos : []);

      const ahora = Date.now();
      const MAX_AGE_MIN = Number(process.env.FALLBACK_MAX_AGE_MIN || 1440);

      const recientes = lista.filter((m) => {
        try {
          const t = new Date(m.receivedDateTime).getTime();
          return !isNaN(t) && ahora - t <= MAX_AGE_MIN * 60 * 1000;
        } catch (e) {
          return false;
        }
      });

      console.log(`Mensajes recientes encontrados=${recientes.length} (últimos ${MAX_AGE_MIN} min)`);

      const idsExistentes = new Set(correos.map((c) => c.id));
      for (const mensaje of recientes) {
        if (mensaje?.id && !idsExistentes.has(mensaje.id)) {
          correos.push(mensaje);
          idsExistentes.add(mensaje.id);
        }
      }

      console.log(`Total a procesar tras merge: ${correos.length}`);
    } catch (e) {
      console.error('Error obteniendo mensajes recientes:', e.response?.data || e.message || e);
    }

    const resultados = [];
    const procesadosIds = new Set();

    for (const correo of correos) {
      let lockPath = null;
      let convLockPath = null;
      try {
        if (!correo?.id || procesadosIds.has(correo.id)) {
          continue;
        }
        procesadosIds.add(correo.id);

        // Intentar adquirir lock a nivel de conversación para evitar condiciones de carrera
        if (correo.conversationId) {
          try {
            convLockPath = await lockMessageId(`conv:${correo.conversationId}`);
          } catch (lockError) {
            console.log(`Conversación ${correo.conversationId} ya se está procesando en otra instancia, saltando mensaje ${correo.id}.`);
            continue;
          }
        }

        try {
          lockPath = await lockMessageId(correo.id);
        } catch (lockError) {
          console.log(`Mensaje ${correo.id} ya se está procesando en otra instancia, saltando.`);
          continue;
        }

        console.log(`procesarCorreosNoLeidos: procesando mensaje id=${correo.id} parent=${correo.parentMessageId||''} subject="${(correo.subject||'').slice(0,80)}"`);
        // Si es una respuesta en hilo a un ticket ya mapeado, la procesa el job de replies y no debe crear un ticket nuevo.
        let ticketRelacionado = null;
        if (correo.parentMessageId) {
          ticketRelacionado = await buscarTicketIdPorMessageId(correo.parentMessageId);
        }

        if (!ticketRelacionado && correo.conversationId) {
          ticketRelacionado = await buscarTicketIdPorConversationId(correo.conversationId);
        }

        if (ticketRelacionado) {
          console.log(
            `Saltando correo ${correo.id} porque pertenece al ticket ya vinculado ${ticketRelacionado} (parentMessageId=${correo.parentMessageId || 'N/A'}, conversationId=${correo.conversationId || 'N/A'})`
          );
          try {
            await marcarCorreoLeido(correo.id);
          } catch (error) {
            console.error(`No se pudo marcar como leído el correo ${correo.id}:`, error.response?.data || error.message || error);
          }
          continue;
        }

        // Evitar crear el mismo ticket dos veces si este mensaje ya fue procesado.
        const ticketExistente = await buscarTicketIdPorMessageId(correo.id);
        if (ticketExistente) {
          console.log(
            `Correo ${correo.id} ya fue procesado y está vinculado al ticket ${ticketExistente}. Omitiendo creación duplicada.`
          );
          try {
            await marcarCorreoLeido(correo.id);
          } catch (error) {
            console.error(`No se pudo marcar como leído el correo ${correo.id}:`, error.response?.data || error.message || error);
          }
          continue;
        }

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
        console.log(
          `[DEBUG] Crear ticket correo=${correo.id} PID=${process.pid}`
        );
        const ticket = await crearTicketGLPI(
          asunto,
          descripcion, // Ahora el HTML tiene las URLs de las imágenes inline actualizadas
          email,
          nombreSolicitante,
          tecnicoId,
        );

        if (ticket?.id) {
          console.log(`Ticket creado en GLPI: id=${ticket.id} (desde correo ${correo.id})`);
          await guardarMessageIdParaTicket(ticket.id, correo.id, correo.conversationId);
        } else {
          console.warn(`No se creó ticket desde correo ${correo.id}. respuesta crearTicketGLPI: ${JSON.stringify(ticket)}`);
        }

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
        const detalleError = error.response?.data || error.message;
        console.error(`Error procesando correo ${correo.id}:`, detalleError);

        resultados.push({
          correoId: correo.id,
          estado: "ERROR",
          error: typeof detalleError === "string" ? detalleError : JSON.stringify(detalleError),
          url: error.config?.url,
          status: error.response?.status,
        });
      } finally {
        if (lockPath) {
          try {
            await unlockMessageId(correo.id);
          } catch (unlockError) {
            console.error(`Error liberando lock de correo ${correo.id}:`, unlockError.message || unlockError);
          }
        }
        if (convLockPath) {
          try {
            await unlockMessageId(`conv:${correo.conversationId}`);
          } catch (unlockError) {
            console.error(`Error liberando lock de conversacion ${correo.conversationId}:`, unlockError.message || unlockError);
          }
        }
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
