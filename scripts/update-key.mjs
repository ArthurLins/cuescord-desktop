import { generateKeyPairSync } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import policy from '../electron/update/policy.cjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const secretPath = path.join(root, '.update-signing/private-key.dpapi');
const publicPath = path.join(root, 'electron/update/trusted-keys.json');

function execute(binary, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const output = [];
    child.stdout.on('data', (chunk) => output.push(chunk));
    // Never include child output or stdin in error messages: it can contain a key.
    child.stderr.resume();
    child.on('error', () => reject(new Error('Unable to execute key operation')));
    child.on('close', (code) =>
      code === 0
        ? resolve(Buffer.concat(output).toString('utf8').trim())
        : reject(
            new Error('Key operation failed; check Windows account or GitHub CLI authentication'),
          ),
    );
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function dpapi(operation, input) {
  if (process.platform !== 'win32')
    throw new Error(
      'Run this key setup on Windows; the private key is protected by your Windows account',
    );
  const script = `Add-Type -AssemblyName System.Security; $keyBytes = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); $protectedBytes = [Security.Cryptography.ProtectedData]::${operation}($keyBytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($protectedBytes))`;
  return execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], input);
}

const command = process.argv[2];
if (command === 'generate') {
  const { keys } = JSON.parse(await readFile(publicPath, 'utf8'));
  if (keys.length)
    throw new Error(
      'Public key already configured. Do not replace it: installed clients trust this key. See docs/RELEASING.md',
    );
  await access(secretPath).then(
    () => {
      throw new Error('A local signing key already exists');
    },
    (error) => {
      if (error.code !== 'ENOENT') throw error;
    },
  );
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const encrypted = await dpapi(
    'Protect',
    privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  );
  await mkdir(path.dirname(secretPath), { recursive: true, mode: 0o700 });
  await writeFile(secretPath, encrypted, { flag: 'wx', mode: 0o600 });
  await writeFile(
    publicPath,
    `${JSON.stringify({ keys: [{ id: policy.publicKeyId(publicPem), publicKey: publicPem }] }, null, 2)}\n`,
  );
  console.log(
    'Public key pinned. Private key encrypted with Windows DPAPI in .update-signing/private-key.dpapi (ignored by Git).',
  );
} else if (command === 'upload') {
  const privateKey = await dpapi('Unprotect', await readFile(secretPath, 'utf8'));
  await execute(
    'gh',
    ['secret', 'set', 'UPDATE_SIGNING_PRIVATE_KEY', '--repo', policy.REPOSITORY],
    privateKey,
  );
  console.log(
    'UPDATE_SIGNING_PRIVATE_KEY configured in GitHub Actions. No private key was written in plaintext.',
  );
} else {
  throw new Error('Usage: node scripts/update-key.mjs generate | upload');
}
