const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
// 1. IMPORTAMOS PeerServer (Versión independiente)
const { PeerServer } = require('peer');

// --- LÍMITES DE SEGURIDAD ---
const SALAS = ['General', 'Juegos', 'Musica'];   // Únicas salas válidas
const MAX_NOMBRE = 24;                           // Caracteres máximos del nombre de usuario
const MAX_TEXTO = 1000;                          // Caracteres máximos por mensaje
const MAX_HISTORIAL = 50;                        // Mensajes guardados por sala
const MENSAJES_POR_VENTANA = 5;                  // Anti-spam: máximo 5 mensajes...
const VENTANA_MS = 5000;                         // ...cada 5 segundos por usuario
const MAX_FALLOS_LOGIN = 5;                      // Intentos de contraseña fallidos por IP...
const BLOQUEO_LOGIN_MS = 60 * 1000;              // ...antes de bloquearla 1 minuto

let servidorArrancado = false;
let hashPassword = null; // Hash SHA-256 de la contraseña del servidor

function hash(texto) {
    return crypto.createHash('sha256').update(String(texto)).digest();
}

// Comparación en tiempo constante para no filtrar información por tiempos de respuesta
function passwordCorrecta(intento) {
    return typeof intento === 'string' && crypto.timingSafeEqual(hash(intento), hashPassword);
}

// Quita caracteres de control y espacios sobrantes. Devuelve null si no es un texto válido.
function limpiarTexto(valor, maxLongitud) {
    if (typeof valor !== 'string') return null;
    const limpio = valor.replace(/[\u0000-\u001F\u007F]/g, '').trim();
    if (!limpio || limpio.length > maxLongitud) return null;
    return limpio;
}

function iniciarServidor(password) {
    // Si el Host vuelve a elegir "Hostear" con otra contraseña, se actualiza sin reiniciar
    hashPassword = hash(password);
    if (servidorArrancado) return;
    servidorArrancado = true;

    const app = express();
    app.disable('x-powered-by');
    const server = http.createServer(app);

    // CORS abierto: la UI se carga desde file:// y los clientes conectan desde cualquier IP.
    // La protección real es la contraseña (middleware de abajo), no el origen.
    const io = require('socket.io')(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        },
        maxHttpBufferSize: 16 * 1024 // 16 KB por paquete: de sobra para un mensaje de chat
    });

    // --- MEMORIA DEL SERVIDOR ---
    const historialMensajes = Object.fromEntries(SALAS.map(sala => [sala, []]));
    const usuariosConectados = {};
    const fallosLogin = new Map(); // ip -> { fallos, bloqueadoHasta }

    app.use(express.static(path.join(__dirname, 'public')));

    // 2. INICIAMOS EL SERVIDOR DE VOZ EN EL PUERTO 3001
    // Esto crea un proceso separado solo para el audio.
    PeerServer({ port: 3001, path: '/' });

    function obtenerUsuariosDeSala(nombreSala) {
        return Object.values(usuariosConectados)
            .filter(u => u.sala === nombreSala)
            .map(u => u.nombre);
    }

    function nombreEnUso(nombre, socketId) {
        const buscado = nombre.toLowerCase();
        return Object.entries(usuariosConectados)
            .some(([id, u]) => id !== socketId && u.nombre.toLowerCase() === buscado);
    }

    // --- AUTENTICACIÓN: nadie entra sin la contraseña del servidor ---
    io.use((socket, next) => {
        const ip = socket.handshake.address;
        const registro = fallosLogin.get(ip);
        if (registro && registro.bloqueadoHasta > Date.now()) {
            return next(new Error('Demasiados intentos. Espera un minuto.'));
        }
        if (passwordCorrecta(socket.handshake.auth && socket.handshake.auth.password)) {
            fallosLogin.delete(ip);
            return next();
        }
        const fallos = (registro ? registro.fallos : 0) + 1;
        fallosLogin.set(ip, {
            fallos: fallos >= MAX_FALLOS_LOGIN ? 0 : fallos,
            bloqueadoHasta: fallos >= MAX_FALLOS_LOGIN ? Date.now() + BLOQUEO_LOGIN_MS : 0
        });
        console.warn(`Contraseña incorrecta desde ${ip} (${fallos}/${MAX_FALLOS_LOGIN})`);
        next(new Error('Contraseña incorrecta'));
    });

    io.on('connection', (socket) => {

        console.log('Nueva conexión:', socket.id);
        const enviosRecientes = []; // Marcas de tiempo para el anti-spam

        socket.on('unirseSala', (datos) => {
            const sala = datos && datos.sala;
            if (!SALAS.includes(sala)) return;

            const usuario = usuariosConectados[socket.id];
            // El nombre solo se fija al entrar; después no se puede cambiar en la misma sesión
            let nombre = usuario ? usuario.nombre : limpiarTexto(datos.nombre, MAX_NOMBRE);
            if (!nombre) {
                socket.emit('errorNombre', `El nombre debe tener entre 1 y ${MAX_NOMBRE} caracteres.`);
                return;
            }
            if (!usuario && nombreEnUso(nombre, socket.id)) {
                socket.emit('errorNombre', `El nombre "${nombre}" ya está en uso.`);
                return;
            }

            if (usuario) {
                const salaAnterior = usuario.sala;
                socket.leave(salaAnterior);
                usuario.sala = null;
                io.to(salaAnterior).emit('actualizarUsuarios', obtenerUsuariosDeSala(salaAnterior));
            }
            socket.join(sala);
            usuariosConectados[socket.id] = { nombre, sala };
            socket.emit('historialSala', historialMensajes[sala]);
            io.to(sala).emit('actualizarUsuarios', obtenerUsuariosDeSala(sala));
        });

        socket.on('mensajeChat', (datos) => {
            const usuario = usuariosConectados[socket.id];
            if (!usuario || !usuario.sala) return;
            const texto = limpiarTexto(datos && datos.texto, MAX_TEXTO);
            if (!texto) return;

            // Anti-spam: máximo MENSAJES_POR_VENTANA mensajes cada VENTANA_MS
            const ahora = Date.now();
            while (enviosRecientes.length && ahora - enviosRecientes[0] > VENTANA_MS) enviosRecientes.shift();
            if (enviosRecientes.length >= MENSAJES_POR_VENTANA) {
                socket.emit('avisoServidor', 'Vas demasiado rápido. Espera unos segundos.');
                return;
            }
            enviosRecientes.push(ahora);

            // Autor y sala los pone el servidor: no se puede suplantar a nadie ni escribir en otra sala
            const nuevoMensaje = {
                usuario: usuario.nombre,
                texto,
                hora: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };
            const historial = historialMensajes[usuario.sala];
            historial.push(nuevoMensaje);
            if (historial.length > MAX_HISTORIAL) historial.shift();
            io.to(usuario.sala).emit('mensajeChat', nuevoMensaje);
        });

        // Evento de Voz
        socket.on('unirse-voz-global', (peerId) => {
            if (!usuariosConectados[socket.id]) return;
            if (typeof peerId !== 'string' || !/^[\w-]{1,64}$/.test(peerId)) return;
            socket.broadcast.emit('usuario-conectado-voz', peerId);
        });

        socket.on('disconnect', () => {
            const usuario = usuariosConectados[socket.id];
            if (usuario) {
                const salaDondeEstaba = usuario.sala;
                delete usuariosConectados[socket.id];
                io.to(salaDondeEstaba).emit('actualizarUsuarios', obtenerUsuariosDeSala(salaDondeEstaba));
            }
        });

        socket.on('hablando', () => {
            const usuario = usuariosConectados[socket.id];
            if (usuario) {
                socket.broadcast.to(usuario.sala).emit('usuario-hablando', usuario.nombre);
            }
        });

        // Evento: Alguien se calla
        socket.on('silencio', () => {
            const usuario = usuariosConectados[socket.id];
            if (usuario) {
                socket.broadcast.to(usuario.sala).emit('usuario-callado', usuario.nombre);
            }
        });
    });

    // El '0.0.0.0' es la clave mágica. Significa: "Escucha en TODAS mis IPs, incluidas las de red local y VPN"
    server.listen(3000, '0.0.0.0', () => {
        console.log('Servidor Chat corriendo en puerto 3000 (Escuchando en todas las interfaces)');
    });
}

module.exports = { iniciarServidor, MIN_PASSWORD: 4 };
