const fs = require('./filesystem.cjs').promises;
const path = require('node:path');
const { createHash } = require('node:crypto');

const MAGIC = Buffer.from('CUESAPP1');
const MAX_INDEX = 2 * 1024 * 1024;
const MAX_SIZE = 2 * 1024 * 1024 * 1024;
const REQUIRED = ['Cuescord.exe', 'resources/app.asar', 'resources/updater/cuescord-update.exe'];

function validateFiles(files) {
  if (!Array.isArray(files) || !files.length || files.length > 8192)
    throw new Error('Conteúdo da atualização inválido.');
  const names = new Set();
  for (const file of files) {
    if (
      typeof file.path !== 'string' ||
      file.path.length > 240 ||
      file.path
        .split('/')
        .some(
          (part) =>
            !part ||
            !/^[A-Za-z0-9_.@+() -]+$/.test(part) ||
            /[. ]$/.test(part) ||
            /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part),
        ) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      file.size > MAX_SIZE ||
      !/^[a-f0-9]{128}$/.test(file.sha512)
    )
      throw new Error('Caminho ou arquivo de atualização inválido.');
    const name = file.path.toLowerCase();
    if (names.has(name)) throw new Error('Arquivo duplicado na atualização.');
    names.add(name);
  }
  for (const name of names) {
    const parts = name.split('/');
    while (parts.length > 1) {
      parts.pop();
      if (names.has(parts.join('/'))) throw new Error('Caminho conflitante na atualização.');
    }
  }
  for (const file of REQUIRED)
    if (!files.some((entry) => entry.path === file)) throw new Error('Atualização incompleta.');
  return files;
}

async function metadata(file) {
  const entry = await fs.lstat(file);
  if (!entry.isFile() || entry.isSymbolicLink())
    throw new Error('Arquivo de atualização inválido.');
  const hash = createHash('sha512');
  const handle = await fs.open(file, 'r');
  try {
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
  } finally {
    await handle.close();
  }
  return { size: entry.size, sha512: hash.digest('hex') };
}

async function collectFiles(root, prefix = '') {
  const files = [];
  for (const name of (await fs.readdir(path.join(root, prefix))).sort()) {
    const relative = prefix ? `${prefix}/${name}` : name;
    const location = path.join(root, relative);
    const entry = await fs.lstat(location);
    if (entry.isDirectory() && !entry.isSymbolicLink())
      files.push(...(await collectFiles(root, relative)));
    else files.push({ path: relative, ...(await metadata(location)) });
  }
  return files;
}

async function createApplicationBundle(root, destination, version) {
  const files = validateFiles(await collectFiles(root));
  const index = Buffer.from(JSON.stringify({ version, files }));
  if (
    index.length > MAX_INDEX ||
    files.reduce((sum, file) => sum + file.size, 12 + index.length) > MAX_SIZE
  )
    throw new Error('Atualização excede o limite.');
  const header = Buffer.alloc(12);
  MAGIC.copy(header);
  header.writeUInt32LE(index.length, 8);
  const output = await fs.open(destination, 'wx', 0o600);
  try {
    await output.writeFile(header);
    await output.writeFile(index);
    for (const file of files) {
      const input = await fs.open(path.join(root, file.path), 'r');
      try {
        for await (const chunk of input.createReadStream({ autoClose: false }))
          await output.writeFile(chunk);
      } finally {
        await input.close();
      }
    }
    await output.sync();
  } finally {
    await output.close();
  }
}

async function extractApplicationBundle(source, destination, version, signal, markFile) {
  const input = await fs.open(source, 'r');
  try {
    const header = Buffer.alloc(12);
    const first = await input.read(header, 0, 12, 0);
    const length = header.readUInt32LE(8);
    if (
      first.bytesRead !== 12 ||
      !header.subarray(0, 8).equals(MAGIC) ||
      !length ||
      length > MAX_INDEX
    )
      throw new Error('Pacote de atualização inválido.');
    const bytes = Buffer.alloc(length);
    if ((await input.read(bytes, 0, length, 12)).bytesRead !== length)
      throw new Error('Pacote de atualização incompleto.');
    const index = JSON.parse(bytes.toString('utf8'));
    if (index.version !== version) throw new Error('Versão do pacote de atualização inválida.');
    const files = validateFiles(index.files);
    let offset = 12 + length;
    const total = files.reduce((sum, file) => sum + file.size, offset);
    if (total > MAX_SIZE || (await input.stat()).size !== total)
      throw new Error('Tamanho do pacote de atualização inválido.');
    // The caller owns a fresh, private directory. Never extract into an existing installation.
    await fs.mkdir(destination, { mode: 0o700 });
    for (const file of files) {
      signal?.throwIfAborted();
      const location = path.join(destination, file.path);
      await fs.mkdir(path.dirname(location), { recursive: true });
      const output = await fs.open(location, 'wx', 0o600);
      const hash = createHash('sha512');
      let remaining = file.size;
      try {
        const buffer = Buffer.alloc(1024 * 1024);
        while (remaining) {
          signal?.throwIfAborted();
          const { bytesRead } = await input.read(
            buffer,
            0,
            Math.min(buffer.length, remaining),
            offset,
          );
          if (!bytesRead) throw new Error('Pacote de atualização incompleto.');
          const chunk = buffer.subarray(0, bytesRead);
          hash.update(chunk);
          await output.writeFile(chunk);
          offset += bytesRead;
          remaining -= bytesRead;
        }
        if (hash.digest('hex') !== file.sha512)
          throw new Error('A atualização falhou na verificação de integridade.');
        await output.sync();
      } finally {
        await output.close();
      }
      await markFile?.(location);
    }
    return files;
  } finally {
    await input.close();
  }
}

async function verifyApplicationDirectory(root, files) {
  validateFiles(files);
  const entry = await fs.lstat(root);
  if (!entry.isDirectory() || entry.isSymbolicLink())
    throw new Error('Diretório de atualização inválido.');
  const actual = await collectFiles(root);
  if (JSON.stringify(actual) !== JSON.stringify(files))
    throw new Error('Os arquivos da atualização foram alterados.');
}

module.exports = {
  createApplicationBundle,
  extractApplicationBundle,
  verifyApplicationDirectory,
  validateFiles,
  metadata,
};
