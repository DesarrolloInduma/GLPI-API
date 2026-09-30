const { enviarCorreo } = require("./outlook.service");
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

function contenidoTicketComoTexto(contenido) {
  const entidades = {
    "&nbsp;": " ",
    "&#160;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
  };

  return String(contenido || "Sin descripción")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;|&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/gi, (entidad) => entidades[entidad.toLowerCase()])
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

  const mensajeTicket = escaparHtml(contenidoTicketComoTexto(contenidoTicket));
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
  obtenerNombreTecnico,
  notificarCreacionTicket,
  notificarTecnicoAsignado,
  notificarAsignacionSolicitante,
};