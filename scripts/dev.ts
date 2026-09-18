import { spawn, type ChildProcess } from 'node:child_process';

const children: ChildProcess[] = [];

function run(label: string, args: readonly string[]): ChildProcess {
  const child = spawn('npm', args, {
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', (code, signal) => {
    if (signal === 'SIGTERM' || signal === 'SIGINT') return;
    if (code !== 0 && code !== null) {
      console.error(`[${label}] exited with code ${code}`);
    }
  });
  children.push(child);
  return child;
}

run('server', ['run', 'dev', '-w', '@clash/server']);
run('web', ['run', 'dev', '-w', '@clash/web']);

function shutdown(): void {
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await Promise.all(
  children.map(
    (child) =>
      new Promise<void>((resolve) => {
        child.on('exit', () => resolve());
      }),
  ),
);
