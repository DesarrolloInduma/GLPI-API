/**
 * Script de prueba para depurar el flujo de adjuntos
 * Ejecutar: node test_adjuntos.js
 */
require("dotenv").config();

const {
  obtenerCorreosNoLeidos,
  obtenerAdjuntosDeCorreo,
  obtenerDetalleAdjunto,
} = require("./services/outlook.service");

const {
  subirDocumentoGLPI,
  vincularDocumentoATicket,
} = require("./services/glpi");

async function main() {
  console.log("=== PASO 1: Obteniendo correos no leídos ===");
  
  let correos;
  try {
    correos = await obtenerCorreosNoLeidos();
    console.log(`Correos no leídos encontrados: ${correos.length}`);
  } catch (err) {
    console.error("ERROR obteniendo correos:", err.response?.data || err.message);
    return;
  }

  if (correos.length === 0) {
    console.log("No hay correos no leídos. Marca un correo como no leído y vuelve a ejecutar.");
    return;
  }

  const correo = correos[0];
  console.log(`\nUsando correo: "${correo.subject}" (ID: ${correo.id})`);
  console.log(`hasAttachments: ${correo.hasAttachments}`);

  console.log("\n=== PASO 2: Obteniendo lista de adjuntos ===");
  
  let adjuntos;
  try {
    adjuntos = await obtenerAdjuntosDeCorreo(correo.id);
    console.log(`Adjuntos encontrados: ${adjuntos.length}`);
  } catch (err) {
    console.error("ERROR obteniendo adjuntos:", err.response?.data || err.message);
    return;
  }

  if (adjuntos.length === 0) {
    console.log("El correo no tiene adjuntos detectados por la API.");
    console.log("Nota: Las imágenes de firma pueden estar embebidas en el HTML del correo,");
    console.log("no como adjuntos separados. Intenta adjuntar una imagen real al correo.");
    return;
  }

  for (let i = 0; i < adjuntos.length; i++) {
    const adj = adjuntos[i];
    console.log(`\n--- Adjunto ${i + 1} ---`);
    console.log(`  name: ${adj.name}`);
    console.log(`  contentType: ${adj.contentType}`);
    console.log(`  size: ${adj.size} bytes`);
    console.log(`  @odata.type: ${adj["@odata.type"]}`);
    console.log(`  isInline: ${adj.isInline}`);
    console.log(`  tiene contentBytes: ${!!adj.contentBytes}`);
    if (adj.contentBytes) {
      console.log(`  contentBytes length: ${adj.contentBytes.length}`);
    }
  }

  console.log("\n=== PASO 3: Obteniendo detalle del primer adjunto ===");
  
  const primerAdj = adjuntos[0];
  let detalle;
  try {
    detalle = await obtenerDetalleAdjunto(correo.id, primerAdj.id);
    console.log(`Detalle obtenido OK`);
    console.log(`  name: ${detalle.name}`);
    console.log(`  contentType: ${detalle.contentType}`);
    console.log(`  tiene contentBytes: ${!!detalle.contentBytes}`);
    if (detalle.contentBytes) {
      console.log(`  contentBytes length: ${detalle.contentBytes.length}`);
      console.log(`  primeros 50 chars: ${detalle.contentBytes.substring(0, 50)}...`);
    }
  } catch (err) {
    console.error("ERROR obteniendo detalle:", err.response?.data || err.message);
    return;
  }

  if (!detalle.contentBytes) {
    console.log("No se pudo obtener contentBytes del adjunto.");
    return;
  }

  console.log("\n=== PASO 4: Subiendo documento a GLPI ===");
  
  let docId;
  try {
    docId = await subirDocumentoGLPI(
      detalle.name || primerAdj.name,
      detalle.contentBytes,
      detalle.contentType || primerAdj.contentType || "application/octet-stream"
    );
    console.log(`Documento subido exitosamente! ID: ${docId}`);
  } catch (err) {
    console.error("ERROR subiendo documento a GLPI:");
    console.error("  Status:", err.response?.status);
    console.error("  Data:", JSON.stringify(err.response?.data, null, 2));
    console.error("  Message:", err.message);
    return;
  }

  console.log("\n=== PASO 5: Vinculando documento al ticket 2045 (prueba) ===");
  console.log("(Cambia el ID del ticket si necesitas otro)");
  
  try {
    const result = await vincularDocumentoATicket(2045, docId);
    console.log("Documento vinculado exitosamente!", JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("ERROR vinculando documento:");
    console.error("  Status:", err.response?.status);
    console.error("  Data:", JSON.stringify(err.response?.data, null, 2));
    console.error("  Message:", err.message);
  }

  console.log("\n=== PRUEBA COMPLETA ===");
}

main().catch((err) => {
  console.error("Error fatal:", err);
  process.exit(1);
});
