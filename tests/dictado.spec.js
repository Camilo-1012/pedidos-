// Dictado: Google a veces junta las cifras y omite «número» y «guion» («carrera 150 B 14345»).
const { test, expect } = require("@playwright/test");
const { entrar } = require("./ayuda");

test("dictado: separa la placa cuando el reconocimiento junta las cifras", async ({ page }) => {
  await entrar(page);
  const r = await page.evaluate(() => {
    const lab = t => { const sp = splitPhone(t), p = parseAddress(sp.addrConv); return (p ? p.label : "NO") + (sp.tel ? " Tel " + sp.tel : ""); };
    return [
      "carrera 150 B 14345",                       // el caso real
      "Carrera 150B 14345",
      "carrera 150 B número 14345",                // dijo «número» pero juntó el resto
      "calle 145 10620",                           // calle 145 # 106-20
      "calle 139 112 15",                          // separado por espacio: ya se entendía
      "carrera 150 B 143 guion 45",                // completo: sin cambios
      "calle 145 106120",                          // placa de 3 cifras (1061 no es una vía)
      "carrera 150 B 14345 3112223344",            // con teléfono al final sin la palabra
      "carrera 150 B 14345 teléfono 311 222 3344", // con la palabra «teléfono»
      "calle ciento cuarenta y cinco ciento seis veinte" // en palabras, sin «número»
    ].map(lab);
  });
  expect(r).toEqual([
    "Carrera 150B # 143-45",
    "Carrera 150B # 143-45",
    "Carrera 150B # 143-45",
    "Calle 145 # 106-20",
    "Calle 139 # 112-15",
    "Carrera 150B # 143-45",
    "Calle 145 # 106-120",
    "Carrera 150B # 143-45 Tel 3112223344",
    "Carrera 150B # 143-45 Tel 3112223344",
    "Calle 145 # 106-20"
  ]);
});
