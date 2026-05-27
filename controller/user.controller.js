const {
  obtenerUsersGLPI,
  obtenerUsersConEmailsGLPI,
  buscarUsuarioGLPIPorEmail,
  obtenerUsuarioGLPIPorId,
} = require("../services/glpi");

async function obtenerUsers(req, res) {
  try {
    // GLPI: GET /User no trae el email; para eso hay que consultar UserEmail.
    // Por rendimiento, aquí devolvemos los emails solo para los primeros N usuarios.
    const includeEmails =
      req.query.includeEmails === undefined ||
      req.query.includeEmails === "true";
    const limit = Number.parseInt(req.query.limit || "50", 10);

    const users = includeEmails
      ? await obtenerUsersConEmailsGLPI(limit)
      : await obtenerUsersGLPI();
    return res.json({ ok: true, users });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}

async function buscarUserPorEmail(req, res) {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({
        ok: false,
        error: "Falta query param 'email'",
      });
    }

    const user = await buscarUsuarioGLPIPorEmail(String(email));

    if (!user) {
      return res.status(404).json({
        ok: false,
        error: "No existe usuario con ese email en GLPI",
      });
    }

    return res.json({ ok: true, user });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}

async function obtenerUserPorId(req, res) {
  try {
    const { id } = req.params;
    const user = await obtenerUsuarioGLPIPorId(id);
    return res.json({ ok: true, user });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}

module.exports = {
  obtenerUsers,
  buscarUserPorEmail,
  obtenerUserPorId,
};

