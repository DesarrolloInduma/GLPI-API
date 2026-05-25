const {
  obtenerCorreos,
  obtenerCorreoPorId,
  obtenerCorreosNoLeidos,
} = require("../services/outlook.service");

async function listarCorreos(req, res) {
  try {
    const correos = await obtenerCorreos();

    res.json(correos);
  } catch (error) {
    res.status(500).json({
      error: "Error leyendo correos",
    });
  }
}

async function obtenerCorreo(req, res) {
  try {
    const correo = await obtenerCorreoPorId(req.params.id);

    res.json(correo);
  } catch (error) {
    res.status(500).json({
      error: "Error obteniendo correo",
    });
  }
}

async function listarCorreosNoLeidos(req, res) {
  try {
    const correos = await obtenerCorreosNoLeidos();

    res.json(correos);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Error leyendo correos no leídos",
    });
  }
}

module.exports = {
  listarCorreos,
  obtenerCorreo,
  listarCorreosNoLeidos,
};
