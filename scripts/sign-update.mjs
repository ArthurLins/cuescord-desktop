import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import policy from '../electron/update/policy.cjs';

const { REPOSITORY, SIGNING_CONTEXT, installerName, publicKeyId, verifyManifest } = policy;
const root = fileURLToPath(new URL('../', import.meta.url));
const targets = [
  ['win32', 'x64'],
  ['linux', 'x64'],
  ['darwin', 'arm64'],
];

export async function signUpdate({ directory, version, tag, commit, privateKey, keys }) {
  if (tag !== `v${version}`) throw new Error('Release tag must match package.json');
  // PKCS8 DER, base64. Do not write or log the private key in CI.
  if (!privateKey || !/^[A-Za-z0-9+/]+={0,2}$/.test(privateKey))
    throw new Error('Configure UPDATE_SIGNING_PRIVATE_KEY before publishing');
  const key = createPrivateKey({
    key: Buffer.from(privateKey, 'base64'),
    type: 'pkcs8',
    format: 'der',
  });
  const publicKey = createPublicKey(key).export({ type: 'spki', format: 'pem' });
  const keyId = publicKeyId(publicKey);
  if (!keys.some((trusted) => trusted.id === keyId && publicKeyId(trusted.publicKey) === keyId))
    throw new Error('Signing key does not match the public key shipped in the client');
  const artifacts = [];
  for (const [platform, arch] of targets) {
    const file = installerName(version, platform, arch);
    const info = JSON.parse(
      await readFile(path.join(directory, `build-info-${platform}-${arch}.json`), 'utf8'),
    );
    if (
      info.version !== version ||
      info.platform !== platform ||
      info.architecture !== arch ||
      info.installer !== file ||
      (commit && info.commit !== commit)
    )
      throw new Error('Installer provenance does not match this release');
    const location = path.join(directory, file);
    const entry = await lstat(location);
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Invalid installer file');
    const sha512 = createHash('sha512'),
      sha256 = createHash('sha256');
    for await (const chunk of createReadStream(location)) {
      sha512.update(chunk);
      sha256.update(chunk);
    }
    if (sha256.digest('hex') !== info.sha256)
      throw new Error('Installer differs from build provenance');
    artifacts.push({ platform, arch, file, size: entry.size, sha512: sha512.digest('hex') });
  }
  const payload = Buffer.from(
    JSON.stringify({ schema: 1, repository: REPOSITORY, version, artifacts }),
  );
  const envelope = {
    payload: payload.toString('base64'),
    signatures: [
      {
        keyId,
        signature: sign(null, Buffer.concat([SIGNING_CONTEXT, payload]), key).toString('base64'),
      },
    ],
  };
  verifyManifest(envelope, keys);
  return envelope;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const { keys } = JSON.parse(
    await readFile(path.join(root, 'electron/update/trusted-keys.json'), 'utf8'),
  );
  if (process.env.GITHUB_REPOSITORY && process.env.GITHUB_REPOSITORY !== REPOSITORY)
    throw new Error('Unexpected release repository');
  const directory = path.resolve(root, 'artifacts');
  const envelope = await signUpdate({
    directory,
    version,
    tag: process.env.RELEASE_TAG,
    commit: process.env.GITHUB_SHA,
    privateKey: process.env.UPDATE_SIGNING_PRIVATE_KEY,
    keys,
  });
  await writeFile(
    path.join(directory, 'update-manifest.json'),
    `${JSON.stringify(envelope, null, 2)}\n`,
    { flag: 'wx' },
  );
  console.log(`Signed update manifest for ${version}`);
}
