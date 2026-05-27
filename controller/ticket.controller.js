const {
  obtenerTicketsGLPI,
  crearTicketGLPI,
  obtenerUsersGLPI,
  buscarUsuarioGLPIPorEmail,
  buscarUsuarioGLPIPorLogin,
  agregarUsuarioATicket,
} = require("../services/glpi");

const {
  obtenerCorreoPorId,
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

        const destinatarios = Array.isArray(correo.toRecipients)
          ? correo.toRecipients
          : [];

        const outlookUserLower = String(process.env.OUTLOOK_USER || "")
          .trim()
          .toLowerCase();

        const tecnico = destinatarios.find((d) => {
          const addr = d?.emailAddress?.address;
          if (!addr) return false;
          const addrLower = String(addr).trim().toLowerCase();
          if (!addrLower) return false;
          // Elegimos el primer "to" que no sea el buzón que está leyendo
          return outlookUserLower ? addrLower !== outlookUserLower : true;
        });

        const correoTecnico = tecnico?.emailAddress?.address;

        let tecnicoId = 0;
        let metodoAsignacion = "none";

        if (correoTecnico) {
          // 1) Intentar por email (UserEmail)
          const usuarioGLPI = await buscarUsuarioGLPIPorEmail(correoTecnico);
          tecnicoId = usuarioGLPI?.id || 0;
          if (tecnicoId) metodoAsignacion = "email";

          // 2) Fallback: si en GLPI el usuario no tiene correo, buscar por login (antes del @)
          if (!tecnicoId) {
            const login = String(correoTecnico).split("@")[0]?.trim();
            if (login) {
              const userByLogin = await buscarUsuarioGLPIPorLogin(login);
              tecnicoId = userByLogin?.id || 0;
              if (tecnicoId) metodoAsignacion = "login";
            }
          }
        }

        const ticket = await crearTicketGLPI(
          asunto,
          descripcion,
          email,
          nombreSolicitante,
          tecnicoId,
        );

        // Reglas: si se asigna a X, también asignar a Y
        const asignacionDoble = {
          7: 52,
          37: 53,
          55: 63,
        };

        const adicionalId = asignacionDoble[tecnicoId] || 0;
        let asignadoAdicional = false;
        let errorAsignadoAdicional;

        if (adicionalId && ticket?.id) {
          try {
            await agregarUsuarioATicket(ticket.id, adicionalId, 2);
            asignadoAdicional = true;
          } catch (error) {
            asignadoAdicional = false;
            errorAsignadoAdicional =
              error.response?.data?.error?.message || error.message;
          }
        }

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
          autoAsignado: tecnicoId !== 0,
          correoTecnico: correoTecnico || null,
          tecnicoId,
          metodoAsignacion,
          ...(adicionalId
            ? { asignadoAdicionalId: adicionalId, asignadoAdicional }
            : {}),
          ...(errorAsignadoAdicional && { errorAsignadoAdicional }),
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

async function obtenerUsers(req, res) {
  try {
    const tickets = await obtenerUsersGLPI();

    res.json({
      ok: true,
      tickets,
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
  obtenerUsers,
};
