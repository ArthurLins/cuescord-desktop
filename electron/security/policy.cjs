const PRODUCTION_URL = 'https://cuescord.cuesc.net';

function appUrl(value = PRODUCTION_URL, development = false) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(development && local && url.protocol === 'http:')) ||
    url.username ||
    url.password
  ) {
    throw new Error('Use HTTPS; HTTP é permitido apenas em localhost durante o desenvolvimento.');
  }
  return url.href;
}

function sameOrigin(value, trustedUrl) {
  try {
    const url = new URL(value);
    return !url.username && !url.password && url.origin === new URL(trustedUrl).origin;
  } catch {
    return false;
  }
}

function externalUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

const permissions = new Set([
  'media',
  'notifications',
  'clipboard-read',
  'clipboard-sanitized-write',
  'fullscreen',
  'display-capture',
]);
function allowPermission(permission, origin, details, trustedUrl) {
  if (
    !sameOrigin(origin, trustedUrl) ||
    !permissions.has(permission) ||
    details.isMainFrame === false
  )
    return false;
  if (details.requestingUrl && !sameOrigin(details.requestingUrl, trustedUrl)) return false;
  if (details.embeddingOrigin && !sameOrigin(details.embeddingOrigin, trustedUrl)) return false;
  if (
    permission === 'media' &&
    details.mediaTypes?.some((kind) => !['audio', 'video'].includes(kind))
  )
    return false;
  return true;
}

module.exports = { PRODUCTION_URL, appUrl, sameOrigin, externalUrl, allowPermission };
