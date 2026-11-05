import { spawn, type ChildProcess } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const node = process.execPath;
const serverDir = path.join(root, 'apps', 'server');
const webDir = path.join(root, 'apps', 'web');

// fs.watch (and therefore `node --watch`) never reports saves on this
// Windows drive, so the API is restarted from a poll of the source trees.
const watchDirs = [
  path.join(serverDir, 'src'),
  path.join(root, 'packages', 'shared', 'src'),
];

let server: ChildProcess | null = null;
let web: ChildProcess | null = null;
let stopping = false;
let restarting = false;
let seen = snapshot();

function snapshot(): string {
  const parts: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
      try {
        const st = statSync(full);
        parts.push(`${full}\0${st.mtimeMs}\0${st.size}`);
      } catch {
        // The file went away between the directory read and the stat.
      }
    }
  };
  for (const dir of watchDirs) walk(dir);
  parts.sort();
  return parts.join('\n');
}

function startServer(): void {
  server = spawn(node, ['src/index.ts'], {
    cwd: serverDir,
    stdio: 'inherit',
    env: process.env,
    windowsHide: true,
  });
  server.on('error', (err) => {
    console.error(`[server] ${err.message}`);
  });
  server.on('exit', (code, signal) => {
    if (stopping || restarting) return;
    if (signal === 'SIGTERM' || signal === 'SIGINT') return;
    if (code !== 0 && code !== null) console.error(`[server] exited with code ${code}`);
  });
}

function restartServer(): void {
  if (stopping || restarting) return;
  const current = server;
  console.log('[server] source changed, restarting');
  if (current === null || current.exitCode !== null) {
    startServer();
    return;
  }
  restarting = true;
  current.kill();
  const killTimer = setTimeout(() => {
    if (current.exitCode === null) current.kill('SIGKILL');
  }, 1000);
  current.once('exit', () => {
    clearTimeout(killTimer);
    setTimeout(() => {
      restarting = false;
      if (!stopping) startServer();
    }, 100);
  });
}

function startWeb(): void {
  web = spawn(node, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')], {
    cwd: webDir,
    stdio: 'inherit',
    env: process.env,
    windowsHide: true,
  });
  web.on('error', (err) => {
    console.error(`[web] ${err.message}`);
  });
  web.on('exit', (code, signal) => {
    if (stopping) return;
    if (signal === 'SIGTERM' || signal === 'SIGINT') return;
    if (code !== 0 && code !== null) console.error(`[web] exited with code ${code}`);
    shutdown();
  });
}

function shutdown(): void {
  if (stopping) return;
  stopping = true;
  for (const child of [server, web]) {
    if (child !== null && child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('[dev] api restarts when server or shared source changes');
startServer();
startWeb();

setInterval(() => {
  if (stopping || restarting) return;
  const next = snapshot();
  if (next === seen) return;
  seen = next;
  restartServer();
}, 300);
