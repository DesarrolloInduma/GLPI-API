const express = require("express");

const {
  obtenerTickets,
  crearTicket,
  crearTicketDesdeCorreo,
  procesarCorreosNoLeidos,
} = require("../controller/ticket.controller");

const router = express.Router();

router.get("/", obtenerTickets);

router.post("/", crearTicket);

router.post("/crear-ticket/correo/:id", crearTicketDesdeCorreo);

router.post("/procesar-no-leidos", procesarCorreosNoLeidos);

module.exports = router;
