// Updating an ASAR operates on archive bytes and adjacent native files. Electron's
// patched fs treats .asar paths as virtual directories, including while writing.
// Keep this boundary local to the updater; application loading still uses ASAR.
module.exports = process.versions.electron ? require('original-fs') : require('node:fs');
