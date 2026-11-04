// Publicación: la versión de la app y la del service worker deben coincidir (si no, los celulares no se actualizan),
// y todos los archivos de la app deben estar en la lista que se guarda para usar sin señal.
const { test, expect } = require("@playwright/test");
const fs = require("fs"), path = require("path");
const raiz = path.join(__dirname, "..");
const leer = f => fs.readFileSync(path.join(raiz, f), "utf8");

test("APP_VERSION y CACHE del service worker coinciden", () => {
  const app = leer("js/09-arranque.js").match(/APP_VERSION = "([^"]+)"/)[1];
  const sw = leer("sw.js").match(/CACHE = "ruta-v([^"]+)"/)[1];
  expect(sw).toBe(app);
});

test("todos los archivos js/ y css/ están en la caché del service worker", () => {
  const sw = leer("sw.js");
  for (const dir of ["js", "css"]) for (const f of fs.readdirSync(path.join(raiz, dir))) expect(sw).toContain(`"${dir}/${f}"`);
  const acceso = leer("js/00-acceso.js");
  for (const f of fs.readdirSync(path.join(raiz, "js")).filter(f => f !== "00-acceso.js")) expect(acceso).toContain(`"js/${f}"`);
});
