const permissions = require('../../electron/security/permissions.cjs');
const install = permissions.installPermissions;
const { desktopCapturer, nativeImage } = require('electron');
// The test opens and cancels the picker; never enumerate the developer's windows.
desktopCapturer.getSources = async ({ types }) =>
  types.map((kind) => ({
    id: `${kind}:test`,
    name: 'Test source',
    thumbnail: nativeImage.createEmpty(),
  }));
globalThis.devicePrompts = [];
// Run macOS permission policy in the native Electron request pipeline without
// requesting real camera/microphone access on the developer's computer.
permissions.installPermissions = (session, trustedUrl, ownsContents) =>
  install(
    session,
    trustedUrl,
    ownsContents,
    {
      getMediaAccessStatus: () => 'denied',
      askForMediaAccess: async (kind) => {
        globalThis.devicePrompts.push(kind);
        return false;
      },
    },
    'darwin',
  );
require('./media-native.cjs');
