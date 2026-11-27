// v2.55: el escáner de Bodega muestra todo el campo de visión de la cámara (sin recortar los lados), sea el video
// vertical u horizontal, y el recuadro de puntería es más ancho.
const { test, expect } = require("@playwright/test");
const A = require("./ayuda");

// Cámara simulada: un lienzo de W×H con marcas en los cuatro bordes.
async function camara(page, W, H){
  await page.evaluate(([W, H]) => {
    navigator.mediaDevices.getUserMedia = async () => {
      const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d");
      const pintar = () => { x.fillStyle = "#ddd"; x.fillRect(0, 0, W, H); x.fillStyle = "#c00"; x.fillRect(0, 0, 40, H); x.fillRect(W - 40, 0, 40, H);
        x.fillStyle = "#00c"; x.fillRect(0, 0, W, 40); x.fillRect(0, H - 40, W, 40); };
      pintar(); setInterval(pintar, 100);
      return c.captureStream(10);
    };
  }, [W, H]);
}
for(const [nombre, W, H] of [["vertical", 720, 1280], ["horizontal", 1280, 720]]){
  test(`escáner con video ${nombre}: se ve todo el cuadro de la cámara`, async ({ page }) => {
    const errs = A.vigilarErrores(page);
    await A.entrar(page);
    await A.nuevoLote(page, "Xcargo", "L1");
    await camara(page, W, H);
    await page.click("#recScan");
    await expect.poll(() => page.evaluate(() => $("scVideo").videoWidth)).toBe(W);
    const r = await page.evaluate(() => {
      const v = $("scVideo"), box = v.parentElement.getBoundingClientRect(), vr = v.getBoundingClientRect();
      return {fit: getComputedStyle(v).objectFit, ar: v.parentElement.style.aspectRatio, bw: box.width, bh: box.height, vw: vr.width, vh: vr.height};
    });
    expect(r.fit).toBe("contain");                    // nunca recorta: el cuadro completo cabe en la caja
    expect(r.ar.replace(/\s/g, "")).toBe(`${W}/${H}`);
    expect(r.bh).toBeLessThanOrEqual(page.viewportSize().height * 0.52 + 1);
    await page.screenshot({ path: test.info().outputPath(`escaner-${nombre}.png`) });
    await page.click("#scClose");
    expect(errs).toEqual([]);
  });
}
