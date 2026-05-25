const axios = require("axios");
const cca = require("../config/azure");

async function getAccessToken() {
  const tokenRequest = {
    scopes: ["https://graph.microsoft.com/.default"],
  };

  const response = await cca.acquireTokenByClientCredential(tokenRequest);
  return response.accessToken;
}

async function obtenerCorreos() {
  try {
    const token = await getAccessToken();

    const response = await axios.get(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(process.env.OUTLOOK_USER)}/messages`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    return response.data;
  } catch (error) {
    console.error(error.response?.data || error.message);
    throw error;
  }
}

async function obtenerCorreoPorId(id) {
  try {
    const token = await getAccessToken();

    const response = await axios.get(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(process.env.OUTLOOK_USER)}/messages/${id}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    return response.data;
  } catch (error) {
    console.error(error.response?.data || error.message);
    throw error;
  }
}

async function obtenerCorreosNoLeidos() {
  try {
    const token = await getAccessToken();

    const response = await axios.get(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(process.env.OUTLOOK_USER)}/messages?$filter=isRead eq false&$top=3`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    return response.data.value ?? [];
  } catch (error) {
    console.error(error.response?.data || error.message);
    throw error;
  }
}

async function marcarCorreoLeido(id) {
  try {
    const token = await getAccessToken();

    await axios.patch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(process.env.OUTLOOK_USER)}/messages/${id}`,
      {
        isRead: true,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,

          "Content-Type": "application/json",
        },
      },
    );
  } catch (error) {
    console.error(error.response?.data || error.message);

    throw error;
  }
}

module.exports = {
  obtenerCorreos,
  obtenerCorreoPorId,
  obtenerCorreosNoLeidos,
  marcarCorreoLeido,
};
