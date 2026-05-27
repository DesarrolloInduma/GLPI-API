require("dotenv").config();

console.log("CLIENT ID:");
console.log(process.env.OUTLOOK_CLIENT_ID);

console.log("TENANT ID:");
console.log(process.env.OUTLOOK_TENANT_ID);

console.log("CLIENT SECRET:");
console.log(process.env.OUTLOOK_CLIENT_SECRET);

const msal = require("@azure/msal-node");

const msalConfig = {
  auth: {
    clientId: process.env.OUTLOOK_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${process.env.OUTLOOK_TENANT_ID}`,
    clientSecret: process.env.OUTLOOK_CLIENT_SECRET,
  },
};

const cca = new msal.ConfidentialClientApplication(msalConfig);

module.exports = cca;