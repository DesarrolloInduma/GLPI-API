const cron = require("node-cron");

const {
  procesarCorreosNoLeidos
} = require(
  "../controller/ticket.controller"
);

function iniciarJobTickets() {

  cron.schedule(
    "* * * * *",
    async () => {

      console.log(
        "Procesando correos..."
      );

      try {

        const resultados = await procesarCorreosNoLeidos();

        if (!resultados.length) {
          console.log("No hay correos nuevos para procesar");
        }

        for (const resultado of resultados) {
          if (resultado.tipo !== "NUEVO") continue;

          console.log(`Estado de notificaciones del ticket #${resultado.ticketId}:`, {
            remitente: resultado.notificacionSolicitanteEnviada
              ? "aceptada"
              : "no enviada",
            tecnicoId: resultado.tecnicoId || null,
            tecnico: resultado.notificacionTecnicoEnviada
              ? "aceptada"
              : "no enviada",
          });
        }

        console.log(
          "Proceso completado"
        );

      } catch (error) {

        console.error(error);
      }
    }
  );
}

module.exports = {
  iniciarJobTickets
};