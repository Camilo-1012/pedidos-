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

test("dictado: «bis» mal escrito por el reconocimiento («Avis», «vis») se corrige", async ({ page }) => {
  await entrar(page);
  const r = await page.evaluate(() => [
    "carrera 141 Avis B 143b 59",             // el caso real
    "carrera 141 vis b número 143 b guion 59",
    "calle 139 vis 112 15",
    "carrera 141 a Avis 143 59",              // «A bis»
    "carrera 141 Avis B 143B59"               // y las cifras juntas
  ].map(t => { const p = parseAddress(splitPhone(t).addrConv); return p ? p.label : "NO"; }));
  expect(r).toEqual(["Carrera 141 Bis B # 143B-59", "Carrera 141 Bis B # 143B-59", "Calle 139 Bis # 112-15", "Carrera 141A Bis # 143-59", "Carrera 141 Bis B # 143B-59"]);
  // «Avis» lejos de un número no se toca (p. ej. un nombre)
  expect(await page.evaluate(() => spokenToAddress("conjunto avis torre 2"))).toBe("conjunto avis torre 2");
});

test("dictado: vía elegida con botón, sin decirla en cada dirección", async ({ page }) => {
  await entrar(page);
  await page.click("text=Más opciones"); await page.click("#btnBulk");
  await expect(page.locator("#viaBulkBox")).toBeVisible();
  await page.click("label[for=viaBCarrera]");
  expect(await page.evaluate(() => state.viaDictado)).toBe("Carrera");
  await page.evaluate(() => {
    addDictatedLines("ciento cuarenta y uno bis be ciento cuarenta y tres be cincuenta y nueve siguiente 150 B 14345");
    addDictatedLines("calle 139 112 15");                     // si dice la vía, manda lo dicho
    addDictatedLines("110 152 30 teléfono 311 222 3344");
  });
  expect((await page.inputValue("#txtArea")).split("\n")).toEqual([
    "Carrera 141 Bis B # 143B-59", "Carrera 150B # 143-45", "Calle 139 # 112-15", "Carrera 110 # 152-30 Tel 3112223344"
  ]);
  // Calle: en el formulario de una sola dirección queda marcada igual (es la misma opción)
  await page.click("label[for=viaBCalle]");
  expect(await page.evaluate(() => [conViaElegida("145 106 20"), document.getElementById("viaSCalle").checked])).toEqual(["Calle 145 106 20", true]);
  // «Dicha»: sin vía, como antes
  await page.click("label[for=viaBDicha]");
  expect(await page.evaluate(() => conViaElegida("145 106 20"))).toBe("145 106 20");
});
