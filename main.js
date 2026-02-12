const { app, BrowserWindow } = require('electron');
const path = require('path');

// 1. IMPORTAR E INICIAR EL SERVIDOR
// Al hacer require, node ejecuta el código de server.js inmediatamente.
// Esto levanta el servidor en el puerto 3000 en segundo plano.
require('./server.js'); 

function createWindow() {
    // 2. CREAR LA VENTANA
    const win = new BrowserWindow({
        width: 1000,
        height: 800,
        title: "Mi Discord Local",
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false, // Para facilitar prototipado rápido
            // En producción, esto debería ser true y usar preload scripts
        },
        autoHideMenuBar: true, // Ocultar la barra de menú clásica
        icon: path.join(__dirname, 'icon.png') // (Opcional si tienes icono)
    });

    // 3. CARGAR LA UI
    // Importante: No cargamos 'index.html' como archivo local (file://),
    // sino que nos conectamos a nuestro propio servidor local.
    // Esto asegura que la experiencia sea idéntica a la de tus amigos.
    win.loadURL('http://localhost:3000');
    
    // Abrir herramientas de desarrollo (F12)
    // win.webContents.openDevTools(); 
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});