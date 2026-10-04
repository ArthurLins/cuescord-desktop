const { allowPermission, sameOrigin } = require('./policy.cjs');
const mediaKinds = new Map([
  ['audio', 'microphone'],
  ['video', 'camera'],
]);

function installPermissions(
  session,
  trustedUrl,
  ownsContents,
  systemPreferences,
  platform = process.platform,
) {
  session.setPermissionCheckHandler((contents, permission, origin, details = {}) => {
    // Notifications may be checked without a WebContents (for example by a worker).
    if (!contents && permission !== 'notifications') return false;
    if (contents && (!ownsContents(contents) || !sameOrigin(contents.getURL(), trustedUrl)))
      return false;
    if (!allowPermission(permission, origin, details, trustedUrl)) return false;
    if (platform === 'darwin' && permission === 'media') {
      const kind = mediaKinds.get(details.mediaType);
      // Generic media checks cannot stand in for either device's OS consent.
      if (!kind) return false;
      return systemPreferences.getMediaAccessStatus(kind) === 'granted';
    }
    return true;
  });
  session.setPermissionRequestHandler((contents, permission, callback, details = {}) => {
    const trusted = () =>
      contents &&
      !contents.isDestroyed() &&
      ownsContents(contents) &&
      sameOrigin(contents.getURL(), trustedUrl) &&
      allowPermission(permission, details.requestingUrl, details, trustedUrl);
    if (!trusted()) return callback(false);
    if (platform !== 'darwin' || permission !== 'media') return callback(true);
    if (!Array.isArray(details.mediaTypes)) return callback(false);
    // Electron 44 sends display capture as 'media' with no camera/mic types.
    // Allow that trusted main-frame request to reach the capture picker; its
    // gesture, selected source and macOS screen consent still govern capture.
    if (!details.mediaTypes.length)
      return callback(
        details.isMainFrame === true && sameOrigin(details.securityOrigin, trustedUrl),
      );
    const kinds = [...new Set(details.mediaTypes)].map((kind) => mediaKinds.get(kind));
    if (kinds.some((kind) => !kind)) return callback(false);
    const authorize = async () => {
      // Ask only for devices actually requested, and serialize native prompts.
      for (const kind of kinds) {
        if (!trusted()) return false;
        const status = systemPreferences.getMediaAccessStatus(kind);
        if (status === 'granted') continue;
        if (status !== 'not-determined' || !(await systemPreferences.askForMediaAccess(kind)))
          return false;
      }
      return trusted();
    };
    authorize()
      .then(callback)
      .catch(() => callback(false));
  });
}

module.exports = { installPermissions };
