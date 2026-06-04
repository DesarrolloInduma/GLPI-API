const cron = require("node-cron");
const {
  obtenerCorreosNoLeidos,
  marcarCorreoLeido,
  obtenerCorreoPorId,
} = require("../services/outlook.service");

const {
  agregarRespuestaTicketGLPI,
  obtenerTicketGLPI,
} = require("../services/glpi");

const {
  obtenerMessageIdPorTicket,
} = require("../services/email-map");

const fs = require("fs").promises;
const path = require("path");

const PROCESSED_REPLIES_PATH = path.resolve(__dirname, "../data/processed-replies.json");

async function leerRepliesProcessadas() {
  try {
    const contenido = await fs.readFile(PROCESSED_REPLIES_PATH, "utf8");
    return JSON.parse(contenido);
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function guardarRepliesProcessadas(mapa) {
  await fs.mkdir(path.dirname(PROCESSED_REPLIES_PATH), { recursive: true });
  await fs.writeFile(PROCESSED_REPLIES_PATH, JSON.stringify(mapa, null, 2), "utf8");
}

async function buscarTicketIdPorMessageId(messageId) {
  try {
    const mapPath = path.resolve(__dirname, "../data/ticket-message-map.json");
    const contenido = await fs.readFile(mapPath, "utf8");
    const mapa = JSON.parse(contenido);
    
    // Buscar por messageId exacto
    for (const [ticketId, msgId] of Object.entries(mapa)) {
      if (msgId === messageId) {
        return ticketId;
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

async function procesarRepliesNuevas() {
  try {
    const correos = await obtenerCorreosNoLeidos();
    const repliesProcessadas = await leerRepliesProcessadas();

    for (const correo of correos) {
      try {
        if (!correo.id) continue;
        
        // Si ya fue procesada, saltar
        if (repliesProcessadas[correo.id]) continue;

        // Verificar si es una respuesta (tiene parentMessageId)
        if (!correo.parentMessageId) continue;

        // Buscar el ticket asociado al mensaje padre
        const ticketId = await buscarTicketIdPorMessageId(correo.parentMessageId);
        if (!ticketId) continue;

        // Validar que el ticket exista
        const ticket = await obtenerTicketGLPI(ticketId);
        if (!ticket?.id) continue;

        // Obtener el contenido completo de la respuesta
        const respuestaCompleta = await obtenerCorreoPorId(correo.id);
        const contenido = respuestaCompleta.body?.content || respuestaCompleta.bodyPreview || "Sin contenido";
        
        const remitente = respuestaCompleta.from?.emailAddress?.name || 
                         respuestaCompleta.from?.emailAddress?.address || 
                         "Desconocido";

        // Agregar como seguimiento al ticket
        await agregarRespuestaTicketGLPI(
          ticketId,
          `<p><strong>De:</strong> ${remitente}</p><p><strong>Fecha:</strong> ${respuestaCompleta.receivedDateTime}</p><hr>${contenido}`
        );

        // Marcar como leído
        await marcarCorreoLeido(correo.id);

        // Guardar como procesada
        repliesProcessadas[correo.id] = new Date().toISOString();
        await guardarRepliesProcessadas(repliesProcessadas);

        console.log(`Respuesta al ticket #${ticketId} procesada desde correo ${correo.id}`);
      } catch (error) {
        console.error(`Error procesando respuesta ${correo.id}:`, error.message);
      }
    }
  } catch (error) {
    console.error("Error en procesador de respuestas:", error.message);
  }
}

function iniciarJobReplies() {
  console.log("Iniciando monitor de respuestas de usuario...");

  procesarRepliesNuevas()
    .then(() => {
      cron.schedule("* * * * *", async () => {
        try {
          await procesarRepliesNuevas();
        } catch (error) {
          console.error("Error en monitor de respuestas de usuario:", error.message);
        }
      });
    })
    .catch((error) => {
      console.error("Error inicializando monitor de respuestas de usuario:", error.message);
    });
}

module.exports = {
  iniciarJobReplies,
  procesarRepliesNuevas,
};
