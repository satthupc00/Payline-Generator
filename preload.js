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
