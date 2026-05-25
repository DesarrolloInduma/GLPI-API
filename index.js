require("dotenv").config();

const express = require("express");

const ticketRoutes =
  require("./routes/ticket.routes");

const outlookRoutes =
  require("./routes/outlook.routes");

const app = express();

app.use(express.json());

const PORT = 3000;

app.use(
  "/api/tickets",
  ticketRoutes
);

app.use(
  "/api/correos",
  outlookRoutes
);

app.listen(PORT, () => {
  console.log(
    `API ejecutándose en puerto ${PORT}`
  );
});