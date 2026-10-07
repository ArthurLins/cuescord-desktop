const fs = require('node:fs/promises');
const path = require('node:path');
const { constants } = require('node:fs');
const { spawn } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const { verifyApplicationDirectory, metadata } = require('./application.cjs');

async function ordinaryDirectory(directory) {
  const entry = await fs.lstat(directory);
  if (!entry.isDirectory() || entry.isSymbolicLink())
    throw new Error('Diretório de instalação inválido.');
  const parent = path.dirname(directory);
  if (parent !== directory) await ordinaryDirectory(parent);
}

async function prepareApplication({ ready, executable, cacheRoot }) {
  const install = path.dirname(executable);
  if (
    path.basename(executable) !== 'Cuescord.exe' ||
    install === path.parse(install).root ||
    cacheRoot.toLowerCase().startsWith(`${install.toLowerCase()}${path.sep}`)
  )
    throw new Error('Esta instalação não permite atualização pelo aplicativo.');
  await ordinaryDirectory(install);
  await fs.access(install, constants.W_OK).catch(() => {
    throw new Error(
      'A pasta do Cuescord não permite atualização. Reinstale para seu usuário em uma pasta com permissão de escrita.',
    );
  });
  const id = randomUUID();
  const stage = path.join(path.dirname(install), `.cuescord-update-${id}`);
  const backup = path.join(path.dirname(install), `.cuescord-backup-${id}`);
  const directory = await fs.mkdtemp(path.join(cacheRoot, 'apply-'));
  try {
    // Copy beside the installation so both directory renames stay on the same volume.
    await fs.cp(ready.applicationDirectory, stage, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    await verifyApplicationDirectory(stage, ready.files);
    const files = [...ready.files];
    // Keep NSIS uninstall support and existing shortcuts at their original paths.
    for (const name of ['Uninstall Cuescord.exe', 'uninstallerIcon.ico']) {
      const source = path.join(install, name);
      try {
        const entry = await metadata(source);
        await fs.copyFile(source, path.join(stage, name), constants.COPYFILE_EXCL);
        files.push({ path: name, ...entry });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    const helper = path.join(directory, 'cuescord-update.exe');
    await fs.copyFile(
      path.join(install, 'resources/updater/cuescord-update.exe'),
      helper,
      constants.COPYFILE_EXCL,
    );
    const plan = {
      schema: 1,
      install,
      stage,
      backup,
      version: ready.version,
      files,
      acknowledgement: path.join(directory, 'started.json'),
      result: path.join(directory, 'result.json'),
    };
    const bytes = Buffer.from(JSON.stringify(plan));
    const file = path.join(directory, 'plan.json');
    await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
    return {
      file,
      helper,
      directory,
      stage,
      digest: createHash('sha512').update(bytes).digest('hex'),
    };
  } catch (error) {
    await fs.rm(stage, { recursive: true, force: true });
    await fs.rm(directory, { recursive: true, force: true });
    if (['EACCES', 'EPERM'].includes(error.code))
      throw new Error(
        'A pasta do Cuescord não permite atualização. Reinstale para seu usuário em uma pasta com permissão de escrita.',
      );
    throw error;
  }
}

async function launchApplication(prepared, parentPid = process.pid) {
  const child = spawn(prepared.helper, [prepared.file, prepared.digest, String(parentPid)], {
    detached: true,
    windowsHide: true,
    cwd: prepared.directory,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('A atualização demorou para iniciar.'));
    }, 60000);
    let output = '';
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeAllListeners('exit');
      child.stdout.destroy();
      child.unref();
      if (error) reject(error);
      else resolve();
    };
    child.once('error', () => finish(new Error('Não foi possível iniciar a atualização.')));
    child.once('exit', () => finish(new Error('Não foi possível preparar a atualização.')));
    child.stdout.on('data', (bytes) => {
      output += bytes.toString();
      if (output === 'ready\n' || output === 'ready\r\n') finish();
      else if (output.length > 64) {
        child.kill();
        finish(new Error('Resposta do atualizador inválida.'));
      }
    });
  });
  return child;
}

async function discardApplication(prepared) {
  await fs.rm(prepared.stage, { recursive: true, force: true });
  await fs.rm(prepared.directory, { recursive: true, force: true, maxRetries: 10 });
}

async function acknowledgeApplication({ cacheRoot, version, executable }) {
  // Only the locally prepared transaction is used; no command-line path is accepted.
  for (const name of await fs.readdir(cacheRoot).catch(() => [])) {
    if (!/^apply-[A-Za-z0-9]+$/.test(name)) continue;
    const directory = path.join(cacheRoot, name);
    try {
      await ordinaryDirectory(directory);
      const planFile = path.join(directory, 'plan.json');
      if ((await fs.lstat(planFile)).size > 2 * 1024 * 1024) continue;
      const plan = JSON.parse(await fs.readFile(planFile, 'utf8'));
      if (
        plan.version !== version ||
        path.join(plan.install, 'Cuescord.exe') !== executable ||
        plan.acknowledgement !== path.join(directory, 'started.json')
      )
        continue;
      await fs.writeFile(plan.acknowledgement, JSON.stringify({ version }), { flag: 'wx' });
    } catch {
      /* A previous transaction is never allowed to prevent startup. */
    }
  }
}

module.exports = {
  prepareApplication,
  launchApplication,
  acknowledgeApplication,
  discardApplication,
};
