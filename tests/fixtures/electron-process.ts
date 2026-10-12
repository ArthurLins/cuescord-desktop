import { spawnSync } from 'node:child_process';
import path from 'node:path';

/** Terminates only the process tree owned by a journey's Electron application. */
export function terminateWindowsProcessTree(pid: number | undefined) {
  if (!Number.isSafeInteger(pid) || !pid || pid <= 0)
    throw new Error('Electron cleanup requires its own positive process ID');
  const windowsRoot = process.env.SystemRoot;
  if (!windowsRoot || !path.win32.isAbsolute(windowsRoot))
    throw new Error('Windows cleanup requires an absolute SystemRoot');
  const command = path.win32.join(windowsRoot, 'System32', 'taskkill.exe');
  const result = spawnSync(command, ['/PID', String(pid), '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore',
  });
  if (result.error) throw result.error;
}
