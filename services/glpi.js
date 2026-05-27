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

async function buscarUsuarioPorEmail(email, sessionToken) {
  const emailNorm = email.trim().toLowerCase();

  const response = await axios.get(
    `${process.env.GLPI_URL}/UserEmail?searchText[email]=${encodeURIComponent(emailNorm)}`,
    { headers: headersGLPI(sessionToken) }
  );

  const registro = (response.data || []).find(
    (item) => item.email?.toLowerCase() === emailNorm
  );

  if (!registro?.users_id) return null;

  return { id: registro.users_id };
}

async function buscarUsuarioGLPIPorEmail(email) {
  const sessionToken = await iniciarSesionGLPI();
  return await buscarUsuarioPorEmail(email, sessionToken);
}

async function buscarUsuarioGLPIPorLogin(login) {
  const sessionToken = await iniciarSesionGLPI();
  const loginNorm = String(login || "").trim();
  if (!loginNorm) return null;

  const response = await axios.get(
    `${process.env.GLPI_URL}/User?searchText[name]=${encodeURIComponent(loginNorm)}`,
    { headers: headersGLPI(sessionToken) }
  );

  const users = normalizarListaGLPI(response.data);
  const match = users.find(
    (u) =>
      String(u?.name || "")
        .trim()
        .toLowerCase() === loginNorm.toLowerCase()
  );

  if (!match?.id) return null;
  return { id: match.id };
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

  if (!firstname && !realname) return true;
  if (firstname && firstname === realname) return true;
  if (firstname === login || realname === login) return true;

  return false;
}

async function corregirNombreUsuario(userId, email, nombreDisplay, sessionToken) {
  const usuario = await obtenerUsuario(userId, sessionToken);

  if (!nombreEstaDuplicado(usuario, email)) return userId;

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
    { headers: headersGLPI(sessionToken) }
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
    { headers: headersGLPI(sessionToken) }
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
    { headers: headersGLPI(sessionToken) }
  );

  return userId;
}

async function obtenerTicketsGLPI() {
  const sessionToken = await iniciarSesionGLPI();

  const response = await axios.get(`${process.env.GLPI_URL}/Ticket`, {
    headers: headersGLPI(sessionToken),
  });

  return response.data;
}

async function obtenerUsersGLPI() {
  const sessionToken = await iniciarSesionGLPI();

  const response = await axios.get(`${process.env.GLPI_URL}/User`, {
    headers: headersGLPI(sessionToken),
  });

  return normalizarListaGLPI(response.data);
}

function normalizarListaGLPI(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

async function obtenerUserEmailsGLPI(userId, sessionToken) {
  const response = await axios.get(
    `${process.env.GLPI_URL}/User/${userId}/UserEmail`,
    { headers: headersGLPI(sessionToken) }
  );

  return normalizarListaGLPI(response.data);
}

async function obtenerUsersConEmailsGLPI(limit = 50) {
  const sessionToken = await iniciarSesionGLPI();

  const usersResponse = await axios.get(`${process.env.GLPI_URL}/User`, {
    headers: headersGLPI(sessionToken),
  });

  const users = normalizarListaGLPI(usersResponse.data);
  const slice = users.slice(0, Number(limit) || 50);

  const result = [];

  for (const u of slice) {
    const userId = u?.id || u?.users_id;
    if (!userId) continue;

    let email = null;

    try {
      const emails = await obtenerUserEmailsGLPI(userId, sessionToken);
      const defaultEmail =
        emails.find((e) => e?.is_default === 1 || e?.is_default === true) ||
        emails[0];

      email = defaultEmail?.email ?? null;
    } catch {}

    result.push({
      ...u,
      email,
    });
  }

  return result;
}

async function crearTicketGLPI(asunto, descripcion, email, nombreSolicitante, tecnicoId = 0) {
  const sessionToken = await iniciarSesionGLPI();

  const user = await buscarUsuarioPorEmail(email, sessionToken);

  let userId;

  if (user?.id) {
    userId = await corregirNombreUsuario(
      user.id,
      email,
      nombreSolicitante,
      sessionToken
    );
  } else {
    userId = await crearUsuario(email, sessionToken, nombreSolicitante);
  }

  const input = {
    name: asunto,
    content: descripcion,
    priority: 3,
    entities_id: 1,
    _users_id_requester: userId,
  };

  if (tecnicoId && tecnicoId !== 0) {
    input._users_id_assign = tecnicoId;
  }

  const response = await axios.post(
    `${process.env.GLPI_URL}/Ticket`,
    { input },
    { headers: headersGLPI(sessionToken) }
  );

  return response.data;
}

async function agregarUsuarioATicket(ticketId, userId, type = 2) {
  const sessionToken = await iniciarSesionGLPI();

  const payload = {
    input: {
      tickets_id: ticketId,
      users_id: userId,
      type,
    },
  };

  // GLPI puede exponer esto de dos formas según versión/config:
  // - POST /Ticket_User
  // - POST /Ticket/:id/Ticket_User
  try {
    const response = await axios.post(
      `${process.env.GLPI_URL}/Ticket_User`,
      payload,
      { headers: headersGLPI(sessionToken) }
    );
    return response.data;
  } catch (error) {
    const response = await axios.post(
      `${process.env.GLPI_URL}/Ticket/${ticketId}/Ticket_User`,
      payload,
      { headers: headersGLPI(sessionToken) }
    );
    return response.data;
  }
}

module.exports = {
  obtenerTicketsGLPI,
  obtenerUsersGLPI,
  obtenerUsersConEmailsGLPI,
  crearTicketGLPI,
  buscarUsuarioGLPIPorEmail,
  buscarUsuarioGLPIPorLogin,
  agregarUsuarioATicket,
};