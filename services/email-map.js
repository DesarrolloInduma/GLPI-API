const fs = require("fs").promises;
const path = require("path");
const crypto = require("crypto");

const MAP_PATH = path.resolve(__dirname, "../data/ticket-message-map.json");
const LOCKS_DIR = path.resolve(__dirname, "../data/processing");

function normalizeMap(raw) {
  if (!raw || typeof raw !== "object") {
    return { messages: {}, conversations: {}, processed: {} };
  }

  if (raw.messages && raw.conversations) {
    return {
      messages: raw.messages || {},
      conversations: raw.conversations || {},
      processed: raw.processed || {},
    };
  }

  const messages = {};
  const conversations = {};
  for (const [ticketId, messageId] of Object.entries(raw)) {
    messages[String(ticketId)] = messageId;
  }

  return { messages, conversations, processed: {} };
}

async function leerMapa() {
  try {
    const contenido = await fs.readFile(MAP_PATH, "utf8");
    const raw = JSON.parse(contenido);
    return normalizeMap(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return { messages: {}, conversations: {}, processed: {} };
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
  return mapa.messages[String(ticketId)] || null;
}

async function buscarTicketIdPorMessageId(messageId) {
  if (!messageId) return null;
  const mapa = await leerMapa();
  
  // Buscar primero en mapa.processed (para mensajes de respuesta)
  if (mapa.processed && mapa.processed[String(messageId)]) {
    return mapa.processed[String(messageId)];
  }

  const entry = Object.entries(mapa.messages).find(([, msgId]) => msgId === messageId);
  return entry ? entry[0] : null;
}

async function buscarTicketIdPorConversationId(conversationId) {
  if (!conversationId) return null;
  const mapa = await leerMapa();
  return mapa.conversations[String(conversationId)] || null;
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

async function guardarMessageIdParaTicket(ticketId, messageId, conversationId) {
  const mapa = await leerMapa();
  if (!mapa.messages) mapa.messages = {};
  if (!mapa.conversations) mapa.conversations = {};

  if (messageId) {
    // No sobrescribir si ya existe un mapeo para este ticket
    if (!mapa.messages[String(ticketId)]) {
      mapa.messages[String(ticketId)] = messageId;
    }
  }

  if (conversationId) {
    // Guardar mapeo de conversación sólo si no existe (evitar sobrescribir vínculo original)
    if (!mapa.conversations[String(conversationId)]) {
      mapa.conversations[String(conversationId)] = String(ticketId);
    }
  }

  await guardarMapa(mapa);
}

async function registrarMensajeProcesado(messageId, ticketId) {
  const mapa = await leerMapa();
  if (!mapa.processed) mapa.processed = {};
  mapa.processed[String(messageId)] = String(ticketId);
  await guardarMapa(mapa);
}

module.exports = {
  obtenerMessageIdPorTicket,
  buscarTicketIdPorMessageId,
  buscarTicketIdPorConversationId,
  guardarMessageIdParaTicket,
  registrarMensajeProcesado,
  lockMessageId,
  unlockMessageId,
};

