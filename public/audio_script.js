// audio_script.js


//IP
const savedIP = localStorage.getItem('chatServerIP');

// Variables de estado
let myPeer = null;
let myStream = null;
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
    modal.style.display = 'none';
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

    navigator.mediaDevices.getUserMedia({
        audio: { deviceId: micId ? { exact: micId } : undefined },
        video: false
    }).then(stream => {
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
    if (myStream) myStream.getTracks().forEach(track => track.stop());

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
    // Necesitamos saber mi nombre de usuario global. 
    // Como está en el otro script, una forma sucia pero rápida es buscar el ID que contenga mi nombre
    // O mejor: usar la variable 'usuario' si fuera accesible, pero aquí usaremos el DOM.
    // Buscamos el item que NO sea de los demás (esto es un parche rápido, lo ideal es pasar el nombre a unirseVoz)
    const miNombre = document.getElementById('input-usuario').value; // Truco: leemos el input del login (que está oculto pero tiene el valor)
    activarHalo(miNombre, encender);
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