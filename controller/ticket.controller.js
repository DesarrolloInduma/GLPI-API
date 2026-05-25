const { obtenerTicketsGLPI, crearTicketGLPI } = require("../services/glpi");

const { obtenerCorreoPorId } = require("../services/outlook.service");

const {
  obtenerCorreosNoLeidos,
  marcarCorreoLeido,
} = require("../services/outlook.service");

async function obtenerTickets(req, res) {
  try {
    const tickets = await obtenerTicketsGLPI();

    return res.json({
      ok: true,
      tickets,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
}

async function crearTicket(req, res) {
  try {
    const { asunto, descripcion } = req.body;

    const ticket = await crearTicketGLPI(asunto, descripcion);

    return res.json({
      ok: true,
      ticket,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
}

async function crearTicketDesdeCorreo(req, res) {
  try {
    const { id } = req.params;

    const correo = await obtenerCorreoPorId(id);

    const asunto = correo.subject || "Sin asunto";
    const descripcion = correo.bodyPreview || "Sin contenido";

    const email =
      correo.from?.emailAddress?.address ||
      correo.sender?.emailAddress?.address ||
      "sin-correo";

    const nombreSolicitante =
      correo.from?.emailAddress?.name || correo.sender?.emailAddress?.name;

    const ticket = await crearTicketGLPI(
      asunto,
      descripcion,
      email,
      nombreSolicitante,
    );

    return res.json({
      ok: true,
      correo: {
        id: correo.id,
        asunto,
        email,
      },
      ticket,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
}

async function procesarCorreosNoLeidos(req, res) {
  try {
    const correos = await obtenerCorreosNoLeidos();

    const resultados = [];

    for (const correo of correos) {
      try {
        const asunto = correo.subject || "Sin asunto";

        const descripcion = correo.bodyPreview || "Sin contenido";

        const email =
          correo.from?.emailAddress?.address ||
          correo.sender?.emailAddress?.address ||
          "sin-correo";

        const nombreSolicitante =
          correo.from?.emailAddress?.name || correo.sender?.emailAddress?.name;

        const ticket = await crearTicketGLPI(
          asunto,
          descripcion,
          email,
          nombreSolicitante,
        );

        let correoMarcadoLeido = true;
        let errorMarcarLeido;

        try {
          await marcarCorreoLeido(correo.id);
        } catch (error) {
          correoMarcadoLeido = false;
          errorMarcarLeido =
            error.response?.data?.error?.message || error.message;
        }

        resultados.push({
          correoId: correo.id,
          asunto,
          ticket,
          estado: "OK",
          correoMarcadoLeido,
          ...(errorMarcarLeido && { errorMarcarLeido }),
        });
      } catch (error) {
        resultados.push({
          correoId: correo.id,
          estado: "ERROR",
          error: error.message,
        });
      }
    }

    res.json({
      ok: true,
      procesados: resultados.length,
      resultados,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
}

module.exports = {
  obtenerTickets,
  crearTicket,
  crearTicketDesdeCorreo,
  procesarCorreosNoLeidos,
};
