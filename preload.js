// Puente seguro entre la página (public/index.html) y el proceso principal de Electron.
// La página NO tiene acceso a Node.js: solo puede usar estas dos funciones.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Arranca el servidor local con la contraseña indicada. Devuelve { ok, error? }
    iniciarHost: (password) => ipcRenderer.invoke('iniciar-host', password),
    // Devuelve las IPs del equipo: Array<{ interface, ip }>
    obtenerIpsHost: () => ipcRenderer.invoke('obtener-ips-host')
});
