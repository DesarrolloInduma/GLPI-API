const fs = require("fs");
const path = require("path");

const stateDir = path.join(__dirname, "..", "data");
const statePath = path.join(stateDir, "followups-enviados.json");

function leerEstado() {
  try {
    if (!fs.existsSync(statePath)) {
      return {
        inicializado: false,
        enviados: [],
        baseline: { followup: 0, solution: 0 },
        ticketStatus: {},
      };
    }

    const contenido = fs.readFileSync(statePath, "utf8");
    const estado = JSON.parse(contenido);

    return {
      inicializado: Boolean(estado.inicializado),
      enviados: Array.isArray(estado.enviados)
        ? estado.enviados.map(String)
        : [],
      baseline: {
        followup: Number(estado.baseline?.followup || 0),
        solution: Number(estado.baseline?.solution || 0),
      },
      ticketStatus: estado.ticketStatus && typeof estado.ticketStatus === "object"
        ? estado.ticketStatus
        : {},
    };
  } catch {
    return {
      inicializado: false,
      enviados: [],
      baseline: { followup: 0, solution: 0 },
      ticketStatus: {},
    };
  }
}

function guardarEstado(estado) {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(estado, null, 2));
}

function normalizarIdEvento(eventoId) {
  if (!eventoId) return null;
  return String(eventoId).trim();
}

function seguimientoYaEnviado(followupId) {
  const estado = leerEstado();
  const id = normalizarIdEvento(followupId);

  if (!id) return false;

  return estado.enviados.includes(id);
}

function marcarSeguimientosEnviados(followupIds, inicializado = true) {
  const estado = leerEstado();
  const enviados = new Set(estado.enviados);

  for (const followupId of followupIds) {
    const id = normalizarIdEvento(followupId);
    if (!id) continue;

    enviados.add(id);
  }

  guardarEstado({
    ...estado,
    inicializado,
    enviados: Array.from(enviados).slice(-1000),
  });
}

function guardarBaseline(baseline) {
  const estado = leerEstado();

  guardarEstado({
    ...estado,
    inicializado: true,
    baseline: {
      followup: Number(baseline.followup || 0),
      solution: Number(baseline.solution || 0),
    },
  });
}

function obtenerUltimoEstadoTicket(ticketId) {
  const estado = leerEstado();
  const key = String(ticketId || "").trim();
  if (!key) return null;
  return Number(estado.ticketStatus?.[key]?.status ?? NaN);
}

function guardarUltimoEstadoTicket(ticketId, status) {
  const estado = leerEstado();
  const key = String(ticketId || "").trim();
  if (!key || Number.isNaN(Number(status))) return;

  guardarEstado({
    ...estado,
    ticketStatus: {
      ...(estado.ticketStatus || {}),
      [key]: {
        status: Number(status),
        updatedAt: new Date().toISOString(),
      },
    },
  });
}

module.exports = {
  leerEstado,
  seguimientoYaEnviado,
  marcarSeguimientosEnviados,
  guardarBaseline,
  obtenerUltimoEstadoTicket,
  guardarUltimoEstadoTicket,
};