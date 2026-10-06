const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');
const PRESETS_FILE = path.join(app.getPath('userData'), 'grid-presets.json');

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return { width: 1280, height: 820, x: undefined, y: undefined };
  }
}

function saveWindowState(win) {
  const bounds = win.getBounds();
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(bounds));
  } catch {}
}

let mainWindow;

function createWindow() {
  const state = loadWindowState();
  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#150c28',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('close', () => saveWindowState(mainWindow));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---- IPC: file dialogs ----

ipcMain.handle('dialog:openImages', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }]
  });
  if (res.canceled) return [];
  return res.filePaths.map((p) => {
    const data = fs.readFileSync(p);
    return { path: p, name: path.basename(p), dataUrl: `data:image/${path.extname(p).slice(1)};base64,${data.toString('base64')}` };
  });
});

ipcMain.handle('dialog:openFlipbookFolder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (res.canceled || res.filePaths.length === 0) return [];
  const dir = res.filePaths[0];
  const IMG_EXT = new Set(['.png', '.jpg', '.jpeg']);
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => IMG_EXT.has(path.extname(f).toLowerCase()));
  } catch {
    return [];
  }
  files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return files.map((f) => {
    const p = path.join(dir, f);
    const data = fs.readFileSync(p);
    return { path: p, name: f, dataUrl: `data:image/${path.extname(f).slice(1)};base64,${data.toString('base64')}` };
  });
});

ipcMain.handle('dialog:openSingleImage', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }]
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  const p = res.filePaths[0];
  const data = fs.readFileSync(p);
  return { path: p, name: path.basename(p), dataUrl: `data:image/${path.extname(p).slice(1)};base64,${data.toString('base64')}` };
});

ipcMain.handle('dialog:chooseOutputFolder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  if (res.canceled) return null;
  return res.filePaths[0];
});

ipcMain.handle('fs:exportBundle', async (evt, { outputDir, baseName, jsonText, atlasText, pngPages }) => {
  try {
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, `${baseName}.json`), jsonText, 'utf-8');
    fs.writeFileSync(path.join(outputDir, `${baseName}.atlas`), atlasText, 'utf-8');
    for (const page of pngPages) {
      const base64 = page.dataUrl.split(',')[1];
      fs.writeFileSync(path.join(outputDir, page.fileName), Buffer.from(base64, 'base64'));
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('presets:load', async () => {
  try {
    return JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf-8'));
  } catch {
    return {};
  }
});

ipcMain.handle('presets:save', async (evt, presets) => {
  try {
    fs.writeFileSync(PRESETS_FILE, JSON.stringify(presets, null, 2));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});
