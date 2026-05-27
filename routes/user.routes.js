const express = require("express");

const {
  obtenerUsers,
  buscarUserPorEmail,
  obtenerUserPorId,
} = require("../controller/user.controller");

const router = express.Router();

// Lista usuarios (GLPI /User)
router.get("/", obtenerUsers);

// Buscar por correo: /api/users/buscar?email=...
router.get("/buscar", buscarUserPorEmail);

// Obtener usuario por id: /api/users/123
router.get("/:id", obtenerUserPorId);

module.exports = router;

