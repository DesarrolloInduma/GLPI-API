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

// Rutas
const ticketRoutes = require("./routes/ticket.routes");
const outlookRoutes = require("./routes/outlook.routes");
const userRoutes = require("./routes/user.routes");

// Jobs
const { iniciarJobTickets } = require("./job/ticket.job");
const { iniciarJobSeguimientos } = require("./job/followup-mailer.job");
const { iniciarJobReplies } = require("./job/reply-processor.job");

console.log("🚀 Servicio iniciado...");

// Middlewares
app.use(express.json());

// Endpoints
app.use("/api/tickets", ticketRoutes);
app.use("/api/correos", outlookRoutes);
app.use("/api/users", userRoutes);

// 🔹 Iniciar jobs SOLO UNA VEZ
function iniciarJobs() {
  console.log("🧾 Iniciando monitor de tickets...");
  iniciarJobTickets();

  console.log("📩 Iniciando monitor de seguimientos GLPI...");
  iniciarJobSeguimientos();

  console.log("💬 Iniciando procesador de respuestas de usuario...");
  iniciarJobReplies(); // ← ACTÍVALO si ya lo corregiste
}

// Ruta base
app.get("/", (req, res) => {
  res.send("GLPI Job Running ✅");
});

// Levantar servidor y luego iniciar jobs
app.listen(PORT, () => {
  console.log(`🌐 Servidor escuchando en puerto ${PORT}`);
  
  iniciarJobs(); // ← IMPORTANTE: iniciar después de levantar server
});