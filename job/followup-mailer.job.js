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
    await inicializarMonitorSeguimientos();
    return [];
  }

  const eventos = await obtenerEventosGLPI();

  const eventosViejosNoRegistrados = eventos.filter(
    (evento) =>
      !eventoPosteriorALineaBase(evento) && !seguimientoYaEnviado(evento.id)
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
  console.log("Iniciando monitor de respuestas GLPI...");

  inicializarMonitorSeguimientos().catch((error) => {
    console.error("Error inicializando monitor de respuestas:", error.message);
  });

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
