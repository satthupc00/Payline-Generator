// ---------------------------------------------------------------------------
// Auto update — installed copies check GitHub Releases of this repo (see "publish" in
// package.json) at startup and every hour. A newer version is downloaded in the background, then
// the user is asked to restart; if they choose "later" it installs on the next quit.
// Only works for copies installed with the Setup .exe (NSIS), not the portable .exe.
// ---------------------------------------------------------------------------
const { app, ipcMain, dialog, net } = require('electron');

const CHECK_EVERY_MS = 60 * 60 * 1000;
const LATEST_YML = 'https://github.com/satthupc00/Payline-Generator/releases/latest/download/latest.yml';

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

// true = this copy is the newest release, false = a newer one exists, null = couldn't tell
// (offline). Reads the same latest.yml the updater uses, so it also works when run with npm start.
ipcMain.handle('check-latest', async () => {
  try {
    const res = await net.fetch(`${LATEST_YML}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return { result: null };
    const m = (await res.text()).match(/^version:\s*['"]?([\d.]+)/m);
    return { result: m ? compareVersions(app.getVersion(), m[1]) >= 0 : null };
  } catch (e) {
    return { result: null };
  }
});

function notesToText(notes) {
  if (!notes) return '';
  const raw = Array.isArray(notes) ? notes.map(n => n.note || '').join('\n') : String(notes);
  return raw.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '').trim();
}

function initUpdater(getWindow) {
  if (!app.isPackaged) return;
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const send = status => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('update-status', status);
  };
  const install = () => autoUpdater.quitAndInstall(true, true);

  autoUpdater.on('update-available', info => send({ state: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('download-progress', p => send({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', async info => {
    send({ state: 'ready', version: info.version });
    const win = getWindow();
    const notes = notesToText(info.releaseNotes);
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Có bản cập nhật',
      message: `Payline Generator v${info.version} đã tải xong`,
      detail: (notes ? notes + '\n\n' : '') + 'Khởi động lại app để cập nhật ngay?',
      buttons: ['Cập nhật ngay', 'Để sau'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    if (response === 0) install();
  });
  autoUpdater.on('error', err => {
    console.warn('[updater]', err && err.message);
    send({ state: 'error' });
  });

  ipcMain.on('update-install', install);

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 3000);
  setInterval(check, CHECK_EVERY_MS);
}

module.exports = { initUpdater };
