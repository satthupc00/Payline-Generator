const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { initLicense, isLocked } = require('./license.js');
const { initUpdater } = require('./updater.js');

ipcMain.on('get-app-version', (e) => { e.returnValue = app.getVersion(); });

// Must match build.appId so Windows groups the installed app under its own name, not "Electron".
if (process.platform === 'win32') app.setAppUserModelId('com.mondiro.paylinegenerator');
app.setName('Mondiro Payline Generator');

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

app.whenReady().then(() => {
  // No default menu: its shortcuts (reload, DevTools) could get past the lock screen.
  Menu.setApplicationMenu(null);
  createWindow();
  initLicense(() => mainWindow);
  initUpdater(() => mainWindow);
});

// F12 / Ctrl+Shift+I open DevTools only while the app is unlocked.
app.on('browser-window-created', (_e, win) => {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const devtools = input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i');
    if (devtools && !isLocked()) {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
});

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
  if (isLocked()) return { ok: false, error: 'App chưa được kích hoạt.' };
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
  if (isLocked()) return { ok: false, error: 'App chưa được kích hoạt.' };
  try {
    fs.writeFileSync(PRESETS_FILE, JSON.stringify(presets, null, 2));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});
