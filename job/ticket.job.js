const cron = require("node-cron");

const {
  procesarCorreosNoLeidos
} = require(
  "../controller/ticket.controller"
);

function iniciarJobTickets() {

  cron.schedule(
    "*/5 * * * *",
    async () => {

      console.log(
        "Procesando correos..."
      );

      try {

        await procesarCorreosNoLeidos();

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