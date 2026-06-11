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

const {
  marcarSeguimientosEnviados,
} = require("../services/followup-state");

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

function stripHtml(text) {
  if (!text || typeof text !== "string") return "";
  let result = text
    .replace(/\r\n?/g, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<!--([\s\S]*?)-->/g, "")
    .replace(/<div[^>]*class=["']?gmail_quote["']?[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<div[^>]*class=["']?yahoo_quoted["']?[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "")
    .replace(/<div[^>]*style=["']?border-left:\s*1px solid #ccc["']?[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<table[^>]*>[\s\S]*?<\/table>/gi, "")
    .replace(/<(br|div|p|li|tr|header|footer|section|article)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
  return result;
}

function extraerSoloRespuesta(contenido) {
  if (!contenido) {
    return "Sin contenido";
  }

  let texto = stripHtml(contenido);
  texto = texto.replace(/\u00A0/g, " ").replace(/\t/g, " ");
  texto = texto.replace(/ +/g, " ");
  texto = texto.replace(/\n{3,}/g, "\n\n");
  texto = texto.trim();

  const lineSeparators = [
    /^-+\s*$/,
    /^_{2,}.*$/,
    /^On .*wrote:$/i,
    /^On .*escribi[oó]:$/i,
    /^From:.*$/i,
    /^Sent:.*$/i,
    /^To:.*$/i,
    /^Cc:.*$/i,
    /^Subject:.*$/i,
    /^De:.*$/i,
    /^Enviado:.*$/i,
    /^Para:.*$/i,
    /^Asunto:.*$/i,
    /^-----Original Message-----$/i,
    /^-----Mensaje Original-----$/i,
    /^Mensaje original.*$/i,
    /^Asunto del ticket:.*$/i,
    /^Por favor confirme si la solución proporcionada.*$/i,
    /^Se agregó una respuesta a tu caso.*$/i,
    /^This message was sent.*$/i,
    /^>.*$/,
    /^\|.*$/
  ];

  const lines = texto.split(/\n/);
  let cutIndex = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    for (const sep of lineSeparators) {
      if (sep.test(line)) {
        cutIndex = i;
        break;
      }
    }

    if (cutIndex !== lines.length) {
      break;
    }
  }

  let resultado = lines.slice(0, cutIndex).join("\n").trim();
  resultado = resultado.replace(/\n{3,}/g, "\n\n");
  resultado = resultado.replace(/^\s+|\s+$/g, "");

  if (!resultado) {
    return "Sin contenido";
  }

  return resultado;
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
        const seguimiento = await agregarRespuestaTicketGLPI(ticketId, contenido);

        // Marcar el seguimiento entrante como ya enviado a correo
        if (seguimiento?.id) {
          marcarSeguimientosEnviados([`followup:${seguimiento.id}`]);
        }

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
