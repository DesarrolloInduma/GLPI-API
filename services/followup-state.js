const fs = require("fs");
const path = require("path");

const stateDir = path.join(__dirname, "..", "data");
const statePath = path.join(stateDir, "followups-enviados.json");

function leerEstado() {
  try {
    if (!fs.existsSync(statePath)) {
      return { inicializado: false, enviados: [] };
    }

    const contenido = fs.readFileSync(statePath, "utf8");
    const estado = JSON.parse(contenido);

    return {
      inicializado: Boolean(estado.inicializado),
      enviados: Array.isArray(estado.enviados) ? estado.enviados : [],
      baseline: {
        followup: Number(estado.baseline?.followup || 0),
        solution: Number(estado.baseline?.solution || 0),
      },
    };
  } catch {
    return {
      inicializado: false,
      enviados: [],
      baseline: {
        followup: 0,
        solution: 0,
      },
    };
  }
}

function guardarEstado(estado) {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(estado, null, 2));
}

function normalizarIdEvento(eventoId) {
  return String(eventoId || "").trim();
}

function seguimientoYaEnviado(followupId) {
  const estado = leerEstado();
  const id = normalizarIdEvento(followupId);

  return estado.enviados.map(String).includes(id);
}

function marcarSeguimientosEnviados(followupIds, inicializado = true) {
  const estado = leerEstado();
  const enviados = new Set(estado.enviados.map(String));

  for (const followupId of followupIds) {
    const id = normalizarIdEvento(followupId);
    if (id) enviados.add(id);
  }

  guardarEstado({
    ...estado,
    inicializado,
    enviados: [...enviados].slice(-1000),
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

module.exports = {
  leerEstado,
  seguimientoYaEnviado,
  marcarSeguimientosEnviados,
  guardarBaseline,
};
