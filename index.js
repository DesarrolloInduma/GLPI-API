/*require("dotenv").config();

const express = require("express");

const ticketRoutes =
  require("./routes/ticket.routes");

const outlookRoutes =
  require("./routes/outlook.routes");

const userRoutes =
  require("./routes/user.routes");

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

app.use(
  "/api/tickets",
  ticketRoutes
);

app.use(
  "/api/correos",
  outlookRoutes
);

app.use(
  "/api/users",
  userRoutes
);

app.listen(PORT, () => {
  console.log(
    `API ejecutándose en puerto ${PORT}`
  );
});
*/
require("dotenv").config();

const express = require("express");
const app = express();

const PORT = process.env.PORT || 3000;

const ticketRoutes = require("./routes/ticket.routes");
const outlookRoutes = require("./routes/outlook.routes");
const userRoutes = require("./routes/user.routes");

const {
  iniciarJobTickets
} = require("./job/ticket.job");

const {
  iniciarJobSeguimientos
} = require("./job/followup-mailer.job");

console.log("Servicio iniciado...");

app.use(express.json());

app.use(
  "/api/tickets",
  ticketRoutes
);

app.use(
  "/api/correos",
  outlookRoutes
);

app.use(
  "/api/users",
  userRoutes
);

iniciarJobTickets();
iniciarJobSeguimientos();

app.get("/", (req, res) => {
  res.send("GLPI Job Running");
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en ${PORT}`);
});
