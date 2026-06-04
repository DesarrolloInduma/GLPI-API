const fs = require("fs").promises;
const path = require("path");

const MAP_PATH = path.resolve(__dirname, "../data/ticket-message-map.json");

async function leerMapa() {
  try {
    const contenido = await fs.readFile(MAP_PATH, "utf8");
    return JSON.parse(contenido);
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function guardarMapa(mapa) {
  await fs.mkdir(path.dirname(MAP_PATH), { recursive: true });
  await fs.writeFile(MAP_PATH, JSON.stringify(mapa, null, 2), "utf8");
}

async function obtenerMessageIdPorTicket(ticketId) {
  const mapa = await leerMapa();
  return mapa[String(ticketId)] || null;
}

async function buscarTicketIdPorMessageId(messageId) {
  const mapa = await leerMapa();
  const entry = Object.entries(mapa).find(([, msgId]) => msgId === messageId);
  return entry ? entry[0] : null;
}

async function guardarMessageIdParaTicket(ticketId, messageId) {
  const mapa = await leerMapa();
  mapa[String(ticketId)] = messageId;
  await guardarMapa(mapa);
}

module.exports = {
  obtenerMessageIdPorTicket,
  buscarTicketIdPorMessageId,
  guardarMessageIdParaTicket,
};
