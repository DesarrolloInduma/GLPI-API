const cron = require("node-cron");

const {
  obtenerSeguimientosRecientesGLPI,
  obtenerTicketGLPI,
  obtenerSolicitanteTicketGLPI,
} = require("../services/glpi");

const { enviarCorreo } = require("../services/outlook.service");

const {
  leerEstado,
  seguimientoYaEnviado,
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

function esSeguimientoDeTicketPublico(seguimiento) {
  return (
    seguimiento?.id &&
    seguimiento?.items_id &&
    seguimiento?.itemtype === "Ticket" &&
    Number(seguimiento?.is_private || 0) === 0
  );
}

async function enviarSeguimientosNuevos() {
  const seguimientos = (await obtenerSeguimientosRecientesGLPI(50)).filter(
    esSeguimientoDeTicketPublico
  );

  const estado = leerEstado();

  if (!estado.inicializado) {
    marcarSeguimientosEnviados(
      seguimientos.map((seguimiento) => seguimiento.id),
      true
    );
    console.log("Monitor de respuestas inicializado sin enviar historial.");
    return [];
  }

  const enviados = [];
  const nuevos = seguimientos
    .filter((seguimiento) => !seguimientoYaEnviado(seguimiento.id))
    .sort((a, b) => Number(a.id) - Number(b.id));

  for (const seguimiento of nuevos) {
    const ticketId = seguimiento.items_id;

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
      const contenidoCorreo = `
        <p>Hola,</p>
        <p>Se agregó una respuesta a tu caso <strong>#${escaparHtml(ticketId)}</strong>.</p>
        <p><strong>Estado actual:</strong> ${escaparHtml(estadoTicket)}</p>
        <hr>
        <div>${seguimiento.content || ""}</div>
      `;

      await enviarCorreo(solicitante.email, asunto, contenidoCorreo);
      marcarSeguimientosEnviados([seguimiento.id], true);

      enviados.push({
        seguimientoId: seguimiento.id,
        ticketId,
        destinatario: solicitante.email,
        estado: estadoTicket,
      });
    } catch (error) {
      console.error(
        `Error enviando seguimiento ${seguimiento.id} del ticket ${ticketId}:`,
        error.response?.data || error.message
      );
    }
  }

  return enviados;
}

function iniciarJobSeguimientos() {
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
}

module.exports = {
  iniciarJobSeguimientos,
  enviarSeguimientosNuevos,
};
