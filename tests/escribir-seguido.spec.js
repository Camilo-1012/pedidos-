// v2.53: «Escribir» deja el formulario listo para el siguiente pedido después de Guardar.
const { test, expect } = require("@playwright/test");
const { entrar, vigilarErrores } = require("./ayuda");

async function escribirPartes(page, n1, n2, n3, guia){
  await expect(page.locator("#pN1")).toBeFocused();
  await page.keyboard.type(n1); await page.keyboard.press("Enter");
  await page.keyboard.type(n2); await page.keyboard.press("Enter");
  await page.keyboard.type(n3);
  if (guia) await page.fill("#fGuia", guia);
  await page.click("#saveTop");
}

test("Escribir: guardar deja el formulario limpio y listo para el siguiente pedido", async ({ page }) => {
  const errs = vigilarErrores(page);
  await entrar(page);
  await page.click("#btnManual");
  await expect(page.locator("#dlgTitle")).toHaveText("Escribir pedidos");
  await expect(page.locator("#dlgCancel")).toHaveText("Cancelar");
  await expect(page.locator("#fSerie")).toBeVisible();

  await page.selectOption("#pVia", "Carrera");
  await escribirPartes(page, "110", "152", "30", "2000000000000001");
  // Sigue abierto, limpio, con la misma vía y el foco en el número
  await expect(page.locator("#dlgEdit")).toBeVisible();
  await expect(page.locator("#dlgTitle")).toHaveText("Escribir pedidos · 1 agregado");
  await expect(page.locator("#dlgCancel")).toHaveText("Terminar");
  await expect(page.locator("#fSerie")).toContainText(/agregado/i);
  for (const id of ["#pN1", "#pN2", "#pN3", "#fAddr", "#fGuia", "#fPhone", "#fName", "#fNotes"]) await expect(page.locator(id)).toHaveValue("");
  await expect(page.locator("#fQty")).toHaveValue("1");
  await expect(page.locator("#pVia")).toHaveValue("Carrera");
  await expect(page.locator("#pN1")).toBeFocused();

  await escribirPartes(page, "110", "152", "30", "2000000000000002");   // misma dirección: el aviso se ve en el formulario
  await expect(page.locator("#dlgTitle")).toHaveText("Escribir pedidos · 2 agregados");
  await expect(page.locator("#fSerie")).toContainText("Agregado aparte. Ojo: ahora hay 2 pedidos");

  await page.selectOption("#pVia", "Calle");
  await escribirPartes(page, "139", "112", "15");
  await expect(page.locator("#dlgTitle")).toHaveText("Escribir pedidos · 3 agregados");

  // Dirección vacía: no guarda ni cuenta
  await page.click("#saveTop");
  await expect(page.locator("#dlgTitle")).toHaveText("Escribir pedidos · 3 agregados");

  await page.click("#dlgCancel");
  await expect(page.locator("#dlgEdit")).toBeHidden();
  await expect(page.locator("#toast")).toHaveText("3 pedidos agregados a la ruta.");
  const st = await page.evaluate(() => state.stops.filter(s => !s.example).map(s => s.label).sort());
  expect(st).toEqual(["Calle 139 # 112-15", "Carrera 110 # 152-30", "Carrera 110 # 152-30"]);
  expect(errs).toEqual([]);
});

test("Escribir y salir sin guardar no deja aviso; editar una parada sigue cerrando al guardar", async ({ page }) => {
  const errs = vigilarErrores(page);
  await entrar(page);
  await page.click("#btnManual");
  await page.keyboard.press("Escape");
  await expect(page.locator("#dlgEdit")).toBeHidden();
  await expect(page.locator("#toast")).not.toHaveText(/agregado/);
  // Atrás en Android cierra igual que Escape: tras guardar uno, resume
  await page.click("#btnManual");
  await escribirPartes(page, "145", "103B", "90");
  await page.keyboard.press("Escape");
  await expect(page.locator("#dlgEdit")).toBeHidden();
  await expect(page.locator("#toast")).toHaveText("1 pedido agregado a la ruta.");
  // Editar (no es nuevo): Guardar cierra
  await page.evaluate(() => openEdit(state.stops.find(s => s.label === "Calle 145 # 103B-90")));
  await expect(page.locator("#dlgTitle")).toHaveText("Editar paquete");
  await expect(page.locator("#fSerie")).toBeHidden();
  await expect(page.locator("#dlgCancel")).toHaveText("Cancelar");
  await page.fill("#fPhone", "3001112233"); await page.click("#saveTop");
  await expect(page.locator("#dlgEdit")).toBeHidden();
  expect(errs).toEqual([]);
});
