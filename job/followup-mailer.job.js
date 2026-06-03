const cron = require("node-cron");

const {
  obtenerSeguimientosRecientesGLPI,
  obtenerSolucionesRecientesGLPI,
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

const monitorIniciadoEn = new Date();

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
    numericId: Number(solucion.id),
    tipo: "solucion",
    ticketId: solucion.items_id,
    contenido: solucion.content || "",
    fecha: solucion.date_creation || solucion.date_mod,
  };
}

function fechaGLPIComoDate(fecha) {
  const match = String(fecha || "").match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/
  );

  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match.map(Number);
  return new Date(year, month - 1, day, hour, minute, second);
}

function eventoCreadoDespuesDelArranque(evento) {
  const fechaEvento = fechaGLPIComoDate(evento.fecha);
  return Boolean(fechaEvento && fechaEvento > monitorIniciadoEn);
}

async function enviarSeguimientosNuevos() {
  const [seguimientos, soluciones] = await Promise.all([
    obtenerSeguimientosRecientesGLPI(50),
    obtenerSolucionesRecientesGLPI(50),
  ]);

  const eventos = [
    ...seguimientos.filter(esSeguimientoDeTicketPublico).map(eventoDesdeSeguimiento),
    ...soluciones.filter(esSolucionDeTicket).map(eventoDesdeSolucion),
  ];

  const estado = leerEstado();

  if (!estado.inicializado) {
    marcarSeguimientosEnviados(
      eventos.map((evento) => evento.id),
      true
    );

    console.log(
      `Monitor inicializado: ${eventos.length} eventos existentes ignorados. Solo se notificaran respuestas nuevas.`
    );
    return [];
  }

  const eventosViejosNoRegistrados = eventos.filter(
    (evento) =>
      !eventoCreadoDespuesDelArranque(evento) && !seguimientoYaEnviado(evento.id)
  );

  if (eventosViejosNoRegistrados.length) {
    marcarSeguimientosEnviados(
      eventosViejosNoRegistrados.map((evento) => evento.id),
      true
    );
    console.log(
      `Eventos anteriores al arranque ignorados: ${eventosViejosNoRegistrados.length}`
    );
  }

  const enviados = [];
  const nuevos = eventos
    .filter(eventoCreadoDespuesDelArranque)
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
      const contenidoCorreo = `
        <p>Hola,</p>
        <p>Se agregó una ${escaparHtml(evento.tipo)} a tu caso <strong>#${escaparHtml(ticketId)}</strong>.</p>
        <p><strong>Estado actual:</strong> ${escaparHtml(estadoTicket)}</p>
        <hr>
        <div>${evento.contenido}</div>
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
