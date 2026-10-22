// Copia el filtro de ruido RNNoise desde node_modules a public/vendor/rnnoise/
// para que la app lo cargue en local (igual que socket.io.min.js y peerjs.min.js).
// Uso: npm run vendor:rnnoise  (repetir tras actualizar @sapphi-red/web-noise-suppressor)
const fs = require('fs');
const path = require('path');

const origen = path.join(__dirname, '..', 'node_modules', '@sapphi-red', 'web-noise-suppressor', 'dist');
const destino = path.join(__dirname, '..', 'public', 'vendor', 'rnnoise');

fs.mkdirSync(destino, { recursive: true });

// Worklet: quitamos la referencia al source map para evitar avisos 404 en DevTools (ver ERR-004)
const worklet = fs.readFileSync(path.join(origen, 'rnnoise', 'workletProcessor.js'), 'utf8')
    .replace(/^\/\/# sourceMappingURL=.*$/m, '');
fs.writeFileSync(path.join(destino, 'rnnoiseWorklet.js'), worklet);

for (const wasm of ['rnnoise.wasm', 'rnnoise_simd.wasm']) {
    fs.copyFileSync(path.join(origen, wasm), path.join(destino, wasm));
}

console.log('RNNoise copiado en', destino);
