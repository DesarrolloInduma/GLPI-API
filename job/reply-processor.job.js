const cron = require("node-cron");
const fs = require("fs").promises;
const path = require("path");

const {
  obtenerCorreos,
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
  registrarMensajeProcesado,
} = require("../services/email-map");

const {
  marcarSeguimientosEnviados,
} = require("../services/followup-state");

const PROCESSED_REPLIES_PATH = path.resolve(__dirname, "../data/processed-replies.json");

async function leerRepliesProcessadas() {
  try {
    const contenido = await fs.readFile(PROCESSED_REPLIES_PATH, "utf8");
    return JSON.parse(contenido);
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function guardarRepliesProcessadas(mapa) {
  await fs.mkdir(path.dirname(PROCESSED_REPLIES_PATH), { recursive: true });
  await fs.writeFile(PROCESSED_REPLIES_PATH, JSON.stringify(mapa, null, 2));
}

// ==================== LIMPIEZA MEJORADA ====================

function stripHtml(text) {
  if (!text || typeof text !== "string") return "";
  
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<div[^>]*class=["']?(gmail_quote|yahoo_quoted|gmail_extra|moz-cite-prefix)["']?[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "")
    .replace(/<div[^>]*style=["']?border-left[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<table[\s\S]*?<\/table>/gi, "")
    .replace(/<(br|div|p|li|tr|header|footer|section|article)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extraerSoloRespuesta(contenido) {
  if (!contenido) return "Sin contenido";

  let texto = stripHtml(contenido);
  texto = texto.replace(/\u00A0/g, " ").replace(/\t/g, " ");
  texto = texto.replace(/ +/g, " ");
  texto = texto.replace(/\n{3,}/g, "\n\n").trim();

  const separadores = [
    /^-+\s*$/,
    /^_{2,}/,
    /^On .*wrote:$/i,
    /^El .*escribió:$/i,
    /^On .*escribi[oó]:$/i,
    /^From:/i,
    /^De:/i,
    /^Sent:/i,
    /^Enviado:/i,
    /^To:/i,
    /^Para:/i,
    /^Subject:/i,
    /^Asunto:/i,
    /^-----Original Message-----/i,
    /^-----Mensaje Original-----/i,
    /^>.*$/m,
    /^\|.*$/m,
    /^Se agregó una respuesta a tu caso/i,
    /^This message was sent from/i,
    /INDUMA.*Siempre en tu Casa/i,           // Firma específica
    /practicante\.infra@induma\.com\.co/i,   // Correo de firma
    /Km1 Via Termales El Otoño/i
  ];

  const lines = texto.split("\n");
  let cutIndex = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (separadores.some(sep => sep.test(line))) {
      cutIndex = i;
      break;
    }
  }

  let respuesta = lines.slice(0, cutIndex).join("\n").trim();

  // Eliminar saludos cortos y firmas comunes al final
  respuesta = respuesta
    .replace(/\b(hola|buenos?\s+(d[ií]as|tardes|noches)|saludos|gracias|ok|entendido|cordialmente)\b/gi, "")
    .trim();

  return respuesta.length > 8 ? respuesta : "Sin contenido";
}

// ==================== PROCESAMIENTO ====================

async function procesarRepliesNuevas() {
  try {
    const [correosNoLeidos, correosRecientes] = await Promise.all([
      obtenerCorreosNoLeidos(),
      obtenerCorreos()
    ]);

    const repliesProcessadas = await leerRepliesProcessadas();
    const procesadosEstaVez = new Set();

    const correosMap = new Map();
    [...(correosRecientes?.value || correosRecientes || []), ...correosNoLeidos]
      .forEach(c => c?.id && correosMap.set(c.id, c));

    for (const correo of correosMap.values()) {
      if (!correo.id || repliesProcessadas[correo.id] || procesadosEstaVez.has(correo.id)) continue;

      // FILTRO CLAVE: Solo procesar respuestas
      if (!correo.parentMessageId && !correo.conversationId) continue;

      // Filtrar correos internos (ajusta según tu dominio)
      const fromEmail = correo.from?.emailAddress?.address || "";
      if (fromEmail.includes("@induma.com.co") && fromEmail.includes("practica") === false) { // permite practicantes si quieres
        console.log(`[REPLY] Correo interno ignorado: ${correo.id}`);
        continue;
      }

      let ticketId = null;
      if (correo.parentMessageId) {
        ticketId = await buscarTicketIdPorMessageId(correo.parentMessageId);
      }
      if (!ticketId && correo.conversationId) {
        ticketId = await buscarTicketIdPorConversationId(correo.conversationId);
      }

      if (!ticketId) {
        console.log(`[REPLY] No se encontró ticket para correo ${correo.id}`);
        continue;
      }

      const ticket = await obtenerTicketGLPI(ticketId);
      if (!ticket?.id) continue;

      const fullMail = await obtenerCorreoPorId(correo.id);
      const contenidoOriginal = fullMail.body?.content || fullMail.bodyPreview || "";
      const contenido = extraerSoloRespuesta(contenidoOriginal);

      if (contenido === "Sin contenido" || contenido.length < 10) {
        console.log(`[REPLY] Contenido trivial ignorado: ${correo.id}`);
        await marcarCorreoLeido(correo.id);
        repliesProcessadas[correo.id] = new Date().toISOString();
        await guardarRepliesProcessadas(repliesProcessadas);
        continue;
      }

      const seguimiento = await agregarRespuestaTicketGLPI(ticketId, contenido);

      if (seguimiento?.id) {
        marcarSeguimientosEnviados([`followup:${seguimiento.id}`]);
        try {
          await registrarMensajeProcesado(correo.id, ticketId);
        } catch (err) {
          console.warn(`No se pudo registrar mensaje:`, err.message);
        }
      }

      await marcarCorreoLeido(correo.id);
      repliesProcessadas[correo.id] = new Date().toISOString();
      procesadosEstaVez.add(correo.id);

      await guardarRepliesProcessadas(repliesProcessadas);

      console.log(`✅ Respuesta procesada correctamente → Ticket #${ticketId} | Correo ${correo.id}`);
    }
  } catch (error) {
    console.error("Error en procesador de respuestas:", error.message);
  }
}

function iniciarJobReplies() {
  console.log("🚀 Monitor de respuestas de usuario iniciado...");
  procesarRepliesNuevas();
  cron.schedule("* * * * *", () => procesarRepliesNuevas().catch(console.error));
}

module.exports = {
  iniciarJobReplies,
  procesarRepliesNuevas,
};