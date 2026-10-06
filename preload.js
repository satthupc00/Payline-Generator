const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('paylineAPI', {
  openImages: () => ipcRenderer.invoke('dialog:openImages'),
  openFlipbookFolder: () => ipcRenderer.invoke('dialog:openFlipbookFolder'),
  openSingleImage: () => ipcRenderer.invoke('dialog:openSingleImage'),
  chooseOutputFolder: () => ipcRenderer.invoke('dialog:chooseOutputFolder'),
  exportBundle: (payload) => ipcRenderer.invoke('fs:exportBundle', payload),
  loadPresets: () => ipcRenderer.invoke('presets:load'),
  savePresets: (presets) => ipcRenderer.invoke('presets:save', presets),
  exportPresetFile: (payload) => ipcRenderer.invoke('presets:exportFile', payload),
  importPresetFile: () => ipcRenderer.invoke('presets:importFile')
});

// Lock screen, Admin panel and update pill (renderer/license-ui.js). Handlers live in license.js / updater.js.
contextBridge.exposeInMainWorld('licenseAPI', {
  appVersion: ipcRenderer.sendSync('get-app-version'),
  invoke: (channel, ...args) => {
    const allowed = ['license-check', 'license-activate', 'admin-status', 'admin-login', 'admin-logout',
      'admin-list', 'admin-add', 'admin-set-active', 'admin-remove', 'admin-regenerate', 'clipboard-write', 'check-latest'];
    if (!allowed.includes(channel)) return Promise.reject(new Error('Kênh không hợp lệ: ' + channel));
    return ipcRenderer.invoke(channel, ...args);
  },
  onLicenseStatus: (cb) => ipcRenderer.on('license-status', (_e, status) => cb(status)),
  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (_e, status) => cb(status)),
  installUpdate: () => ipcRenderer.send('update-install')
});
