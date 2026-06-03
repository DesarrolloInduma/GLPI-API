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
    };
  } catch {
    return { inicializado: false, enviados: [] };
  }
}

function guardarEstado(estado) {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(estado, null, 2));
}

function seguimientoYaEnviado(followupId) {
  const estado = leerEstado();
  return estado.enviados.includes(Number(followupId));
}

function marcarSeguimientosEnviados(followupIds, inicializado = true) {
  const estado = leerEstado();
  const enviados = new Set(estado.enviados.map(Number));

  for (const followupId of followupIds) {
    const id = Number(followupId);
    if (id) enviados.add(id);
  }

  guardarEstado({
    inicializado,
    enviados: [...enviados].slice(-1000),
  });
}

module.exports = {
  leerEstado,
  seguimientoYaEnviado,
  marcarSeguimientosEnviados,
};
