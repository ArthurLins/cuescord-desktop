const https = require('node:https');
const { createHash } = require('node:crypto');
const { open, rename, unlink } = require('node:fs/promises');
const { validateNetworkUrl } = require('./policy.cjs');

async function responseFor(value, kind, signal, request = https.get, redirects = 0) {
  signal.throwIfAborted();
  const url = validateNetworkUrl(value, kind);
  const response = await new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        signal,
        headers: {
          'User-Agent': 'Cuescord-Desktop-Updater',
          Accept: kind === 'api' ? 'application/vnd.github+json' : 'application/octet-stream',
          'Accept-Encoding': 'identity',
        },
      },
      resolve,
    );
    req.on('error', reject);
    req.setTimeout(20000, () =>
      req.destroy(new Error('O servidor de atualização demorou para responder.')),
    );
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
    response.destroy();
    if (redirects >= 5 || !response.headers.location)
      throw new Error('Redirecionamento de atualização inválido.');
    return responseFor(
      new URL(response.headers.location, url).href,
      kind,
      signal,
      request,
      redirects + 1,
    );
  }
  if (
    response.statusCode !== 200 ||
    (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')
  ) {
    response.destroy();
    throw new Error(
      response.statusCode === 404
        ? 'Esta release ainda não disponibiliza atualizações verificadas.'
        : 'Não foi possível acessar a atualização.',
    );
  }
  return response;
}

async function readJson(url, kind, signal, request) {
  const response = await responseFor(url, kind, signal, request);
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of response) {
      signal.throwIfAborted();
      size += chunk.length;
      if (size > 131072) throw new Error('Resposta de atualização excede o limite.');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    response.destroy();
  }
}

async function downloadVerified(url, artifact, destination, signal, progress, request) {
  const partial = `${destination}.part`;
  let handle,
    response,
    created = false;
  let size = 0;
  const hash = createHash('sha512');
  try {
    handle = await open(partial, 'wx', 0o600);
    created = true;
    response = await responseFor(url, 'asset', signal, request);
    if (
      response.headers['content-length'] &&
      Number(response.headers['content-length']) !== artifact.size
    )
      throw new Error('O tamanho do instalador não corresponde ao manifesto.');
    for await (const chunk of response) {
      signal.throwIfAborted();
      size += chunk.length;
      if (size > artifact.size) throw new Error('O instalador excede o tamanho autorizado.');
      hash.update(chunk);
      await handle.writeFile(chunk);
      progress(Math.min(99, Math.floor((size * 100) / artifact.size)));
    }
    signal.throwIfAborted();
    if (size !== artifact.size || hash.digest('hex') !== artifact.sha512)
      throw new Error('O instalador falhou na verificação de integridade.');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(partial, destination);
  } finally {
    response?.destroy();
    await handle?.close();
    if (created)
      await unlink(partial).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
  }
}

module.exports = { responseFor, readJson, downloadVerified };
