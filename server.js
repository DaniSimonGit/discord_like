const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
// 1. IMPORTAMOS PeerServer (Versión independiente)
const { PeerServer } = require('peer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- MEMORIA DEL SERVIDOR ---
const historialMensajes = { 'General': [], 'Juegos': [], 'Musica': [] };
const usuariosConectados = {}; 

app.use(express.static(path.join(__dirname, 'public')));

// 2. INICIAMOS EL SERVIDOR DE VOZ EN EL PUERTO 3001
// Esto crea un proceso separado solo para el audio.
const peerServer = PeerServer({ port: 3001, path: '/' });

// ... (El resto del código de Socket.io y funciones auxiliares SE QUEDA IGUAL) ...
function obtenerUsuariosDeSala(nombreSala) {
    return Object.values(usuariosConectados)
        .filter(u => u.sala === nombreSala)
        .map(u => u.nombre);
}

io.on('connection', (socket) => {

    console.log('Nueva conexión:', socket.id);

    socket.on('unirseSala', ({ sala, nombre }) => {
        // ... tu código ...
        if (usuariosConectados[socket.id]) {
            const salaAnterior = usuariosConectados[socket.id].sala;
            socket.leave(salaAnterior);
            usuariosConectados[socket.id].sala = null; 
            io.to(salaAnterior).emit('actualizarUsuarios', obtenerUsuariosDeSala(salaAnterior));
        }
        socket.join(sala);
        usuariosConectados[socket.id] = { nombre: nombre, sala: sala };
        if (historialMensajes[sala]) {
            socket.emit('historialSala', historialMensajes[sala]);
        }
        io.to(sala).emit('actualizarUsuarios', obtenerUsuariosDeSala(sala));
    });

    socket.on('mensajeChat', ({ sala, usuario, texto }) => {
        const nuevoMensaje = {
            usuario,
            texto,
            hora: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        if (!historialMensajes[sala]) historialMensajes[sala] = [];
        historialMensajes[sala].push(nuevoMensaje);
        if (historialMensajes[sala].length > 50) historialMensajes[sala].shift();
        io.to(sala).emit('mensajeChat', nuevoMensaje);
    });

    // Evento de Voz
    socket.on('unirse-voz-global', (peerId) => {
        socket.broadcast.emit('usuario-conectado-voz', peerId);
    });

    socket.on('disconnect', () => {
        // ... tu código ...
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

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Servidor Chat corriendo en http://localhost:${PORT}`);
    console.log(`Servidor Voz corriendo en puerto 3001`);
});