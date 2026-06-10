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
  buscarTicketIdPorMessageId,
  buscarTicketIdPorConversationId,
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

function extraerSoloRespuesta(contenido) {
  if (!contenido || typeof contenido !== "string") {
    return "Sin contenido";
  }

  let texto = contenido.trim();

  // Eliminar encabezados de correo (De:, Enviado:, Para:, Cc:, Asunto:, etc.)
  texto = texto.replace(/^[\s\S]*?(<p>)?(Buenas tardes|Buenos días|Hola|Estimado|De:|Enviado:|Para:|Cc:|Asunto:)/i, (match) => {
    const inicio = match.search(/(Buenas tardes|Buenos días|Hola|Estimado)/i);
    return inicio !== -1 ? match.substring(inicio) : match;
  });

  // Limpiar tags HTML de encabezados que no sean párrafos normales
  texto = texto.replace(/<div[^>]*style=["']?[^"']*border[^"']*["']?[^>]*>[\s\S]*?<\/div>/gi, "");
  texto = texto.replace(/<table[^>]*>[\s\S]*?<\/table>/gi, "");

  // Eliminar bloques citados (div con clases típicas de gmail, outlook, etc.)
  texto = texto.replace(/<div[^>]*class=["']?gmail_quote["']?[^>]*>[\s\S]*?<\/div>/gi, "");
  texto = texto.replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "");

  // Eliminar separadores comunes de citación
  const separators = [
    /(\r?\n)?--+\s*(Mensaje|Message|En|On|De|From)[\s\S]*$/mi,
    /(\r?\n)?-----\s*(Original|Forwarded|Mensaje|Message)[\s\S]*$/mi,
    /(\r?\n)?De:\s+[^<]*<[^>]+>[\s\S]*$/i,
  ];

  for (const sep of separators) {
    const match = texto.match(sep);
    if (match) {
      texto = texto.substring(0, match.index || 0).trim();
    }
  }

  // Limpiar espacios múltiples
  texto = texto.replace(/(\r?\n){3,}/g, "\n\n");
  texto = texto.trim();

  if (!texto || texto.length < 3) {
    return "Sin contenido";
  }

  return texto;
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

        // Verificar si es una respuesta (tiene parentMessageId o conversationId)
        if (!correo.parentMessageId && !correo.conversationId) continue;

        // Buscar el ticket asociado primero por conversationId (más confiable)
        // y luego por parentMessageId
        let ticketId = null;
        
        if (correo.conversationId) {
          ticketId = await buscarTicketIdPorConversationId(correo.conversationId);
        }
        
        if (!ticketId && correo.parentMessageId) {
          ticketId = await buscarTicketIdPorMessageId(correo.parentMessageId);
        }
        
        if (!ticketId) continue;

        // Validar que el ticket exista
        const ticket = await obtenerTicketGLPI(ticketId);
        if (!ticket?.id) continue;

        // Obtener el contenido completo de la respuesta
        const respuestaCompleta = await obtenerCorreoPorId(correo.id);
        const contenidoOriginal = respuestaCompleta.body?.content || respuestaCompleta.bodyPreview || "Sin contenido";
        const contenido = extraerSoloRespuesta(contenidoOriginal);

        // Agregar solo la respuesta al ticket
        await agregarRespuestaTicketGLPI(ticketId, contenido);

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
