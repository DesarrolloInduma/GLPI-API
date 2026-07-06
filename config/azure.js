require("dotenv").config();

const msal = require("@azure/msal-node");

function buildClient() {
  const clientId = process.env.OUTLOOK_CLIENT_ID;
  const tenantId = process.env.OUTLOOK_TENANT_ID;
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET;

  if (!clientId || !tenantId || !clientSecret) {
    console.warn(
      "⚠️ Credenciales de Outlook no configuradas. Define OUTLOOK_CLIENT_ID, OUTLOOK_TENANT_ID y OUTLOOK_CLIENT_SECRET en el archivo .env para habilitar Microsoft Graph."
    );
    return null;
  }

  const msalConfig = {
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      clientSecret,
    },
  };

  return new msal.ConfidentialClientApplication(msalConfig);
}

const cca = buildClient();

module.exports = cca || { isConfigured: false };
module.exports.isConfigured = Boolean(cca);