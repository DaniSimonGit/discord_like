const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// Mantenemos tu parche de seguridad para el micrófono en ZeroTier
app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', 'http://10.222.195.2:3000');

// Variable para no encender el servidor dos veces por accidente
let servidorIniciado = false;

function createWindow() {
    const win = new BrowserWindow({
        width: 1000,
        height: 800,
        title: "Mi Discord Local",
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false, // Vital para que nuestro HTML pueda hablar con Node.js
        },
        autoHideMenuBar: true,
        icon: path.join(__dirname, 'icon.png') 
    });

    // 1. EL CAMBIO CLAVE: Cargamos el archivo físico, no una URL.
    // Así la ventana se abre siempre, esté el servidor encendido o apagado.
    win.loadFile(path.join(__dirname, 'public', 'index.html'));
    
    win.webContents.openDevTools(); 
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

const os = require('os');

// 2. EL INTERRUPTOR MÁGICO (Cerebro Node.js)
// Escuchamos la señal que nos mandará el HTML cuando pulses "Hostear"
ipcMain.on('iniciar-host', (event) => {
    if (!servidorIniciado) {
        console.log("Orden recibida: Encendiendo el servidor local...");
        require('./server.js'); // Encendemos la discoteca
        servidorIniciado = true;
        // Le avisamos al HTML de que ya está listo
        event.reply('host-iniciado', 'ok');
    } else {
        event.reply('host-iniciado', 'ok');
    }
});

// Obtener IPs locales (LAN / ZeroTier / VPN) para mostrarlas al Host
ipcMain.on('obtener-ips-host', (event) => {
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const name in interfaces) {
        for (const net of interfaces[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                ips.push({ interface: name, ip: net.address });
            }
        }
    }
    event.reply('ips-host-obtenidas', ips);
});