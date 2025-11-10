// dashboards/electron/main/main.js
import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'fs/promises';
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow = null;
let runtimeProcess = null;

// Create the main window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
  // Prefer CommonJS preload to avoid ESM loader issues in Electron
  // Falls back to ESM preload if needed
  preload: join(__dirname, '../preload/preload.cjs'),
    },
    title: 'Mineflayer Dashboard',
    backgroundColor: '#1e1e1e',
  });

  // Load the renderer
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'));
    mainWindow.webContents.openDevTools(); // Open dev tools to see errors
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Spawn the bot runtime process
function spawnRuntime() {
  const runtimePath = join(__dirname, '../../../src/dashboard/runtimeEntry.js');
  
  console.log('[Main] Spawning runtime:', runtimePath);
  
  runtimeProcess = spawn(process.execPath, [runtimePath], {
    env: {
      ...process.env,
      DASHBOARD_MODE: 'electron',
      FORCE_COLOR: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Process STDOUT as line-delimited JSON events
  const rlOut = readline.createInterface({
    input: runtimeProcess.stdout,
    crlfDelay: Infinity,
  });

  rlOut.on('line', (line) => {
    try {
      const event = JSON.parse(line);
      console.log('[Main] Runtime event:', event.type);
      
      // Forward to renderer
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(`runtime:${event.type}`, event.payload);
      }
    } catch (_err) {
      // Not JSON, treat as plain log
      console.log('[Runtime]', line);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('runtime:log', {
          level: 'info',
          message: line,
          timestamp: new Date().toISOString(),
        });
      }
    }
  });

  // Forward STDERR as error logs
  const rlErr = readline.createInterface({
    input: runtimeProcess.stderr,
    crlfDelay: Infinity,
  });

  rlErr.on('line', (line) => {
    console.error('[Runtime Error]', line);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('runtime:log', {
        level: 'error',
        message: line,
        timestamp: new Date().toISOString(),
      });
    }
  });

  runtimeProcess.on('error', (err) => {
    console.error('[Main] Runtime spawn error:', err);
  });

  runtimeProcess.on('exit', (code, signal) => {
    console.log(`[Main] Runtime exited with code ${code}, signal ${signal}`);
    runtimeProcess = null;
    
    // Optionally restart on unexpected exit
    if (code !== 0 && !app.isQuitting) {
      console.log('[Main] Restarting runtime in 3 seconds...');
      setTimeout(spawnRuntime, 3000);
    }
  });

  return runtimeProcess;
}

// IPC handlers
ipcMain.on('command:execute', (_event, payload) => {
  if (runtimeProcess && runtimeProcess.stdin) {
    const message = JSON.stringify({ type: 'command:execute', payload });
    console.log('[Main] IPC command:execute received, forwarding to runtime:', message);
    console.log('[Main] runtime.stdin writable?', !!runtimeProcess.stdin.writable);
    const ok = runtimeProcess.stdin.write(message + '\n');
    console.log('[Main] runtime.stdin.write returned', ok);
    // Synthetic echo so renderer can observe the inbox immediately while we debug
    if (mainWindow && !mainWindow.isDestroyed()) {
      try { mainWindow.webContents.send('runtime:inbox', { type: 'command:execute', payload }); } catch (_) {}
    }
  }
});

// Bot management IPC
ipcMain.on('bot:add', (_event, payload) => {
  console.log('[Main] IPC bot:add received', payload);
  if (runtimeProcess && runtimeProcess.stdin) {
    const message = JSON.stringify({ type: 'bot:add', payload });
    console.log('[Main] Forwarding bot:add to runtime stdin:', message);
    console.log('[Main] runtime.stdin writable?', !!runtimeProcess.stdin.writable);
    const ok = runtimeProcess.stdin.write(message + '\n');
    console.log('[Main] runtime.stdin.write returned', ok);
    if (mainWindow && !mainWindow.isDestroyed()) {
      try { mainWindow.webContents.send('runtime:inbox', { type: 'bot:add', payload }); } catch (_) {}
    }
  } else {
    console.warn('[Main] Cannot forward bot:add - runtime not running');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('runtime:log', { level: 'warn', message: 'Cannot add bot: runtime not running', timestamp: new Date().toISOString() });
    }
  }
});

ipcMain.on('bot:remove', (_event, payload) => {
  console.log('[Main] IPC bot:remove received', payload);
  if (runtimeProcess && runtimeProcess.stdin) {
    const message = JSON.stringify({ type: 'bot:remove', payload });
    console.log('[Main] Forwarding bot:remove to runtime stdin:', message);
    console.log('[Main] runtime.stdin writable?', !!runtimeProcess.stdin.writable);
    const ok = runtimeProcess.stdin.write(message + '\n');
    console.log('[Main] runtime.stdin.write returned', ok);
    if (mainWindow && !mainWindow.isDestroyed()) {
      try { mainWindow.webContents.send('runtime:inbox', { type: 'bot:remove', payload }); } catch (_) {}
    }
  } else {
    console.warn('[Main] Cannot forward bot:remove - runtime not running');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('runtime:log', { level: 'warn', message: 'Cannot remove bot: runtime not running', timestamp: new Date().toISOString() });
    }
  }
});

ipcMain.handle('command:list', async () => {
  return new Promise((resolve) => {
    if (!runtimeProcess || !runtimeProcess.stdin) {
      resolve([]);
      return;
    }

    // Listen for commandMeta event
    const handler = (_event, commands) => {
      ipcMain.removeListener('runtime:commandMeta', handler);
      resolve(commands);
    };
    
    mainWindow.webContents.once('runtime:commandMeta', handler);
    
    const message = JSON.stringify({ type: 'command:list', payload: {} });
    runtimeProcess.stdin.write(message + '\n');

    // Timeout after 5 seconds
    setTimeout(() => {
      mainWindow.webContents.removeListener('runtime:commandMeta', handler);
      resolve([]);
    }, 5000);
  });
});

// Provide item categories to renderer (flattened list for highlighting)
ipcMain.handle('items:list', async () => {
  try {
    const filePath = join(__dirname, '../../../src/config/itemCategories.json');
    const raw = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw);
    const list = Object.values(data).flat();
    return Array.from(new Set(list));
  } catch (_e) {
    return [];
  }
});

// App lifecycle
app.whenReady().then(() => {
  createWindow();
  spawnRuntime();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  app.isQuitting = true;
  
  if (runtimeProcess) {
    runtimeProcess.kill('SIGTERM');
    runtimeProcess = null;
  }
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  
  if (runtimeProcess) {
    runtimeProcess.kill('SIGTERM');
    runtimeProcess = null;
  }
});
