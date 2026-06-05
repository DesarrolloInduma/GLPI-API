const fs = require("fs").promises;
const path = require("path");
const crypto = require("crypto");

const MAP_PATH = path.resolve(__dirname, "../data/ticket-message-map.json");
const LOCKS_DIR = path.resolve(__dirname, "../data/processing");

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

function obtenerLockPath(messageId) {
  const hash = crypto.createHash("sha256").update(String(messageId)).digest("hex");
  return path.join(LOCKS_DIR, `${hash}.lock`);
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

async function lockMessageId(messageId) {
  await fs.mkdir(LOCKS_DIR, { recursive: true });
  const lockPath = obtenerLockPath(messageId);
  const handle = await fs.open(lockPath, "wx");
  await handle.close();
  return lockPath;
}

async function unlockMessageId(messageId) {
  const lockPath = obtenerLockPath(messageId);
  try {
    await fs.unlink(lockPath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
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
  lockMessageId,
  unlockMessageId,
};
