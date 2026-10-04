const { app, BrowserWindow } = require('electron');
const { mkdirSync } = require('node:fs');
const profile = process.argv
  .find((argument) => argument.startsWith('--user-data-dir='))
  .slice('--user-data-dir='.length);
mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.requestSingleInstanceLock = () => true;
const show = BrowserWindow.prototype.show;
BrowserWindow.prototype.show = function () {
  this.setOpacity(0);
  this.setSkipTaskbar(true);
  return show.call(this);
};

// Observe the real permission handlers; fake devices do not bypass authorization.
globalThis.mediaPermissions = [];
const permissions = require('../../electron/security/permissions.cjs');
const install = permissions.installPermissions;
permissions.installPermissions = function (session, ...args) {
  const check = session.setPermissionCheckHandler.bind(session);
  const request = session.setPermissionRequestHandler.bind(session);
  session.setPermissionCheckHandler = (handler) =>
    check((contents, permission, origin, details) => {
      const allowed = handler(contents, permission, origin, details);
      globalThis.mediaPermissions.push({ type: 'check', permission, origin, details, allowed });
      return allowed;
    });
  session.setPermissionRequestHandler = (handler) =>
    request((contents, permission, callback, details) =>
      handler(
        contents,
        permission,
        (allowed) => {
          globalThis.mediaPermissions.push({ type: 'request', permission, details, allowed });
          callback(allowed);
        },
        details,
      ),
    );
  return install(session, ...args);
};
require('../../electron/main.cjs');
