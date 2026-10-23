const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const os = require('os');

// No hace falta 'unsafely-treat-insecure-origin-as-secure' para el micrófono:
// la UI se carga con loadFile (origen file://), que Chromium ya considera seguro,
// aunque Socket.io/PeerJS se conecten luego por HTTP a la IP del Host (LAN/VPN).

const RUTA_INDEX = path.join(__dirname, 'public', 'index.html');
const URL_INDEX = pathToFileURL(RUTA_INDEX).href;

// Permisos que la página puede pedir: micrófono, copiar IP al portapapeles y elegir altavoz
const PERMISOS_PERMITIDOS = ['media', 'clipboard-sanitized-write', 'speaker-selection'];

function createWindow() {
    const win = new BrowserWindow({
        width: 1000,
        height: 800,
        title: "Mi Discord Local",
        webPreferences: {
            // SEGURIDAD: la página no tiene acceso a Node.js. Si alguien consiguiera
            // inyectar código en el chat, no podría tocar el ordenador.
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            preload: path.join(__dirname, 'preload.js')
        },
        autoHideMenuBar: true,
        icon: path.join(__dirname, 'icon.png')
    });

    // 1. EL CAMBIO CLAVE: Cargamos el archivo físico, no una URL.
    // Así la ventana se abre siempre, esté el servidor encendido o apagado.
    win.loadFile(RUTA_INDEX);

    // SEGURIDAD: la ventana solo puede mostrar nuestra propia página
    win.webContents.on('will-navigate', (event, url) => {
        if (url.split('#')[0] !== URL_INDEX) event.preventDefault();
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    // Las herramientas de desarrollador solo se abren solas en desarrollo (npm start), no en el .exe
    if (!app.isPackaged) win.webContents.openDevTools();
}

app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((webContents, permiso, callback) => {
        callback(PERMISOS_PERMITIDOS.includes(permiso));
    });
    createWindow();
});

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

// SEGURIDAD: solo atendemos peticiones IPC que vengan de nuestra página
function esNuestraPagina(event) {
    return event.senderFrame && event.senderFrame.url.split('#')[0] === URL_INDEX;
}

// 2. EL INTERRUPTOR MÁGICO (Cerebro Node.js)
// Recibimos la señal que nos manda el HTML cuando pulsas "Hostear"
ipcMain.handle('iniciar-host', (event, password) => {
    if (!esNuestraPagina(event)) return { ok: false, error: 'Origen no permitido' };
    const { iniciarServidor, MIN_PASSWORD } = require('./server.js');
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
        return { ok: false, error: `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.` };
    }
    console.log("Orden recibida: Encendiendo el servidor local...");
    iniciarServidor(password); // Si ya estaba encendido, solo actualiza la contraseña
    return { ok: true };
});

// Obtener IPs locales (LAN / VPN) para mostrarlas al Host
ipcMain.handle('obtener-ips-host', (event) => {
    if (!esNuestraPagina(event)) return [];
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const name in interfaces) {
        for (const net of interfaces[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                ips.push({ interface: name, ip: net.address });
            }
        }
    }
    return ips;
});
