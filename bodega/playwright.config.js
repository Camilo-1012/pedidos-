// Pruebas automáticas: abren la app en un celular simulado (Pixel 7, Chromium) servida desde esta carpeta.
// Supabase se simula dentro de las pruebas (tests/nube.js): no dependen de internet ni tocan datos reales.
const { defineConfig, devices } = require("@playwright/test");
module.exports = defineConfig({
  testDir: "tests",
  timeout: 60000,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { ...devices["Pixel 7"], baseURL: "http://localhost:8791", trace: "retain-on-failure", acceptDownloads: true },
  webServer: { command: "python3 -m http.server 8791", url: "http://localhost:8791/", reuseExistingServer: !process.env.CI, cwd: __dirname, stdout: "ignore", stderr: "ignore" }
});
