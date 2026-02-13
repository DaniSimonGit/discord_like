// audio_script.js

// Variables de estado
let myPeer = null;
let myStream = null;
const peersConectados = {}; 
let enLlamada = false;

// Elementos del DOM
const selectMic = document.getElementById('audio-input');
const selectAltavoz = document.getElementById('audio-output');
const btnVoz = document.getElementById('btn-voz');
const modal = document.getElementById('settings-modal');

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
            option.text = device.label || `Dispositivo ${device.deviceId.slice(0,5)}...`;

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
    // CAMBIO IMPORTANTE: Apuntamos al puerto 3001
    myPeer = new Peer(undefined, {
        host: window.location.hostname, // Usa la IP actual automáticamente
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
        btnVoz.innerText = "Desconectar Voz";
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
            if(userId !== myPeer.id) {
                conectarNuevoUsuario(userId, stream);
            }
        });
    }).catch(err => {
        console.error("No se pudo acceder al micrófono:", err);
        alert("Error: No se detecta micrófono. Revisa los permisos.");
        salirVoz();
    });
}

function salirVoz() {
    if (myPeer) myPeer.destroy();
    if (myStream) myStream.getTracks().forEach(track => track.stop());
    
    // Eliminar audios de otros
    document.querySelectorAll('audio').forEach(a => a.remove());
    
    enLlamada = false;
    btnVoz.innerText = "Unirse a Voz";
    btnVoz.style.background = "#3ba55c"; // Verde
    
    // Limpiamos listeners para evitar duplicados si nos reconectamos
    socket.off('usuario-conectado-voz');
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
    
    // Configurar salida de audio (Altavoces)
    const speakerId = selectAltavoz.value;
    if (speakerId && audio.setSinkId) { // setSinkId solo funciona en Chrome/Electron por ahora
        audio.setSinkId(speakerId).catch(e => console.warn("No se pudo cambiar salida de audio:", e));
    }
    
    audio.addEventListener('loadedmetadata', () => {
        audio.play();
    });
    
    document.body.append(audio);
}