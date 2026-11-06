// Reels Analyzer for Windows. Starts the bundled Next.js server on 127.0.0.1
// with Electron's own Node, keeps the user's files in %APPDATA%\Reels Analyzer
// (APP_DATA_DIR, src/lib/paths.ts) and shows the app in its own window.

const { app, BrowserWindow, Menu, dialog, screen, session, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { execFileSync, spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { parseEnv } = require('node:util');

const NAME = 'Reels Analyzer';
// The same port on every start keeps the page's origin, and the language it saved, the same
const PREFERRED_PORT = 3217;
const START_TIMEOUT_MS = 90_000;

const dataDir = path.join(app.getPath('appData'), NAME);
const settingsFile = path.join(dataDir, '.env.local');
const logFile = path.join(dataDir, 'logs', 'app.log');
// Installed: resources\{server,ffmpeg,licenses,server-host.js}. From source (npm start): the same under stage\
const resources = app.isPackaged ? process.resourcesPath : path.join(__dirname, 'stage');
// The server's APP_PASSWORD, new on every start. Only this window sends it (see onBeforeSendHeaders),
// so other programs and web pages can't use the local server.
const password = randomBytes(24).toString('hex');

// The window's own browser data (cache, local storage) goes to %LOCALAPPDATA%, not into the data folder.
// Before the single-instance lock, which lives there.
app.setPath('userData', path.join(process.env.LOCALAPPDATA, NAME));
app.setAppUserModelId('com.alphaacode.reelsanalyzer');

fs.mkdirSync(path.dirname(logFile), { recursive: true });
// ponytail: one log, set aside once it passes 5 MB
try { if (fs.statSync(logFile).size > 5e6) fs.renameSync(logFile, `${logFile}.old`); } catch { /* no log yet */ }
const logStream = fs.createWriteStream(logFile, { flags: 'a' });
const log = line => logStream.write(`${new Date().toISOString()} ${line}\n`);

const STRINGS = {
    en: {
        file: 'File', openData: 'Open data folder', openSettings: 'Open settings file', checkUpdates: 'Check for updates…', quit: 'Quit',
        view: 'View', reload: 'Reload', actualSize: 'Actual size', zoomIn: 'Zoom in', zoomOut: 'Zoom out',
        cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select all',
        starting: 'Starting…',
        failed: 'Reels Analyzer could not start.',
        failedDetail: 'Close this window and open the app again. If it fails again, the reason is in this log:',
        settingsChanged: 'Your settings changed. Restart Reels Analyzer now to use them?',
        restartNow: 'Restart now', later: 'Later',
        updateAvailable: v => `Reels Analyzer ${v} is available. Download it now?`,
        download: 'Download',
        updateReady: v => `Reels Analyzer ${v} is downloaded. Restart now to install it?`,
        updateReadyDetail: 'If you choose Later, it installs when you quit the app.',
        restartInstall: 'Restart and install',
        upToDate: v => `You have the latest version (${v}).`,
        updateFailed: 'Could not check for updates.'
    },
    ar: {
        file: 'ملف', openData: 'فتح مجلد البيانات', openSettings: 'فتح ملف الإعدادات', checkUpdates: 'البحث عن تحديثات…', quit: 'خروج',
        view: 'عرض', reload: 'إعادة التحميل', actualSize: 'الحجم الفعلي', zoomIn: 'تكبير', zoomOut: 'تصغير',
        cut: 'قص', copy: 'نسخ', paste: 'لصق', selectAll: 'تحديد الكل',
        starting: 'جارٍ التشغيل…',
        failed: 'تعذّر تشغيل Reels Analyzer.',
        failedDetail: 'أغلق هذه النافذة وافتح التطبيق مرة أخرى. إذا تكرر الخطأ، فسببه مكتوب في هذا السجل:',
        settingsChanged: 'تغيّرت إعداداتك. هل تريد إعادة تشغيل Reels Analyzer الآن لاستخدامها؟',
        restartNow: 'إعادة التشغيل الآن', later: 'لاحقًا',
        updateAvailable: v => `الإصدار ${v} من Reels Analyzer متاح. هل تريد تنزيله الآن؟`,
        download: 'تنزيل',
        updateReady: v => `اكتمل تنزيل الإصدار ${v} من Reels Analyzer. هل تريد إعادة التشغيل لتثبيته الآن؟`,
        updateReadyDetail: 'إذا اخترت «لاحقًا»، فسيُثبَّت عند إغلاق التطبيق.',
        restartInstall: 'إعادة التشغيل والتثبيت',
        upToDate: v => `لديك أحدث إصدار (${v}).`,
        updateFailed: 'تعذّر البحث عن تحديثات.'
    }
};
let t = STRINGS.en;

let win;
let server;
let origin;
let running = {};
let offered;
let quitting = false;
let checking = false;

/** The settings file's filled-in values (a fresh copy of .env.example has none). */
function readSettings() {
    if (!fs.existsSync(settingsFile)) return {};
    return Object.fromEntries(Object.entries(parseEnv(fs.readFileSync(settingsFile, 'utf8'))).filter(([, value]) => value.trim()));
}

function serverEnv(port, settings) {
    const env = { ...process.env };
    // Windows names it Path; a second PATH key would leave the server with either one
    const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH';
    // Where npm, the CLI's native installer and Node put their commands, for the Edit tab's planner and its self-check
    env[pathKey] = [env[pathKey], path.join(app.getPath('appData'), 'npm'), path.join(os.homedir(), '.local', 'bin'),
        path.join(process.env.LOCALAPPDATA, 'Programs', 'nodejs')].filter(Boolean).join(path.delimiter);
    return Object.assign(env, {
        FFMPEG_PATH: path.join(resources, 'ffmpeg', 'ffmpeg.exe'),
        FFPROBE_PATH: path.join(resources, 'ffmpeg', 'ffprobe.exe')
    }, settings, {
        APP_DATA_DIR: dataDir,
        APP_PASSWORD: password,
        HOSTNAME: '127.0.0.1',
        PORT: String(port),
        NEXT_TELEMETRY_DISABLED: '1',
        ELECTRON_RUN_AS_NODE: '1'
    });
}

const isServer = url => Boolean(origin) && (url === origin || url.startsWith(`${origin}/`));

const listen = port => new Promise((resolve, reject) => {
    const probe = net.createServer().once('error', reject);
    probe.listen(port, '127.0.0.1', () => {
        const { port: free } = probe.address();
        probe.close(() => resolve(free));
    });
});

/** Start the server and wait for /api/health. False when it stopped or never answered. */
async function startServer() {
    const port = await listen(PREFERRED_PORT).catch(() => listen(0));
    origin = `http://127.0.0.1:${port}`;
    running = readSettings();
    const child = spawn(process.execPath, [path.join(resources, 'server-host.js')], {
        env: serverEnv(port, running),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
    });
    server = child;
    log(`server starting on ${origin}`);
    child.stdout.on('data', chunk => logStream.write(chunk));
    child.stderr.on('data', chunk => logStream.write(chunk));
    child.on('error', error => log(`server did not start: ${error.message}`));
    child.on('exit', code => {
        log(`server stopped (exit code ${code})`);
        if (server === child && !quitting) showError();
    });
    const started = Date.now();
    while (child.exitCode === null && Date.now() - started < START_TIMEOUT_MS) {
        try {
            if ((await fetch(`${origin}/api/health`)).ok) {
                log(`server ready after ${Date.now() - started} ms, ${Math.round(process.uptime() * 1000)} ms after launch`);
                return true;
            }
        } catch { /* not listening yet */ }
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    return false;
}

function stopServer() {
    const child = server;
    server = undefined;
    if (!child || child.exitCode !== null) return;
    try {
        // The whole tree: the server and any ffmpeg or planner run it started
        execFileSync(path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } catch { /* already gone */ }
}

const escape = text => text.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
const page = body => 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html>
<html dir="${t === STRINGS.ar ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${NAME}</title><style>
body{margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:0 32px;box-sizing:border-box;
background:#0F0F0F;color:#d1d5db;font:15px "Segoe UI",Tahoma,sans-serif;text-align:center}
h1{margin:0;font-size:24px;background:linear-gradient(90deg,#ec4899,#f97316);-webkit-background-clip:text;color:transparent}
p{margin:0;max-width:640px;line-height:1.6}code{color:#f9a8d4;user-select:all;word-break:break-all}
.spin{width:28px;height:28px;border:3px solid #374151;border-top-color:#ec4899;border-radius:50%;animation:s 1s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}</style></head><body>${body}</body></html>`);

const showSplash = () => win?.loadURL(page(`<h1>${NAME}</h1><div class="spin"></div><p>${t.starting}</p>`));
const showError = () => win?.loadURL(page(`<h1>${t.failed}</h1><p>${t.failedDetail}</p><p><code>${escape(logFile)}</code></p>`));

async function launch() {
    if (await startServer()) {
        win?.loadURL(origin);
    } else {
        stopServer();
        showError();
    }
}

async function restart() {
    stopServer();
    showSplash();
    await launch();
}

function openSettings() {
    if (!fs.existsSync(settingsFile)) fs.copyFileSync(path.join(resources, 'server', '.env.example'), settingsFile);
    // .env.local has no program of its own on Windows; Notepad is always there
    spawn('notepad.exe', [settingsFile], { detached: true, stdio: 'ignore' }).unref();
}

// However the settings file was edited, offer a restart once its values differ from the server's
fs.watchFile(settingsFile, { interval: 1000 }, async () => {
    const values = JSON.stringify(readSettings());
    if (!win || values === JSON.stringify(running) || values === offered) return;
    offered = values;
    const { response } = await dialog.showMessageBox(win, {
        type: 'question', message: t.settingsChanged, buttons: [t.restartNow, t.later], defaultId: 0, cancelId: 1
    });
    if (response === 0) await restart();
});

/** At start the outcome only goes to the log; from the menu it is shown. */
async function checkForUpdates(fromMenu) {
    if (!app.isPackaged || checking) return;
    checking = true;
    try {
        const result = await autoUpdater.checkForUpdates();
        if (!result?.isUpdateAvailable) {
            if (fromMenu) await dialog.showMessageBox(win, { type: 'info', message: t.upToDate(app.getVersion()) });
            return;
        }
        const { version } = result.updateInfo;
        const ask = await dialog.showMessageBox(win, {
            type: 'question', message: t.updateAvailable(version), buttons: [t.download, t.later], defaultId: 0, cancelId: 1
        });
        if (ask.response !== 0) return;
        await autoUpdater.downloadUpdate();
        win?.setProgressBar(-1);
        const install = await dialog.showMessageBox(win, {
            type: 'question', message: t.updateReady(version), detail: t.updateReadyDetail,
            buttons: [t.restartInstall, t.later], defaultId: 0, cancelId: 1
        });
        if (install.response === 0) autoUpdater.quitAndInstall(true, true);
    } catch (error) {
        // The updater's logger has already written the error
        win?.setProgressBar(-1);
        if (fromMenu) await dialog.showMessageBox(win, { type: 'warning', message: t.updateFailed, detail: error.message });
    } finally {
        checking = false;
    }
}

function createWindow() {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    win = new BrowserWindow({
        width: Math.min(1280, width),
        height: Math.min(900, height),
        minWidth: 420,
        minHeight: 500,
        title: NAME,
        backgroundColor: '#0F0F0F',
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
    });
    win.on('page-title-updated', event => event.preventDefault());
    win.on('closed', () => { win = undefined; });

    // The app's own pages stay in the window; every other http(s) link opens in the default browser
    const openOutside = url => { if (/^https?:\/\//i.test(url) && !isServer(url)) shell.openExternal(url); };
    win.webContents.setWindowOpenHandler(({ url }) => {
        openOutside(url);
        return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event, url) => {
        if (isServer(url)) return;
        event.preventDefault();
        openOutside(url);
    });

    win.webContents.on('context-menu', (_event, { isEditable, selectionText }) => {
        if (!isEditable && !selectionText.trim()) return;
        Menu.buildFromTemplate(isEditable
            ? [{ role: 'cut', label: t.cut }, { role: 'copy', label: t.copy }, { role: 'paste', label: t.paste }, { type: 'separator' }, { role: 'selectAll', label: t.selectAll }]
            : [{ role: 'copy', label: t.copy }]
        ).popup({ window: win });
    });
    showSplash();
}

function setMenu() {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
        {
            label: t.file,
            submenu: [
                { label: t.openData, click: () => shell.openPath(dataDir) },
                { label: t.openSettings, click: openSettings },
                { label: t.checkUpdates, click: () => checkForUpdates(true) },
                { type: 'separator' },
                { role: 'quit', label: t.quit }
            ]
        },
        {
            label: t.view,
            submenu: [
                { role: 'reload', label: t.reload },
                { type: 'separator' },
                { role: 'resetZoom', label: t.actualSize },
                { role: 'zoomIn', label: t.zoomIn },
                { role: 'zoomOut', label: t.zoomOut }
            ]
        }
    ]));
}

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (!win) return;
        if (win.isMinimized()) win.restore();
        win.focus();
    });
    app.on('before-quit', () => {
        quitting = true;
        stopServer();
    });
    app.on('window-all-closed', () => app.quit());

    app.whenReady().then(async () => {
        log(`${NAME} ${app.getVersion()} starting (Electron ${process.versions.electron})`);
        t = app.getLocale().startsWith('ar') ? STRINGS.ar : STRINGS.en;
        session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
            const requestHeaders = details.requestHeaders;
            if (isServer(details.url)) requestHeaders.Authorization = `Basic ${Buffer.from(`app:${password}`).toString('base64')}`;
            callback({ requestHeaders });
        });
        autoUpdater.autoDownload = false;
        autoUpdater.disableWebInstaller = true;   // releases ship the full installer only
        autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };
        autoUpdater.on('download-progress', ({ percent }) => win?.setProgressBar(percent / 100));
        setMenu();
        createWindow();
        await launch();
        checkForUpdates(false);
    });
}
