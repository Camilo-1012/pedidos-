// Lectura de direcciones y etiquetas de Bogotá (funciones puras de la app).
const { test, expect } = require("@playwright/test");
const { entrar } = require("./ayuda");

test("parser de direcciones, etiquetas y tipo de inmueble", async ({ page }) => {
  await entrar(page);
  const r = await page.evaluate(() => ({
    a: parseAddress("Cll 143 # 151B-23").label,
    b: parseAddress("KR 91 No 147 20").label,
    c: parseAddress("AC 145 # 103B 90").label,
    sur: parseAddress("Calle 38A Sur # 34D-51").y < 0,
    ocr: parseAddress("Calle 143 4 151B-23").label,         // el OCR lee "#" como 4
    malo: parseAddress("Avenida Suba frente al parque"),
    et: extractLabel("LAURA GOMEZ\nDestino: Calle 143 # 118-20 Casa 4\nSuba, Bogota  Tel: 311 222 3344\nTN: 7788990011223344"),
    u1: detectUnit("Conjunto Los Pinos torre 2 apto 301"),
    u2: detectUnit("Tren de la sabana"),
    u3: unitText({ type: "local", unit: "Local 5" })
  }));
  expect(r.a).toBe("Calle 143 # 151B-23");
  expect(r.b).toBe("Carrera 91 # 147-20");
  expect(r.c).toBe("Avenida Calle 145 # 103B-90");
  expect(r.sur).toBe(true);
  expect(r.ocr).toBe("Calle 143 # 151B-23");
  expect(r.malo).toBeNull();
  expect(r.et.addr).toBe("Calle 143 # 118-20");
  expect(r.et.phone).toBe("3112223344");
  expect(r.et.guia).toBe("7788990011223344");
  expect(r.et.name).toBe("Laura Gomez");
  expect(r.u1.type).toBe("conjunto");
  expect(r.u2).toBeNull();
  expect(r.u3).toBe("Local 5");
});
