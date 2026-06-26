const axios = require("axios");
const FormData = require("form-data");

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
  let usuario;
  try {
    usuario = await obtenerUsuario(userId, sessionToken);
  } catch (error) {
    console.warn(`No se pudo obtener el usuario ${userId} para corregir el nombre: ${error.response?.status}`);
    return userId; // Skip name correction if we can't fetch the user
  }

  if (!nombreEstaDuplicado(usuario, email)) return userId;

  const { firstname, realname } = nombreDesdeCorreo(email, nombreDisplay);

  try {
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
  } catch (error) {
    console.warn(`No se pudo actualizar el nombre del usuario ${userId}: ${error.response?.status}`);
  }

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

async function obtenerTicketGLPI(ticketId) {
  const sessionToken = await iniciarSesionGLPI();

  const response = await axios.get(`${process.env.GLPI_URL}/Ticket/${ticketId}`, {
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

async function obtenerSolicitanteTicketGLPI(ticketId) {
  const sessionToken = await iniciarSesionGLPI();

  const response = await axios.get(
    `${process.env.GLPI_URL}/Ticket/${ticketId}/Ticket_User`,
    { headers: headersGLPI(sessionToken) }
  );

  const usuariosTicket = normalizarListaGLPI(response.data);
  const solicitante =
    usuariosTicket.find((u) => Number(u?.type) === 1) || usuariosTicket[0];

  if (!solicitante?.users_id) return null;

  const emails = await obtenerUserEmailsGLPI(solicitante.users_id, sessionToken);
  const emailPrincipal =
    emails.find((e) => e?.is_default === 1 || e?.is_default === true) ||
    emails[0];

  if (!emailPrincipal?.email) return null;

  return {
    userId: solicitante.users_id,
    email: emailPrincipal.email,
  };
}

async function agregarRespuestaTicketGLPI(ticketId, contenido) {
  const sessionToken = await iniciarSesionGLPI();

  const response = await axios.post(
    `${process.env.GLPI_URL}/ITILFollowup`,
    {
      input: {
        itemtype: "Ticket",
        items_id: ticketId,
        content: contenido,
        is_private: 0,

        // 🔥 SOLUCIÓN AL BUCLE
        _disablenotif: true
      },
    },
    {
      headers: headersGLPI(sessionToken),
    }
  );

  return response.data;
}
async function obtenerSeguimientosRecientesGLPI(limit = 50) {
  const sessionToken = await iniciarSesionGLPI();
  const rangeEnd = Math.max(Number(limit) || 50, 1) - 1;

  const response = await axios.get(
    `${process.env.GLPI_URL}/ITILFollowup?range=0-${rangeEnd}&sort=id&order=DESC`,
    { headers: headersGLPI(sessionToken) }
  );

  return normalizarListaGLPI(response.data);
}

async function obtenerSolucionesRecientesGLPI(limit = 50) {
  const sessionToken = await iniciarSesionGLPI();
  const rangeEnd = Math.max(Number(limit) || 50, 1) - 1;

  const response = await axios.get(
    `${process.env.GLPI_URL}/ITILSolution?range=0-${rangeEnd}&sort=id&order=DESC`,
    { headers: headersGLPI(sessionToken) }
  );

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

  const emailNorm = String(email || "").trim().toLowerCase();
  const login = emailNorm.split("@")[0] || "";

  const user = await buscarUsuarioPorEmail(emailNorm, sessionToken);

  let userId;

  if (user?.id) {
    userId = await corregirNombreUsuario(
      user.id,
      emailNorm,
      nombreSolicitante,
      sessionToken
    );
  } else {
    const userByLogin = await buscarUsuarioGLPIPorLogin(login);
    if (userByLogin?.id) {
      userId = await corregirNombreUsuario(
        userByLogin.id,
        emailNorm,
        nombreSolicitante,
        sessionToken
      );
    } else {
      userId = await crearUsuario(emailNorm, sessionToken, nombreSolicitante);
    }
  }

  const input = {
    name: asunto,
    content: descripcion,
    priority: 3,
    entities_id: 1,
    status: 2,                    // ← En curso (asignado)
    _users_id_requester: userId,
  };

  // AUTO-ASIGNACIÓN
  if (tecnicoId && tecnicoId > 0) {
    input._users_id_assign = tecnicoId;
    console.log(`🔧 Asignando técnico ${tecnicoId} durante creación del ticket`);
  } else {
    console.log(`⚠️ No se asignó técnico (tecnicoId = ${tecnicoId})`);
  }

  try {
    const response = await axios.post(
      `${process.env.GLPI_URL}/Ticket`,
      { input },
      { headers: headersGLPI(sessionToken) }
    );

    console.log(`✅ Ticket creado #${response.data.id} con técnico: ${tecnicoId}`);
    return response.data;
  } catch (error) {
    console.error("❌ Error creando ticket:", error.response?.data || error.message);
    throw error;
  }
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

// Upload a document to GLPI and return its ID
async function subirDocumentoGLPI(fileName, contentBase64, mimeType) {
  const sessionToken = await iniciarSesionGLPI();
  const form = new FormData();

  // uploadManifest with document name and entities_id
  form.append(
    "uploadManifest",
    JSON.stringify({
      input: {
        name: fileName,
        entities_id: 1,
        _filename: [fileName],
      },
    })
  );

  // file content as buffer
  const buffer = Buffer.from(contentBase64, "base64");
  form.append("filename[0]", buffer, {
    filename: fileName,
    contentType: mimeType,
  });

  const response = await axios.post(
    `${process.env.GLPI_URL}/Document`,
    form,
    {
      headers: {
        "App-Token": process.env.GLPI_APP_TOKEN,
        "Session-Token": sessionToken,
        ...form.getHeaders(),
      },
    }
  );

  // GLPI returns the new document ID in response.data.id
  return response.data.id;
}

// Link an existing document to a ticket
async function vincularDocumentoATicket(ticketId, documentId) {
  const sessionToken = await iniciarSesionGLPI();
  const payload = {
    input: {
      itemtype: "Ticket",
      items_id: ticketId,
      documents_id: documentId,
    },
  };

  const response = await axios.post(
    `${process.env.GLPI_URL}/Document_Item`,
    payload,
    { headers: headersGLPI(sessionToken) }
  );

  return response.data;
}

/**
 * Obtiene los detalles completos de un seguimiento (ITILFollowup)
 * Útil para saber quién fue el autor (users_id)
 */
async function obtenerSeguimientoGLPI(followupId) {
  const sessionToken = await iniciarSesionGLPI();

  try {
    const response = await axios.get(
      `${process.env.GLPI_URL}/ITILFollowup/${followupId}`,
      { headers: headersGLPI(sessionToken) }
    );
    return response.data;
  } catch (error) {
    console.error(`Error al obtener seguimiento ${followupId}:`, error.message);
    return null;
  }
}

module.exports = {
  obtenerTicketsGLPI,
  obtenerTicketGLPI,
  obtenerUsersGLPI,
  obtenerUsersConEmailsGLPI,
  crearTicketGLPI,
  obtenerSolicitanteTicketGLPI,
  agregarRespuestaTicketGLPI,
  obtenerSeguimientosRecientesGLPI,
  obtenerSolucionesRecientesGLPI,
  buscarUsuarioGLPIPorEmail,
  buscarUsuarioGLPIPorLogin,
  agregarUsuarioATicket,
  subirDocumentoGLPI,
  vincularDocumentoATicket,
  obtenerSeguimientoGLPI,
};
