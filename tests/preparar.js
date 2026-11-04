// Convierte la imagen de una etiqueta en un video de cámara simulada (formato y4m) para las pruebas del escáner.
const { execSync } = require("child_process");
const fs = require("fs"), path = require("path");
module.exports = async () => {
  const dir = path.join(__dirname, ".tmp"), out = path.join(dir, "camara.y4m");
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(out)) return;
  try {
    execSync(`ffmpeg -loglevel error -y -loop 1 -i "${path.join(__dirname, "fixtures", "etiqueta.png")}" -t 3 -r 10 -pix_fmt yuv420p "${out}"`);
  } catch (e) {
    console.warn("ffmpeg no está disponible: se omiten las pruebas de cámara.");
  }
};
