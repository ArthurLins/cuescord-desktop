import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createInstallerZip } = require('../electron/update/archive.cjs');
export const policy = require('../electron/update/policy.cjs');
export const bytes = Buffer.from('a verified installer fixture');
export function fixture(version = '0.5.0') {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const key = { id: policy.publicKeyId(publicPem), publicKey: publicPem };
  const manifest = {
    schema: 1,
    repository: policy.REPOSITORY,
    version,
    artifacts: [
      ['win32', 'x64'],
      ['linux', 'x64'],
      ['darwin', 'arm64'],
    ].map(([platform, arch]) => ({
      platform,
      arch,
      file: policy.installerName(version, platform, arch),
      size: bytes.length,
      sha512: createHash('sha512').update(bytes).digest('hex'),
    })),
  };
  function signed(value = manifest) {
    const payload = Buffer.from(JSON.stringify(value));
    return {
      payload: payload.toString('base64'),
      signatures: [
        {
          keyId: key.id,
          signature: sign(
            null,
            Buffer.concat([policy.SIGNING_CONTEXT, payload]),
            privateKey,
          ).toString('base64'),
        },
      ],
    };
  }
  return {
    manifest,
    key,
    keys: [key],
    envelope: signed(),
    signed,
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  };
}

export async function zipFixture(version = '0.5.0') {
  const data = fixture(version);
  const directory = await mkdtemp(path.join(tmpdir(), 'cuescord-zip-fixture-'));
  const files = new Map();
  try {
    for (const artifact of data.manifest.artifacts) {
      const name = policy.archiveName(version, artifact.platform, artifact.arch);
      const source = path.join(directory, artifact.file);
      const destination = path.join(directory, name);
      await writeFile(source, bytes);
      await createInstallerZip(source, destination, artifact.file);
      const zip = await readFile(destination);
      files.set(name, zip);
      artifact.archive = {
        format: 'zip-store-v1',
        file: name,
        size: zip.length,
        sha512: createHash('sha512').update(zip).digest('hex'),
      };
    }
    return { ...data, envelope: data.signed(), files };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
