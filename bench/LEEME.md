# Banco de pruebas del enrutamiento

Mide qué tan buenas y qué tan rápidas son las rutas de la app. **No se publica con la app.**

- `simulador.js` es un simulador de calles tipo Suba: carreras 104–160 y calles 125–175. Tiene avenidas de doble vía y más rápidas, calles de barrio con la mitad de un solo sentido, y costos por girar. La vuelta en U cuesta 90 s en carro y 8 s en moto. Calcula:
  - los tiempos que entregaría el servidor de rutas: sin rumbo, perfil carro;
  - el **costo verdadero** de un orden, siguiendo hacia dónde queda mirando el vehículo en cada parada;
  - el **óptimo exacto** (Held-Karp) para rutas de hasta unas 11 paradas.
- `banco.js` hace ordenar a la app, a través de su código real y con un servidor de rutas simulado, y compara el resultado con el óptimo o con una referencia de búsqueda local exhaustiva.
  - Uso: `node bench/banco.js 8,10 20 carro,moto,sinred`
  - Modos: `carro`, `moto`, `sinred` (sin internet); se agrega `-nosect` para apagar los sectores.
- `velocidad.js` mide el tiempo de ordenar con el procesador 4 veces más lento, como un celular de gama media.
  - Uso: `node bench/velocidad.js 30,60,99`

Requiere la app servida en `http://localhost:8767/` (`python3 -m http.server 8767`) o en la variable `RUTA_URL`, y `npm ci`.
