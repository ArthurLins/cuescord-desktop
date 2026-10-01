import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
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
