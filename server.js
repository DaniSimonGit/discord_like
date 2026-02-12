const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- MEMORIA DEL SERVIDOR ---
const historialMensajes = { 'General': [], 'Juegos': [], 'Musica': [] };

// Mapa de usuarios: { socketID: { nombre: "Dani", sala: "General" } }
const usuariosConectados = {}; 

app.use(express.static(path.join(__dirname, 'public')));

// Función auxiliar para obtener usuarios de una sala específica
function obtenerUsuariosDeSala(nombreSala) {
    return Object.values(usuariosConectados)
        .filter(u => u.sala === nombreSala)
        .map(u => u.nombre);
}

io.on('connection', (socket) => {
    console.log('Nueva conexión:', socket.id);

    // Evento: Unirse a una sala (Ahora recibimos sala Y nombre)
    socket.on('unirseSala', ({ sala, nombre }) => {
        // 1. Si el usuario ya estaba en otra sala, lo sacamos de la anterior
        if (usuariosConectados[socket.id]) {
            const salaAnterior = usuariosConectados[socket.id].sala;
            socket.leave(salaAnterior);
            
            // Avisar a la sala anterior que se fue (para actualizar su lista)
            // Actualizamos la "ficha" del usuario temporalmente para filtrar correctamente
            usuariosConectados[socket.id].sala = null; 
            io.to(salaAnterior).emit('actualizarUsuarios', obtenerUsuariosDeSala(salaAnterior));
        }

        // 2. Unirse a la nueva sala
        socket.join(sala);
        
        // 3. Guardar/Actualizar datos del usuario
        usuariosConectados[socket.id] = { nombre: nombre, sala: sala };

        // 4. Enviar historial de mensajes al usuario
        if (historialMensajes[sala]) {
            socket.emit('historialSala', historialMensajes[sala]);
        }

        // 5. Avisar a TODOS en la nueva sala (incluido el nuevo) para actualizar la lista
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

    // Evento: Desconexión (Cerrar ventana)
    socket.on('disconnect', () => {
        const usuario = usuariosConectados[socket.id];
        if (usuario) {
            const salaDondeEstaba = usuario.sala;
            // Borrar del registro
            delete usuariosConectados[socket.id];
            // Avisar a la sala para que lo borren de la lista visual
            io.to(salaDondeEstaba).emit('actualizarUsuarios', obtenerUsuariosDeSala(salaDondeEstaba));
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});