const express = require("express");

const {
  obtenerTickets,
  crearTicket,
  crearTicketDesdeCorreo,
  procesarCorreosNoLeidos,
  obtenerUsers,
} = require("../controller/ticket.controller");

const router = express.Router();

router.get("/", obtenerTickets);

router.get("/users", obtenerUsers);

router.post("/", crearTicket);

router.post("/crear-ticket/correo/:id", crearTicketDesdeCorreo);

router.post("/procesar-no-leidos", procesarCorreosNoLeidos);

module.exports = router;
