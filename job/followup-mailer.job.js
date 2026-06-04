const cron = require("node-cron");

const {
  obtenerSeguimientosRecientesGLPI,
  obtenerSolucionesRecientesGLPI,
  obtenerTicketGLPI,
  obtenerSolicitanteTicketGLPI,
} = require("../services/glpi");

const { enviarCorreo } = require("../services/outlook.service");

const {
  seguimientoYaEnviado,
  marcarSeguimientosEnviados,
  guardarBaseline,
} = require("../services/followup-state");

const ESTADOS_TICKET = {
  1: "Nuevo",
  2: "En curso (asignado)",
  3: "En curso (planificado)",
  4: "En espera",
  5: "Resuelto",
  6: "Cerrado",
};

const baselineIds = {
  followup: null,
  solution: null,
};
let monitorInicializado = false;

const EVENTOS_POR_REVISION = Number(process.env.GLPI_EVENTOS_POR_REVISION || 200);

function obtenerNombreEstadoTicket(status) {
  return ESTADOS_TICKET[Number(status)] || `Estado ${status}`;
}

function extraerContenidoHtml(html) {
  if (!html || typeof html !== "string") return "";

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    return bodyMatch[1];
  }

  const htmlMatch = html.match(/<html[^>]*>([\s\S]*?)<\/html>/i);
  if (htmlMatch) {
    let inner = htmlMatch[1];
    inner = inner.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "");
    return inner;
  }

  return html;
}

function escaparHtml(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function esSeguimientoDeTicketPublico(seguimiento) {
  return (
    seguimiento?.id &&
    seguimiento?.items_id &&
    seguimiento?.itemtype === "Ticket" &&
    Number(seguimiento?.is_private || 0) === 0
  );
}

function esSolucionDeTicket(solucion) {
  return (
    solucion?.id &&
    solucion?.items_id &&
    solucion?.itemtype === "Ticket"
  );
}

function eventoDesdeSeguimiento(seguimiento) {
  return {
    id: `followup:${seguimiento.id}`,
    clase: "followup",
    numericId: Number(seguimiento.id),
    tipo: "respuesta",
    ticketId: seguimiento.items_id,
    contenido: seguimiento.content || "",
    fecha: seguimiento.date_creation || seguimiento.date,
  };
}

function eventoDesdeSolucion(solucion) {
  return {
    id: `solution:${solucion.id}`,
    clase: "solution",
    numericId: Number(solucion.id),
    tipo: "solucion",
    ticketId: solucion.items_id,
    contenido: solucion.content || "",
    fecha: solucion.date_creation || solucion.date_mod,
  };
}

function establecerLineaBase(eventos) {
  const maxFollowup = Math.max(
    0,
    ...eventos
      .filter((evento) => evento.clase === "followup")
      .map((evento) => evento.numericId)
  );
  const maxSolution = Math.max(
    0,
    ...eventos
      .filter((evento) => evento.clase === "solution")
      .map((evento) => evento.numericId)
  );

  baselineIds.followup = maxFollowup;
  baselineIds.solution = maxSolution;
}

function eventoPosteriorALineaBase(evento) {
  return evento.numericId > Number(baselineIds[evento.clase] || 0);
}

async function obtenerEventosGLPI() {
  const [seguimientos, soluciones] = await Promise.all([
    obtenerSeguimientosRecientesGLPI(EVENTOS_POR_REVISION),
    obtenerSolucionesRecientesGLPI(EVENTOS_POR_REVISION),
  ]);

  return [
    ...seguimientos.filter(esSeguimientoDeTicketPublico).map(eventoDesdeSeguimiento),
    ...soluciones.filter(esSolucionDeTicket).map(eventoDesdeSolucion),
  ];
}

async function inicializarMonitorSeguimientos() {
  const eventos = await obtenerEventosGLPI();

  establecerLineaBase(eventos);
  guardarBaseline(baselineIds);
  marcarSeguimientosEnviados(
    eventos.map((evento) => evento.id),
    true
  );
  monitorInicializado = true;

  console.log(
    `Monitor de respuestas listo: followup>${baselineIds.followup}, solution>${baselineIds.solution}. Solo se notificaran eventos nuevos.`
  );
}

async function enviarSeguimientosNuevos() {
  if (!monitorInicializado) {
    console.log("Monitor de respuestas aun no inicializado. Se omite esta revision.");
    return [];
  }

  const eventos = await obtenerEventosGLPI();

  const enviados = [];
  const nuevos = eventos
    .filter(eventoPosteriorALineaBase)
    .filter((evento) => !seguimientoYaEnviado(evento.id))
    .sort((a, b) => Number(a.numericId) - Number(b.numericId));

  if (!nuevos.length) {
    console.log("No hay respuestas o soluciones nuevas para notificar.");
  }

  for (const evento of nuevos) {
    const ticketId = evento.ticketId;

    try {
      const [ticket, solicitante] = await Promise.all([
        obtenerTicketGLPI(ticketId),
        obtenerSolicitanteTicketGLPI(ticketId),
      ]);

      if (!solicitante?.email) {
        console.warn(
          `No se encontró correo del solicitante para ticket ${ticketId}`
        );
        continue;
      }

      const estadoTicket = obtenerNombreEstadoTicket(ticket.status);
      const asunto = `Respuesta al ticket #${ticketId} - ${ticket.name || "Sin asunto"}`;
      const contenidoOriginal = extraerContenidoHtml(ticket.content || "Sin descripción");
      const contenidoCorreo = `
        <p>Hola,</p>
        <p>Se agregó una <strong>${escaparHtml(evento.tipo)}</strong> a tu caso <strong>#${ticketId}</strong>.</p>
        
        <div style="background-color: #f5f5f5; padding: 15px; border-left: 4px solid #007bff; margin: 15px 0;">
          <p><strong>Asunto del ticket:</strong></p>
          <p style="margin: 10px 0;">${escaparHtml(ticket.name || "Sin asunto")}</p>
          
          <p style="margin-top: 15px;"><strong>Tu mensaje original:</strong></p>
          <div style="background-color: white; padding: 10px; border-radius: 4px; margin: 10px 0;">
            ${contenidoOriginal}
          </div>
        </div>
        
        <div style="margin: 20px 0;">
          <p><strong>Estado actual del ticket:</strong> <span style="background-color: #e7f3ff; padding: 5px 10px; border-radius: 3px;">${escaparHtml(estadoTicket)}</span></p>
          
          <p><strong>Nueva ${escaparHtml(evento.tipo)}:</strong></p>
          <div style="background-color: #f9f9f9; padding: 15px; border: 1px solid #ddd; border-radius: 4px;">
            ${evento.contenido}
            <p style="margin-top: 16px;">Por favor confirme si la solución proporcionada ha resuelto el problema para poder dar por cerrado el ticket. Si el inconveniente persiste, responda a este correo con la información adicional y lo revisaremos nuevamente.</p>
          </div>
        </div>
        
        <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
        <p style="font-size: 12px; color: #666;">Este es un correo automático. Por favor, no responda a este correo.</p>
      `;

      await enviarCorreo(solicitante.email, asunto, contenidoCorreo);
      marcarSeguimientosEnviados([evento.id], true);

      enviados.push({
        eventoId: evento.id,
        ticketId,
        destinatario: solicitante.email,
        estado: estadoTicket,
      });
    } catch (error) {
      console.error(
        `Error enviando evento ${evento.id} del ticket ${ticketId}:`,
        error.response?.data || error.message
      );
    }
  }

  return enviados;
}

function iniciarJobSeguimientos() {
  console.log("Iniciando monitor de respuestas GLPI...");

  inicializarMonitorSeguimientos()
    .then(() => {
      cron.schedule("* * * * *", async () => {
        try {
          const enviados = await enviarSeguimientosNuevos();

          if (enviados.length) {
            console.log(`Respuestas notificadas por correo: ${enviados.length}`);
          }
        } catch (error) {
          console.error("Error en monitor de respuestas:", error.message);
        }
      });
    })
    .catch((error) => {
      console.error("Error inicializando monitor de respuestas:", error.message);
    });
}

module.exports = {
  iniciarJobSeguimientos,
  enviarSeguimientosNuevos,
};
