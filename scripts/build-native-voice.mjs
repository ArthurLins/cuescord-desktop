import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
// Windows first. Unsupported platforms keep browser voice and do not advertise
// the experimental capability. This build never downloads code at app runtime.
if (process.platform !== 'win32' || process.arch !== 'x64') process.exit(0);
const cache = path.join(root, '.cache/native-voice');
const output = path.join(cache, 'bin');
await mkdir(output, { recursive: true });
async function archive(name, url, sha256) {
  const destination = path.join(cache, name);
  let bytes;
  try {
    bytes = await readFile(destination);
  } catch {
    const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error(`Native dependency ${name}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (createHash('sha256').update(bytes).digest('hex') !== sha256)
    throw new Error(`Native dependency ${name}: SHA-256 mismatch`);
  await writeFile(destination, bytes);
  return destination;
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command}: exit ${result.status}`);
}
const sdk = await archive(
  'webrtc.7z',
  'https://github.com/crow-misia/libwebrtc-bin/releases/download/140.7339.2.0/libwebrtc-win-x64.7z',
  '10b95069dc22cf6a60e9818cbcbb6a1d5698473e9ac4ce679e1258b97be58910',
);
// Windows Server 2022's bundled tar lacks the LZMA codec. Hosted runners have
// 7-Zip; newer Windows tar is a usable fallback for local builds.
const sevenZip = path.join(process.env.ProgramFiles || 'C:/Program Files', '7-Zip/7z.exe');
if (existsSync(sevenZip)) run(sevenZip, ['x', sdk, `-o${cache}`, '-y', '-bso0', '-bsp0']);
else run('tar', ['-xf', sdk, '-C', cache]);
await copyFile(path.join(cache, 'release/webrtc.lib'), path.join(cache, 'release/libwebrtc.lib'));
const build = path.join(cache, 'build');
const vswhere = path.join(
  process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)',
  'Microsoft Visual Studio/Installer/vswhere.exe',
);
const installations = spawnSync(
  vswhere,
  [
    '-latest',
    '-products',
    '*',
    '-requires',
    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '-format',
    'json',
  ],
  { encoding: 'utf8' },
);
if (installations.status !== 0) throw new Error('Visual Studio C++ Build Tools are required');
const [visualStudio] = JSON.parse(installations.stdout);
if (!visualStudio) throw new Error('Visual Studio C++ Build Tools are required');
const bundledCmake = path.join(
  visualStudio.installationPath,
  'Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe',
);
const cmake = existsSync(bundledCmake) ? bundledCmake : 'cmake';
const major = visualStudio.installationVersion.split('.')[0];
const generator = major === '18' ? 'Visual Studio 18 2026' : 'Visual Studio 17 2022';
run(cmake, [
  '-S',
  'native/voice',
  '-B',
  build,
  '-G',
  generator,
  '-A',
  'x64',
  '-DCMAKE_POLICY_VERSION_MINIMUM=3.5',
  '-DCUESCORD_VOICE_TRACE=OFF',
  `-DLIBWEBRTC_INCLUDE_PATH=${path.join(cache, 'include')}`,
  `-DLIBWEBRTC_BINARY_PATH=${path.join(cache, 'release')}`,
]);
run(cmake, [
  '--build',
  build,
  '--config',
  'Release',
  '--target',
  'CuescordVoiceBackend',
  'VoiceGateTests',
  '--parallel',
  '4',
]);
run(path.join(build, 'Release/VoiceGateTests.exe'), []);
const env = {
  ...process.env,
  CARGO_HOME: path.join(root, '.cache/cargo'),
  CARGO_TARGET_DIR: path.join(cache, 'rust'),
  // Match C++ /MT: the installed helper must not depend on a separately installed
  // Visual C++ redistributable. This overrides ambient Rust flags for packaging.
  CARGO_ENCODED_RUSTFLAGS: '-C\x1ftarget-feature=+crt-static',
};
run(
  'cargo',
  ['+1.94.0', 'build', '--manifest-path', 'native/voice/Cargo.toml', '--release', '--locked'],
  {
    env,
  },
);
run('cargo', ['+1.94.0', 'test', '--manifest-path', 'native/voice/Cargo.toml', '--locked'], {
  env,
});
await copyFile(
  path.join(build, 'Release/CuescordVoiceBackend.dll'),
  path.join(output, 'CuescordVoiceBackend.dll'),
);
await copyFile(
  path.join(cache, 'rust/release/cuescord-voice.exe'),
  path.join(output, 'cuescord-voice.exe'),
);
await copyFile(path.join(cache, 'NOTICE'), path.join(output, 'WEBRTC_NOTICES.txt'));
await copyFile(
  path.join(root, 'native/voice/THIRD_PARTY_NOTICES.txt'),
  path.join(output, 'THIRD_PARTY_NOTICES.txt'),
);
console.log('Native voice: Rust helper and libwebrtc backend built (Windows x64).');
