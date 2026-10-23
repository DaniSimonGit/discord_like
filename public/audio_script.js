// audio_script.js


//IP
const savedIP = localStorage.getItem('chatServerIP');

// Variables de estado
let myPeer = null;
let myStream = null;
let microfonoVoz = null; // { stream, detener() } de obtenerMicrofono()
const peersConectados = {};
let enLlamada = false;

let micEnabled = true;   // Empieza activado
let audioEnabled = true; // Empieza activado



// Elementos del DOM
const selectMic = document.getElementById('audio-input');
const selectAltavoz = document.getElementById('audio-output');
const btnVoz = document.getElementById('btn-voz');
const modal = document.getElementById('settings-modal');

const btnMicro = document.getElementById('btn-micro');
const btnAudio = document.getElementById('btn-audio');

// 1. OBTENER LISTA DE DISPOSITIVOS
async function obtenerDispositivos() {
    try {
        // Pedir permiso primero para desbloquear la lista de dispositivos
        await navigator.mediaDevices.getUserMedia({ audio: true });

        const devices = await navigator.mediaDevices.enumerateDevices();

        selectMic.innerHTML = '';
        selectAltavoz.innerHTML = '';

        devices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.text = device.label || `Dispositivo ${device.deviceId.slice(0, 5)}...`;

            if (device.kind === 'audioinput') {
                selectMic.appendChild(option);
            } else if (device.kind === 'audiooutput') {
                selectAltavoz.appendChild(option);
            }
        });
    } catch (error) {
        console.error("Error al obtener dispositivos:", error);
    }
}

// 2. ABRIR/CERRAR MODAL
function abrirAjustes() {
    obtenerDispositivos();
    modal.style.display = 'flex';
}

function cerrarAjustes() {
    detenerPruebaMicro();
    modal.style.display = 'none';
}

// Configuración del micrófono compartida por la llamada y por la prueba de micro.
// En la prueba se desactiva la cancelación de eco: al escucharse a uno mismo, el
// filtro confunde tu propia voz con eco y la recorta (se oye cortada y metálica).
// El filtro de ruido nativo de Chromium solo se usa si RNNoise no se puede cargar
// (si se usan los dos a la vez, la voz se procesa dos veces y suena peor).
function constraintsMicrofono(micId, cancelarEco = true, filtroNativo = false) {
    return {
        audio: {
            deviceId: micId ? { exact: micId } : undefined,
            noiseSuppression: filtroNativo, // Filtro de ruido de Chromium (solo como respaldo de RNNoise)
            echoCancellation: cancelarEco,  // Evita que el audio de los altavoces vuelva a entrar por el micro
            autoGainControl: true           // Nivela automáticamente el volumen de la voz
        },
        video: false
    };
}

// --- FILTRO DE RUIDO RNNOISE ---
// Ficheros copiados desde node_modules con `npm run vendor:rnnoise`
const RNNOISE_DIR = 'vendor/rnnoise/';
// Nombre con el que el worklet de @sapphi-red/web-noise-suppressor registra su procesador
const RNNOISE_PROCESSOR_ID = '@sapphi-red/web-noise-suppressor/rnnoise';
let rnnoiseArchivos = null; // Caché: { worklet: string, wasm: ArrayBuffer }

// Usamos XMLHttpRequest porque fetch() no admite rutas file:// en Electron
function cargarArchivo(url, tipo) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url);
        xhr.responseType = tipo;
        // En file:// el status es 0 aunque la carga sea correcta
        xhr.onload = () => (xhr.status === 0 || xhr.status === 200) && xhr.response
            ? resolve(xhr.response)
            : reject(new Error(`No se pudo cargar ${url} (status ${xhr.status})`));
        xhr.onerror = () => reject(new Error(`No se pudo cargar ${url}`));
        xhr.send();
    });
}

// Comprueba si el procesador soporta WebAssembly SIMD (versión más rápida de RNNoise)
function simdDisponible() {
    return WebAssembly.validate(new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0,
        10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11
    ]));
}

async function cargarRnnoise() {
    if (!rnnoiseArchivos) {
        const wasm = simdDisponible() ? 'rnnoise_simd.wasm' : 'rnnoise.wasm';
        const [worklet, binario] = await Promise.all([
            cargarArchivo(RNNOISE_DIR + 'rnnoiseWorklet.js', 'text'),
            cargarArchivo(RNNOISE_DIR + wasm, 'arraybuffer')
        ]);
        rnnoiseArchivos = { worklet, wasm: binario };
    }
    return rnnoiseArchivos;
}

// Pasa el stream del micrófono por RNNoise y devuelve el stream ya filtrado
async function crearFiltroRuido(streamOriginal) {
    const { worklet, wasm } = await cargarRnnoise();

    // RNNoise trabaja a 48 kHz
    const ctx = new AudioContext({ sampleRate: 48000 });
    try {
        // El worklet se carga desde un Blob porque addModule() tampoco admite file://
        const workletUrl = URL.createObjectURL(new Blob([worklet], { type: 'application/javascript' }));
        try {
            await ctx.audioWorklet.addModule(workletUrl);
        } finally {
            URL.revokeObjectURL(workletUrl);
        }

        const filtro = new AudioWorkletNode(ctx, RNNOISE_PROCESSOR_ID, {
            channelCount: 1,             // Mezclamos a mono: la voz no necesita estéreo
            channelCountMode: 'explicit',
            outputChannelCount: [1],
            processorOptions: { maxChannels: 1, wasmBinary: wasm }
        });
        const origen = ctx.createMediaStreamSource(streamOriginal);
        const destino = ctx.createMediaStreamDestination();
        origen.connect(filtro);
        filtro.connect(destino);

        return {
            stream: destino.stream,
            detener() {
                filtro.port.postMessage('destroy');
                origen.disconnect();
                filtro.disconnect();
                destino.stream.getTracks().forEach(track => track.stop());
                ctx.close();
            }
        };
    } catch (err) {
        ctx.close();
        throw err;
    }
}

// Abre el micrófono con RNNoise. Si RNNoise falla, usa el filtro nativo de Chromium.
// Devuelve { stream, detener() }; detener() libera el micrófono y el filtro.
async function obtenerMicrofono(micId, cancelarEco = true) {
    const streamOriginal = await navigator.mediaDevices.getUserMedia(constraintsMicrofono(micId, cancelarEco));
    try {
        const filtro = await crearFiltroRuido(streamOriginal);
        return {
            stream: filtro.stream,
            detener() {
                filtro.detener();
                streamOriginal.getTracks().forEach(track => track.stop());
            }
        };
    } catch (err) {
        console.warn("RNNoise no disponible, se usa el filtro de ruido de Chromium:", err);
        streamOriginal.getTracks().forEach(track => track.stop());
        const streamNativo = await navigator.mediaDevices.getUserMedia(constraintsMicrofono(micId, cancelarEco, true));
        return {
            stream: streamNativo,
            detener() {
                streamNativo.getTracks().forEach(track => track.stop());
            }
        };
    }
}

// --- PRUEBA DE MICRÓFONO (escucharse a uno mismo) ---
let pruebaMicro = null; // { stream, detener() } de obtenerMicrofono()
let pruebaAudio = null;
let pruebaCargando = false; // Evita arrancar dos pruebas a la vez con un doble clic
const btnProbarMicro = document.getElementById('btn-probar-micro');

async function togglePruebaMicro() {
    if (pruebaCargando) return;
    if (pruebaMicro) {
        detenerPruebaMicro();
        return;
    }

    pruebaCargando = true;
    try {
        pruebaMicro = await obtenerMicrofono(selectMic.value, false);
    } catch (err) {
        console.error("No se pudo acceder al micrófono:", err);
        if (typeof mostrarNotificacion === 'function') mostrarNotificacion("Error: No se detecta micrófono. Revisa los permisos.");
        return;
    } finally {
        pruebaCargando = false;
    }

    // Si se cerraron los Ajustes mientras cargaba, no dejamos el micro abierto
    if (modal.style.display === 'none') {
        detenerPruebaMicro();
        return;
    }

    // Reproducimos el propio micrófono por el altavoz elegido
    pruebaAudio = document.createElement('audio');
    pruebaAudio.srcObject = pruebaMicro.stream;
    const speakerId = selectAltavoz.value;
    if (speakerId && pruebaAudio.setSinkId) {
        pruebaAudio.setSinkId(speakerId).catch(e => console.warn("No se pudo cambiar salida:", e));
    }
    pruebaAudio.play();

    btnProbarMicro.innerText = "⏹️ Detener prueba";
    btnProbarMicro.style.background = "#ed4245"; // Rojo
}

function detenerPruebaMicro() {
    if (pruebaMicro) pruebaMicro.detener();
    if (pruebaAudio) pruebaAudio.srcObject = null;
    pruebaMicro = null;
    pruebaAudio = null;

    if (btnProbarMicro) {
        btnProbarMicro.innerText = "🎙️ Probar micrófono";
        btnProbarMicro.style.background = "#3ba55c"; // Verde
    }
}

// 3. LOGICA PRINCIPAL DE VOZ
function toggleVoz() {
    if (!enLlamada) {
        unirseVoz();
    } else {
        salirVoz();
    }
}

function unirseVoz() {
    // SEGURO: Si no hay IP, avisamos y no intentamos conectar
    if (!savedIP) {
        if (typeof mostrarNotificacion === 'function') mostrarNotificacion("Falta la IP del servidor. Configúrala en la pantalla principal.");
        return;
    }

    // Apuntamos al puerto 3001 usando la IP dinámica
    myPeer = new Peer(undefined, {
        host: savedIP, // <--- AQUÍ ESTÁ EL CAMBIO PRINCIPAL
        port: 3001,
        path: '/',
        // Mantenemos la config de Google para evitar errores
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:global.stun.twilio.com:3478' }
            ]
        }
    });

    // Cuando el servidor nos da un ID
    myPeer.on('open', id => {
        console.log('Mi ID de Peer es: ' + id);
        // Avisamos a los demás usuarios por Socket.io que estamos listos para hablar
        socket.emit('unirse-voz-global', id);

        // Cambio visual del botón
        btnVoz.innerHTML = `<span class="btn-voz-icon">📵</span> <span class="btn-voz-texto">Desconectar Voz</span>`;
        btnVoz.style.background = "#ed4245"; // Rojo
        enLlamada = true;
    });

    // Capturamos el audio del micrófono seleccionado
    const micId = selectMic.value;

    obtenerMicrofono(micId).then(microfono => {
        // Si se desconectó mientras se cargaba el filtro, liberamos el micrófono y salimos
        if (!myPeer || myPeer.destroyed) {
            microfono.detener();
            return;
        }
        microfonoVoz = microfono;
        const stream = microfono.stream; // Stream ya filtrado por RNNoise
        myStream = stream;

        iniciarDetectorVoz(stream);

        // A) ALGUIEN ME LLAMA (Recibir llamada)
        myPeer.on('call', call => {
            call.answer(stream); // Contesto enviándole mi audio también

            const audio = document.createElement('audio');
            call.on('stream', userAudioStream => {
                addAudioStream(audio, userAudioStream);
            });
        });

        // B) YO LLAMO A ALGUIEN NUEVO (Cuando socket me avisa)
        socket.on('usuario-conectado-voz', userId => {
            // Solo conectamos si no somos nosotros mismos
            if (userId !== myPeer.id) {
                conectarNuevoUsuario(userId, stream);
            }
        });
    }).catch(err => {
        console.error("No se pudo acceder al micrófono:", err);
        if (typeof mostrarNotificacion === 'function') mostrarNotificacion("Error: No se detecta micrófono. Revisa los permisos.");
        salirVoz();
    });
}

function salirVoz() {
    if (myPeer) myPeer.destroy();
    if (microfonoVoz) microfonoVoz.detener(); // Libera el micrófono y el filtro RNNoise
    microfonoVoz = null;
    myStream = null;

    // Eliminar audios de otros
    document.querySelectorAll('audio').forEach(a => a.remove());

    enLlamada = false;
    btnVoz.innerHTML = `<span class="btn-voz-icon">📞</span> <span class="btn-voz-texto">Unirse a Voz</span>`;
    btnVoz.style.background = "#3ba55c"; // Verde

    // Limpiamos listeners para evitar duplicados si nos reconectamos
    if (socket && typeof socket.off === 'function') socket.off('usuario-conectado-voz');
}

function conectarNuevoUsuario(userId, stream) {
    console.log("Llamando a nuevo usuario:", userId);
    const call = myPeer.call(userId, stream);
    const audio = document.createElement('audio');

    call.on('stream', userAudioStream => {
        addAudioStream(audio, userAudioStream);
    });

    call.on('close', () => {
        audio.remove();
    });

    peersConectados[userId] = call;
}

function addAudioStream(audio, stream) {
    audio.srcObject = stream;

    // --- CAMBIO AQUÍ: Respetar si tengo los cascos quitados ---
    audio.muted = !audioEnabled;
    // ----------------------------------------------------------

    const speakerId = selectAltavoz.value;
    if (speakerId && audio.setSinkId) {
        audio.setSinkId(speakerId).catch(e => console.warn("No se pudo cambiar salida:", e));
    }

    audio.addEventListener('loadedmetadata', () => {
        audio.play();
    });

    document.body.append(audio);
}

// --- FUNCIONES DE MUTE / DEAFEN ---

function toggleMicrofono() {
    // Si no estamos en llamada, no hacemos nada
    if (!enLlamada || !myStream) {
        if (typeof mostrarNotificacion === 'function') mostrarNotificacion("Debes unirte a la voz primero.");
        return;
    }

    micEnabled = !micEnabled; // Invertir estado (true -> false)

    // Desactivar/Activar la pista de audio que enviamos
    myStream.getAudioTracks()[0].enabled = micEnabled;

    // Actualizar botón visualmente
    if (micEnabled) {
        btnMicro.classList.remove('btn-rojo');
        btnMicro.innerText = "🎤";
    } else {
        btnMicro.classList.add('btn-rojo');
        btnMicro.innerText = "🔇";
    }
}

function toggleAuriculares() {
    audioEnabled = !audioEnabled; // Invertir estado

    // 1. Mutear/Desmutear todos los audios de otros usuarios
    document.querySelectorAll('audio').forEach(audioTag => {
        audioTag.muted = !audioEnabled;
    });

    // 2. Actualizar botón visualmente
    if (audioEnabled) {
        btnAudio.classList.remove('btn-rojo');
        btnAudio.innerText = "🎧";
    } else {
        btnAudio.classList.add('btn-rojo');
        btnAudio.innerText = "🙉";
    }
}

// --- DETECCIÓN DE VOZ (HALO VERDE) ---
let audioContext = null;
let analyser = null;
let microphone = null;
let javascriptNode = null;
let hablandoActualmente = false;

function iniciarDetectorVoz(stream) {
    // 1. Configurar contexto de audio
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    // 2. Crear analizador
    analyser = audioContext.createAnalyser();
    analyser.smoothingTimeConstant = 0.3; // Suavizar picos
    analyser.fftSize = 1024;

    // 3. Conectar stream al analizador
    microphone = audioContext.createMediaStreamSource(stream);
    microphone.connect(analyser);

    // 4. Procesador para leer el volumen cada poco tiempo
    javascriptNode = audioContext.createScriptProcessor(2048, 1, 1);
    analyser.connect(javascriptNode);
    javascriptNode.connect(audioContext.destination);

    javascriptNode.onaudioprocess = function() {
        const array = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(array);
        
        // Calcular volumen promedio
        let values = 0;
        const length = array.length;
        for (let i = 0; i < length; i++) {
            values += array[i];
        }
        const average = values / length;

        // UMBRAL DE VOZ (Ajustar si es muy sensible)
        const umbral = 10; 

        if (average > umbral && !hablandoActualmente) {
            // Empezó a hablar
            hablandoActualmente = true;
            iluminarYo(true); // Iluminarme a mí mismo localmente
            socket.emit('hablando');
        } else if (average < umbral && hablandoActualmente) {
            // Dejó de hablar
            hablandoActualmente = false;
            iluminarYo(false); // Apagarme a mí mismo
            socket.emit('silencio');
        }
    }
}

// Función auxiliar para iluminar mi propio avatar (ya que el socket no me lo devuelve a mí)
function iluminarYo(encender) {
    // 'usuario' es la variable global de index.html con el nombre con el que se entró
    activarHalo(usuario, encender);
}

// Función para encender/apagar el CSS
function activarHalo(nombre, encender) {
    const item = document.getElementById(`user-${nombre}`);
    if (item) {
        if (encender) item.classList.add('hablando');
        else item.classList.remove('hablando');
    }
}

// ESCUCHAR EVENTOS DE OTROS
if (typeof socket !== 'undefined' && socket && typeof socket.on === 'function') {
    socket.on('usuario-hablando', (nombre) => activarHalo(nombre, true));
    socket.on('usuario-callado', (nombre) => activarHalo(nombre, false));
}