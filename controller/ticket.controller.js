const {
  crearTicketGLPI,
  obtenerTicketGLPI,
  agregarUsuarioATicket,
  agregarRespuestaTicketGLPI,
} = require("../services/glpi.service");

// 🔥 CREAR TICKET
async function crearTicket(req, res) {
  try {
    const { asunto, descripcion, email, nombre } = req.body;

    const ticket = await crearTicketGLPI(
      asunto,
      descripcion,
      email,
      nombre
    );

    const ticketId = ticket.id;

    // 🔥 OBTENER TÉCNICO ASIGNADO POR GLPI
    const ticketData = await obtenerTicketGLPI(ticketId);
    const tecnicoAsignado = ticketData.users_id_assign;

    // 🔥 REGLAS PERSONALIZADAS
    const reglas = {
      7: 52,
      37: 53,
      55: 63,
    };

    if (reglas[tecnicoAsignado]) {
      await agregarUsuarioATicket(
        ticketId,
        reglas[tecnicoAsignado],
        2 // tipo técnico
      );
    }

    return res.json({
      ok: true,
      ticket,
    });
  } catch (error) {
    console.error("ERROR crearTicket:", error.message);

    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
}

// 🔥 RESPONDER TICKET (SIN BUCLE)
async function responderTicket(req, res) {
  try {
    const { ticketId, mensaje } = req.body;

    if (!ticketId || !mensaje) {
      return res.status(400).json({
        ok: false,
        error: "ticketId y mensaje son requeridos",
      });
    }

    // 🔥 AGREGA RESPUESTA SIN NOTIFICAR (EVITA BUCLE)
    await agregarRespuestaTicketGLPI(ticketId, mensaje);

    return res.json({
      ok: true,
      message: "Respuesta agregada correctamente",
    });
  } catch (error) {
    console.error("ERROR responderTicket:", error.message);

    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
}

module.exports = {
  crearTicket,
  responderTicket,
};