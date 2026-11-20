// Buscar → cargar el pedido sin salir; teclado numérico con letras en los números de la dirección; dictar el teléfono.
const { test, expect } = require("@playwright/test");
const { entrar, cargar, vigilarErrores } = require("./ayuda");

const DOS = [{ addr: "Calle 145 # 103B-90", guia: "A1" }, { addr: "Carrera 110 # 152-30", guia: "A2" }];

// Reconocimiento de voz simulado: al empezar devuelve lo que diga window.__dicho.
async function vozFalsa(page){
  await page.addInitScript(() => {
    class SRFalso {
      start(){ setTimeout(() => {
        const alt = [{ transcript: window.__dicho || "" }]; alt.isFinal = true;
        const results = [alt]; this.onresult && this.onresult({ results });
        this.onend && this.onend();
      }, 30); }
      stop(){ this.onend && this.onend(); } abort(){ this.onend && this.onend(); }
    }
    window.SpeechRecognition = SRFalso; window.webkitSpeechRecognition = SRFalso;
  });
}

test("Buscar: no está → «Escribir» abre el formulario encima con lo buscado y, al guardar, vuelve a Buscar con el pedido", async ({ page }) => {
  const errs = vigilarErrores(page);
  await entrar(page);
  await cargar(page, DOS);
  await page.click("#btnFind");
  await page.click('label[for="viaQCarrera"]');
  await page.fill("#bqN1", "150B"); await page.fill("#bqN2", "143"); await page.fill("#bqN3", "45");
  await expect(page.locator("#bqInfo")).toContainText("No hay pedidos");
  await expect(page.locator("#bqCargar")).toHaveClass(/vacio/);
  await expect(page.locator("#bqAddScan")).toHaveClass(/primary/);
  await page.click("#bqAddWrite");
  await expect(page.locator("#dlgEdit")).toBeVisible();
  await expect(page.locator("#dlgBuscar")).toHaveAttribute("open", "");      // Buscar sigue abierto debajo
  await expect(page.locator("#pVia")).toHaveValue("Carrera");
  await expect(page.locator("#pN1")).toHaveValue("150B");
  await expect(page.locator("#pN3")).toHaveValue("45");
  await expect(page.locator("#fParsed")).toContainText("Reconocida");
  await page.fill("#fPhone", "3112223344");
  await page.click("#frmEdit button[type=submit]");
  await expect(page.locator("#dlgEdit")).toBeHidden();
  await expect(page.locator("#dlgBuscar")).toBeVisible();
  await expect(page.locator("#bqInfo")).toContainText("1 resultado");
  await expect(page.locator("#bqList")).toContainText("150B");
  await expect(page.locator("#bqCargar")).not.toHaveClass(/vacio/);
  expect(await page.evaluate(() => state.stops.filter(s => !s.example).length)).toBe(3);
  expect(errs).toEqual([]);
});

test("Buscar: una guía que no está pasa al formulario y cancelar vuelve a Buscar", async ({ page }) => {
  const errs = vigilarErrores(page);
  await entrar(page);
  await cargar(page, DOS);
  await page.click("#btnFind");
  await page.click('label[for="viaQTodas"]');
  await page.fill("#bqIn", "8801 2345 6789");
  await expect(page.locator("#bqCargar")).toHaveClass(/vacio/);
  await page.click("#bqAddWrite");
  await expect(page.locator("#fGuia")).toHaveValue("880123456789");
  await page.evaluate(() => $("dlgEdit").close());
  await expect(page.locator("#dlgBuscar")).toBeVisible();
  await expect(page.locator("#bqIn")).toHaveValue("8801 2345 6789");
  expect(await page.evaluate(() => state.stops.filter(s => !s.example).length)).toBe(2);
  expect(errs).toEqual([]);
});

test("Buscar con vía elegida: números separados con # y - pasan a las partes del formulario", async ({ page }) => {
  await entrar(page);
  await cargar(page, DOS);
  await page.click("#btnFind");
  await page.click('label[for="viaQCalle"]');
  await page.fill("#bqIn", "141 Bis B#106-20");
  await page.click("#bqAddWrite");
  await expect(page.locator("#pVia")).toHaveValue("Calle");
  await expect(page.locator("#pN1")).toHaveValue("141 Bis B");
  await expect(page.locator("#pN2")).toHaveValue("106");
  await expect(page.locator("#pN3")).toHaveValue("20");
});

test("teclado numérico: campos de números y fila de letras (B, Bis, ABC)", async ({ page }) => {
  const errs = vigilarErrores(page);
  await entrar(page);
  await page.click("#btnFind");
  for (const id of ["#bqN1", "#bqN2", "#bqN3"]) await expect(page.locator(id)).toHaveAttribute("inputmode", "numeric");
  await page.click('label[for="viaQCarrera"]');
  expect(await page.evaluate(() => $("bqIn").inputMode)).toBe("numeric");
  await page.click('label[for="viaQTodas"]');
  expect(await page.evaluate(() => $("bqIn").inputMode)).toBe("text");   // nombres y conjuntos: teclado normal
  await page.evaluate(() => $("dlgBuscar").close());

  await page.click("#btnManual");
  await expect(page.locator("#dlgEdit")).toBeVisible();
  for (const id of ["#pN1", "#pN2", "#pN3"]) await expect(page.locator(id)).toHaveAttribute("inputmode", "numeric");
  await expect(page.locator("#pN1")).toBeFocused();
  await expect(page.locator("#pLetras")).toBeVisible();
  await page.keyboard.type("141");
  await page.click('#pLetras button[data-l="Bis"]');
  await page.click('#pLetras button[data-l="B"]');
  await expect(page.locator("#pN1")).toHaveValue("141 Bis B");
  await expect(page.locator("#pN1")).toBeFocused();                       // el teclado no se cierra
  await page.click("#pN2"); await page.keyboard.type("143");
  await page.click('#pLetras button[data-l="A"]');
  await expect(page.locator("#pN2")).toHaveValue("143A");
  await page.click("#pN3"); await page.keyboard.type("45");
  await expect(page.locator("#pLetras")).toBeHidden();                     // la placa no lleva letras
  await expect(page.locator("#fAddr")).toHaveValue(/141 Bis B # 143A-45/);
  // «ABC»: teclado con letras en ese campo hasta salir de él
  await page.click("#pN1");
  await page.click('#pLetras button.abc');
  await expect.poll(() => page.evaluate(() => $("pN1").inputMode)).toBe("text");
  await expect(page.locator("#pN1")).toBeFocused();
  await page.click("#fName");
  await expect.poll(() => page.evaluate(() => $("pN1").inputMode)).toBe("numeric");
  expect(errs).toEqual([]);
});

test("dictar el teléfono al agregar un paquete", async ({ page }) => {
  const errs = vigilarErrores(page);
  await vozFalsa(page);
  await entrar(page);
  expect(await page.evaluate(() => telDictado("tres uno uno dos dos dos tres tres cuatro cuatro"))).toBe("3112223344");
  expect(await page.evaluate(() => telDictado("trescientos once doscientos veintidós treinta y tres cuarenta y cuatro"))).toBe("3112223344");
  expect(await page.evaluate(() => telDictado("+57 311 222 3344"))).toBe("3112223344");
  await page.click("#btnManual");
  await page.evaluate(() => { window.__dicho = "trescientos quince cuatrocientos cincuenta y seis setenta y ocho noventa"; });
  await page.click("#micPhone");
  await expect(page.locator("#fPhone")).toHaveValue("3154567890");
  await expect(page.locator("#fCall")).toHaveAttribute("aria-disabled", "false");
  await expect(page.locator("#micPhone")).toHaveText("Dictar");
  // Un número incompleto queda escrito y se avisa para revisarlo
  await page.evaluate(() => { window.__dicho = "tres uno cinco cuatro"; });
  await page.click("#micPhone");
  await expect(page.locator("#fPhone")).toHaveValue("3154");
  await expect(page.locator("#fPhoneHint")).toBeVisible();
  expect(errs).toEqual([]);
});
