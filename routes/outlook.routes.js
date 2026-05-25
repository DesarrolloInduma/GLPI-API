const express = require("express");

const {
  listarCorreos,
  obtenerCorreo,
  listarCorreosNoLeidos,
} = require("../controller/outlook.controller");

const router = express.Router();

router.get("/", listarCorreos);

router.get("/no-leidos", listarCorreosNoLeidos);

router.get("/:id", obtenerCorreo);

module.exports = router;
