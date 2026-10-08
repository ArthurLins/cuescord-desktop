const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const raw = require('original-fs').promises;
const updateRoot = process.env.CUESCORD_TEST_APPLICATION_ASAR
  ? path.join(process.env.CUESCORD_TEST_APPLICATION_ASAR, 'electron/update')
  : path.join(__dirname, '../../electron/update');
const { extractApplicationBundle, verifyApplicationDirectory, metadata } = require(
  path.join(updateRoot, 'application.cjs'),
);
const { markDownloadedFile } = require(path.join(updateRoot, 'updater.cjs'));
const { prepareApplication, discardApplication } = require(
  path.join(updateRoot, 'windows-application.cjs'),
);

globalThis.applicationTest = async ({ source, destination, version, install, cacheRoot }) => {
  const files = await extractApplicationBundle(source, destination, version, undefined, (file) =>
    markDownloadedFile(
      file,
      'https://github.com/ArthurLins/cuescord-desktop/releases/download/test/application.cua',
      'win32',
    ),
  );
  await verifyApplicationDirectory(destination, files);
  const asar = path.join(destination, 'resources/app.asar');
  const packageVersion = require(path.join(asar, 'package.json')).version;
  const before = process.noAsar;
  const prepared = await prepareApplication({
    ready: { version, files, applicationDirectory: destination },
    executable: path.join(install, 'Cuescord.exe'),
    cacheRoot,
  });
  try {
    const copied = await metadata(path.join(prepared.stage, 'resources/app.asar'));
    const nativeFile = files.find((file) => file.path.startsWith('resources/app.asar.unpacked/'));
    if (!nativeFile) throw new Error('Fixture must include an unpacked native file');
    const marks = await Promise.all(
      ['resources/app.asar', nativeFile.path].map((file) =>
        raw.readFile(`${path.join(prepared.stage, file)}:Zone.Identifier`, 'utf8'),
      ),
    );
    const ordinary = require('node:fs').readFileSync(path.join(asar, 'package.json'), 'utf8');
    await raw.appendFile(asar, 'tampered');
    let rejection;
    try {
      await verifyApplicationDirectory(destination, files);
    } catch (error) {
      rejection = error.message;
    }
    return {
      copied,
      original: files.find((file) => file.path === 'resources/app.asar'),
      marks,
      packageVersion,
      ordinary: JSON.parse(ordinary).version,
      noAsarUnchanged: before === process.noAsar,
      rejection,
    };
  } finally {
    await discardApplication(prepared);
  }
};
app.whenReady().then(() => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  window.loadURL('data:text/html,<h1>Application filesystem test</h1>');
});
