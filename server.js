const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Servir la carpeta 'public' donde estará el HTML
app.use(express.static(path.join(__dirname, 'public')));

// Lógica de conexión
io.on('connection', (socket) => {
    console.log('Un usuario se ha conectado');

    // Evento: Unirse a una sala
    socket.on('unirseSala', (sala) => {
        socket.join(sala);
        // Notificar al usuario (opcional)
        socket.emit('notificacion', `Te has unido a la sala: ${sala}`);
    });

    // Evento: Recibir mensaje y reenviarlo a la sala
    socket.on('mensajeChat', ({ sala, usuario, texto }) => {
        // Enviar solo a las personas en esa sala
        io.to(sala).emit('mensajeChat', { usuario, texto });
    });

    socket.on('disconnect', () => {
        console.log('Un usuario se ha desconectado');
    });
});

// Arrancar el servidor en el puerto 3000
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});