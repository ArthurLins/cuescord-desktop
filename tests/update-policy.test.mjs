import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, policy } from './update-fixture.mjs';

test('signed manifest selects only this platform and a strictly newer version', () => {
  const data = fixture();
  const manifest = policy.verifyManifest(data.envelope, data.keys);
  assert.equal(
    policy.selectArtifact(manifest, '0.4.0', '0.5.0', 'win32', 'x64').file,
    'Cuescord-0.5.0-win-x64.exe',
  );
  assert.throws(
    () => policy.selectArtifact(manifest, '0.5.0', '0.5.0', 'win32', 'x64'),
    /anterior/,
  );
  assert.throws(
    () => policy.selectArtifact(manifest, '0.4.0', '0.6.0', 'linux', 'x64'),
    /anterior/,
  );
  assert.throws(
    () => policy.selectArtifact(manifest, '0.4.0', '0.5.0', 'darwin', 'x64'),
    /indisponível/,
  );
  assert.equal(policy.compareVersions('1.10.0', '1.9.9'), 1);
  for (const value of ['v1.0.0', '1.0.0-beta', '../1.0.0', '01.0.0', '1.0.0\n', null])
    assert.throws(() => policy.compareVersions(value, '1.0.0'));
});

test('altered payload, wrong key, missing signatures and malformed signatures are rejected', () => {
  const data = fixture();
  const altered = JSON.parse(JSON.stringify(data.envelope));
  altered.payload = Buffer.from(JSON.stringify({ ...data.manifest, version: '8.0.0' })).toString(
    'base64',
  );
  assert.throws(() => policy.verifyManifest(altered, data.keys), /assinatura/);
  assert.throws(() => policy.verifyManifest(data.envelope, fixture().keys), /assinatura/);
  assert.throws(
    () => policy.verifyManifest({ ...data.envelope, signatures: [] }, data.keys),
    /assinatura/,
  );
  assert.throws(() => policy.verifyManifest(data.envelope, []), /Chave/);
  assert.throws(() =>
    policy.verifyManifest({ ...data.envelope, payload: `${data.envelope.payload}\n` }, data.keys),
  );
  assert.throws(() =>
    policy.verifyManifest(
      { ...data.envelope, signatures: [{ keyId: data.key.id, signature: 'invalid' }] },
      data.keys,
    ),
  );
  assert.throws(
    () => policy.verifyManifest(data.envelope, [{ ...data.key, id: 'wrong' }]),
    /Chave/,
  );
});

test('even signed manifests cannot introduce paths, other repositories, duplicates or unbounded files', () => {
  const data = fixture();
  const reject = (edit) => {
    const manifest = structuredClone(data.manifest);
    edit(manifest);
    assert.throws(() => policy.verifyManifest(data.signed(manifest), data.keys));
  };
  reject((m) => {
    m.artifacts[0].file = '../evil.exe';
  });
  reject((m) => {
    m.repository = 'other/repo';
  });
  reject((m) => {
    m.artifacts[0].size = policy.MAX_INSTALLER_SIZE + 1;
  });
  reject((m) => {
    m.artifacts[0].size = 0;
  });
  reject((m) => {
    m.artifacts[0].sha512 = 'bad';
  });
  reject((m) => {
    m.artifacts[1] = m.artifacts[0];
  });
  reject((m) => {
    m.artifacts.pop();
  });
});

test('network policy rejects arbitrary origins, HTTP, credentials, ports and API redirects', () => {
  const allowed = policy.releaseUrl('0.5.0', 'update-manifest.json');
  assert.equal(policy.validateNetworkUrl(allowed, 'asset').href, allowed);
  assert.equal(
    policy.validateNetworkUrl(
      'https://release-assets.githubusercontent.com/github-production-release-asset/a?token=b',
      'asset',
    ).hostname,
    'release-assets.githubusercontent.com',
  );
  assert.equal(policy.validateNetworkUrl(policy.API_URL, 'api').href, policy.API_URL);
  for (const url of [
    'http://github.com/ArthurLins/cuescord-desktop/releases/download/v0.5.0/a',
    'https://evil.example/a',
    'https://github.com/other/repo/releases/download/v1/a',
    'https://localhost/a',
    'https://user@release-assets.githubusercontent.com/a',
    'https://github.com:444/a',
    `${allowed}#fragment`,
    'https://release-assets.githubusercontent.com.evil.example/a',
  ])
    assert.throws(() => policy.validateNetworkUrl(url, 'asset'));
  assert.throws(() => policy.validateNetworkUrl('https://github.com/', 'api'));
});
