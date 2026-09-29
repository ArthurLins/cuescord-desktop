module.exports = {
  appId: 'net.cuesc.cuescord', productName: 'Cuescord',
  artifactName: 'Cuescord-${version}-${os}-${arch}.${ext}',
  directories: { output: 'release', buildResources: 'assets' },
  files: ['electron/**/*', 'dist/preload.cjs', 'assets/icons/**/*', 'package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md'],
  asar: true, npmRebuild: false,
  asarUnpack: ['node_modules/**/*.node'],
  win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: 'assets/icons/icon.ico' },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, shortcutName: 'Cuescord', installerLanguages: ['pt_BR', 'en_US'] },
  linux: {
    target: [{ target: 'deb', arch: ['x64'] }], executableName: 'cuescord',
    icon: 'assets/icons', category: 'Network;InstantMessaging',
    synopsis: 'Conversas, comunidades e chamadas de voz no Cuescord',
    syncDesktopName: true,
  },
  deb: {
    packageName: 'cuescord', maintainer: 'Cuescord', vendor: 'Cuescord', packageCategory: 'net',
    depends: [
      'libgtk-3-0t64 | libgtk-3-0', 'libnotify4', 'libnss3', 'libxss1', 'libxtst6', 'xdg-utils',
      'libatspi2.0-0t64 | libatspi2.0-0', 'libuuid1', 'libsecret-1-0',
      'libasound2t64 | libasound2', 'libgbm1', 'libdrm2', 'libxkbcommon0',
      'pulseaudio-utils', 'x11-utils',
    ],
  },
  mac: {
    target: [{ target: 'dmg', arch: ['arm64'] }], icon: 'assets/icons/icon.icns', category: 'public.app-category.social-networking',
    // Apple Silicon needs at least an ad-hoc signature. Use Developer ID when supplied.
    identity: process.env.CSC_LINK ? undefined : '-',
    notarize: Boolean(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID),
    extendInfo: {
      NSMicrophoneUsageDescription: 'O Cuescord usa seu microfone nas chamadas de voz.',
      NSCameraUsageDescription: 'O Cuescord usa sua câmera nas chamadas de vídeo.',
    },
  },
};
