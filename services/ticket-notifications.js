const { enviarCorreo } = require("./outlook.service");
const sanitizeHtml = require("sanitize-html");
const {
  obtenerCorreoUsuarioGLPI,
  obtenerNombreUsuarioGLPI,
} = require("./glpi");
const {
  TECNICOS_PERMITIDOS,
  CORREOS_TECNICOS,
} = require("../config/tickets");

function escaparHtml(valor) {
  return String(valor || "").replace(/[&<>"']/g, (caracter) => {
    const entidades = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entidades[caracter];
  });
}

function sanitizarContenidoTicket(contenido) {
  const html = String(contenido || "Sin descripción");
  if (!/<[a-z][^>]*>/i.test(html)) {
    return escaparHtml(html).replace(/\r?\n/g, "<br>");
  }

  return sanitizeHtml(html, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      "img",
      "table",
      "thead",
      "tbody",
      "tfoot",
      "tr",
      "td",
      "th",
      "span",
      "font",
      "center",
      "hr",
    ],
    allowedAttributes: {
      a: ["href", "name", "target", "style"],
      img: ["src", "alt", "title", "width", "height", "style"],
      table: ["width", "border", "cellpadding", "cellspacing", "style"],
      td: ["colspan", "rowspan", "width", "height", "align", "valign", "style"],
      th: ["colspan", "rowspan", "width", "height", "align", "valign", "style"],
      tr: ["align", "valign", "style"],
      "*": ["style"],
    },
    allowedStyles: {
      "*": {
        color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d.,% ]+\)$/i, /^[a-z]+$/i],
        "background-color": [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d.,% ]+\)$/i, /^[a-z]+$/i],
        "font-family": [/^[\w\s,"'-]+$/],
        "font-size": [/^\d+(?:px|pt|em|rem|%)$/i],
        "font-weight": [/^(normal|bold|[1-9]00)$/i],
        "font-style": [/^(normal|italic|oblique)$/i],
        "text-decoration": [/^(none|underline|line-through)$/i],
        "text-align": [/^(left|right|center|justify)$/i],
        "vertical-align": [/^(top|middle|bottom|baseline)$/i],
        "white-space": [/^(normal|pre|pre-wrap|nowrap)$/i],
        width: [/^\d+(?:px|%|em)$/i],
        height: [/^\d+(?:px|%|em)$/i],
      },
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
  });
}

async function obtenerNombreTecnico(tecnicoId) {
  if (!TECNICOS_PERMITIDOS.includes(Number(tecnicoId))) return null;

  try {
    return (
      (await obtenerNombreUsuarioGLPI(tecnicoId)) || `Técnico #${tecnicoId}`
    );
  } catch (error) {
    console.warn(
      `No se pudo consultar el nombre del técnico ${tecnicoId}:`,
      error.message
    );
    return `Técnico #${tecnicoId}`;
  }
}

async function notificarCreacionTicket(email, ticketId, asunto, nombreTecnico) {
  if (!email || email === "sin-correo") return false;

  const detalleTecnico = nombreTecnico
    ? `<p><strong>Técnico asignado:</strong> ${escaparHtml(nombreTecnico)}</p>`
    : "";

  await enviarCorreo(
    email,
    `Caso creado - Ticket #${ticketId}`,
    `<p>Tu caso fue creado correctamente.</p><p>El número de tu ticket es <strong>#${ticketId}</strong>.</p><p><strong>Asunto:</strong> ${escaparHtml(asunto || "Sin asunto")}</p>${detalleTecnico}`
  );
  return true;
}

async function notificarTecnicoAsignado(ticketId, tecnicoId, asunto, contenidoTicket) {
  if (!TECNICOS_PERMITIDOS.includes(Number(tecnicoId))) return false;

  const correoRegistrado = await obtenerCorreoUsuarioGLPI(tecnicoId);
  const correo = correoRegistrado || CORREOS_TECNICOS[Number(tecnicoId)];
  if (!correo) {
    console.warn(`No se encontró correo registrado para el técnico ${tecnicoId}`);
    return false;
  }
  if (!correoRegistrado) {
    console.warn(`Usando correo configurado para el técnico ${tecnicoId} porque GLPI no tiene uno registrado`);
  }

  const mensajeTicket = sanitizarContenidoTicket(contenidoTicket);
  await enviarCorreo(
    correo,
    `Ticket #${ticketId} asignado: ${asunto || "Sin asunto"}`,
    `<p>Se te ha asignado el ticket <strong>#${ticketId}</strong>.</p><p><strong>Asunto:</strong> ${escaparHtml(asunto || "Sin asunto")}</p><p><strong>Mensaje del ticket:</strong></p><pre style="white-space: pre-wrap; font-family: inherit;">${mensajeTicket}</pre>`
  );
  return true;
}

async function notificarAsignacionSolicitante(email, ticketId, asunto, nombreTecnico) {
  if (!email || email === "sin-correo") return false;

  await enviarCorreo(
    email,
    `Actualización del ticket #${ticketId}: técnico asignado`,
    `<p>Tu caso <strong>#${ticketId}</strong> ya tiene un técnico asignado.</p><p><strong>Técnico:</strong> ${escaparHtml(nombreTecnico)}</p><p><strong>Asunto:</strong> ${escaparHtml(asunto || "Sin asunto")}</p>`
  );
  return true;
}

module.exports = {
  sanitizarContenidoTicket,
  obtenerNombreTecnico,
  notificarCreacionTicket,
  notificarTecnicoAsignado,
  notificarAsignacionSolicitante,
};