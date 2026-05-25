const axios = require("axios");

async function iniciarSesionGLPI() {
  const response = await axios.get(`${process.env.GLPI_URL}/initSession`, {
    headers: {
      "Content-Type": "application/json",
      "App-Token": process.env.GLPI_APP_TOKEN,
      Authorization: `user_token ${process.env.GLPI_USER_TOKEN}`,
    },
  });

  return response.data.session_token;
}

function headersGLPI(sessionToken) {
  return {
    "Content-Type": "application/json",
    "App-Token": process.env.GLPI_APP_TOKEN,
    "Session-Token": sessionToken,
  };
}

function capitalizar(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1).toLowerCase();
}

// GLPI muestra "Nombre Apellido"; si ambos son iguales se ve duplicado
function nombreDesdeCorreo(email, nombreDisplay) {
  if (nombreDisplay?.trim()) {
    const partes = nombreDisplay.trim().split(/\s+/);
    return {
      firstname: partes[0],
      realname: partes.slice(1).join(" "),
    };
  }

  const local = email.split("@")[0];
  const partes = local.split(/[._-]/).filter(Boolean);

  if (partes.length >= 2) {
    return {
      firstname: capitalizar(partes[0]),
      realname: partes.slice(1).map(capitalizar).join(" "),
    };
  }

  return { firstname: capitalizar(local), realname: "" };
}

// Los correos están en UserEmail; criteria en GET /User devuelve resultados incorrectos
async function buscarUsuarioPorEmail(email, sessionToken) {
  const emailNorm = email.trim().toLowerCase();

  const response = await axios.get(
    `${process.env.GLPI_URL}/UserEmail?searchText[email]=${encodeURIComponent(emailNorm)}`,
    { headers: headersGLPI(sessionToken) },
  );

  const registro = (response.data || []).find(
    (item) => item.email?.toLowerCase() === emailNorm,
  );

  if (!registro?.users_id) {
    return null;
  }

  return { id: registro.users_id };
}

async function obtenerUsuario(userId, sessionToken) {
  const response = await axios.get(`${process.env.GLPI_URL}/User/${userId}`, {
    headers: headersGLPI(sessionToken),
  });

  return response.data;
}

function nombreEstaDuplicado(usuario, email) {
  const login = email.split("@")[0].toLowerCase();
  const firstname = (usuario.firstname || "").trim().toLowerCase();
  const realname = (usuario.realname || "").trim().toLowerCase();

  if (!firstname && !realname) {
    return true;
  }

  if (firstname && firstname === realname) {
    return true;
  }

  if (firstname === login || realname === login) {
    return true;
  }

  return false;
}

async function corregirNombreUsuario(
  userId,
  email,
  nombreDisplay,
  sessionToken,
) {
  const usuario = await obtenerUsuario(userId, sessionToken);

  if (!nombreEstaDuplicado(usuario, email)) {
    return userId;
  }

  const { firstname, realname } = nombreDesdeCorreo(email, nombreDisplay);

  await axios.put(
    `${process.env.GLPI_URL}/User/${userId}`,
    {
      input: {
        id: userId,
        firstname,
        realname,
      },
    },
    { headers: headersGLPI(sessionToken) },
  );

  return userId;
}

async function crearUsuario(email, sessionToken, nombreDisplay) {
  const emailNorm = email.trim().toLowerCase();
  const login = emailNorm.split("@")[0];
  const { firstname, realname } = nombreDesdeCorreo(emailNorm, nombreDisplay);

  const response = await axios.post(
    `${process.env.GLPI_URL}/User`,
    {
      input: {
        name: login,
        firstname,
        realname,
        is_active: 1,
        entities_id: 1,
      },
    },
    { headers: headersGLPI(sessionToken) },
  );

  const userId = response.data.id;

  await axios.post(
    `${process.env.GLPI_URL}/User/${userId}/UserEmail`,
    {
      input: {
        users_id: userId,
        email: emailNorm,
        is_default: 1,
      },
    },
    { headers: headersGLPI(sessionToken) },
  );

  return userId;
}

async function obtenerTicketsGLPI() {
  const sessionToken = await iniciarSesionGLPI();

  const response = await axios.get(`${process.env.GLPI_URL}/Ticket`, {
    headers: {
      "Content-Type": "application/json",
      "App-Token": process.env.GLPI_APP_TOKEN,
      "Session-Token": sessionToken,
    },
  });

  return response.data;
}

async function crearTicketGLPI(asunto, descripcion, email, nombreSolicitante) {
  const sessionToken = await iniciarSesionGLPI();

  const user = await buscarUsuarioPorEmail(email, sessionToken);

  let userId;

  if (user?.id) {
    userId = await corregirNombreUsuario(
      user.id,
      email,
      nombreSolicitante,
      sessionToken,
    );
  } else {
    userId = await crearUsuario(email, sessionToken, nombreSolicitante);
  }

  const response = await axios.post(
    `${process.env.GLPI_URL}/Ticket`,
    {
      input: {
        name: asunto,
        content: descripcion,
        priority: 3,
        entities_id: 1,
        _users_id_requester: userId,
      },
    },
    { headers: headersGLPI(sessionToken) },
  );

  return response.data;
}

module.exports = {
  obtenerTicketsGLPI,
  crearTicketGLPI,
};
