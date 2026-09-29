const { allowPermission, sameOrigin } = require('./policy.cjs');

function installPermissions(session, trustedUrl, ownsContents, systemPreferences, platform = process.platform) {
  session.setPermissionCheckHandler((contents, permission, origin, details = {}) => {
    // Notifications may be checked without a WebContents (for example by a worker).
    if (!contents && permission !== 'notifications') return false;
    if (contents && (!ownsContents(contents) || !sameOrigin(contents.getURL(), trustedUrl))) return false;
    if (!allowPermission(permission, origin, details, trustedUrl)) return false;
    if (platform === 'darwin' && permission === 'media') {
      const kind = details.mediaType === 'video' ? 'camera' : 'microphone';
      return systemPreferences.getMediaAccessStatus(kind) === 'granted';
    }
    return true;
  });
  session.setPermissionRequestHandler((contents, permission, callback, details = {}) => {
    const trusted = () => contents && !contents.isDestroyed() && ownsContents(contents)
      && sameOrigin(contents.getURL(), trustedUrl)
      && allowPermission(permission, details.requestingUrl, details, trustedUrl);
    if (!trusted()) return callback(false);
    if (platform !== 'darwin' || permission !== 'media') return callback(true);
    const kinds = (details.mediaTypes || ['audio', 'video']).map(kind => kind === 'audio' ? 'microphone' : 'camera');
    Promise.all(kinds.map(kind => systemPreferences.askForMediaAccess(kind)))
      .then(results => callback(trusted() && results.every(Boolean)))
      .catch(() => callback(false));
  });
}

module.exports = { installPermissions };
