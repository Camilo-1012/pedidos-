// Pruebas automáticas: abren la app en un celular simulado (Pixel 7, Chromium) servida desde esta carpeta.
// Los servicios externos (mapas, rutas, Waze) se simulan o se bloquean: las pruebas no dependen de internet.
const { defineConfig, devices } = require("@playwright/test");
const path = require("path");
const CAM = path.join(__dirname, "tests", ".tmp", "camara.y4m");
module.exports = defineConfig({
  testDir: "tests",
  timeout: 90000,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: require.resolve("./tests/preparar.js"),
  use: {
    ...devices["Pixel 7"],
    baseURL: "http://localhost:8790",
    launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-file-for-fake-video-capture=" + CAM] },
    trace: "retain-on-failure"
  },
  webServer: { command: "python3 -m http.server 8790", url: "http://localhost:8790/", reuseExistingServer: !process.env.CI, cwd: __dirname, stdout: "ignore", stderr: "ignore" }
});
