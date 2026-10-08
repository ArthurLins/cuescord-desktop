const { createHash } = require('node:crypto');
const { constants } = require('node:fs');
const fs = require('./filesystem.cjs').promises;
const { crc32 } = require('node:zlib');
const { MAX_INSTALLER_SIZE } = require('./policy.cjs');

// A deliberately narrow ZIP profile: one regular file at the root, STORE only,
// no paths, encryption, descriptors, extras, comments, links or ZIP64. Installers
// are already compressed. Never pass archive-controlled paths to the filesystem.
function headers(name, size, crc) {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]*\.(exe|deb|dmg)$/.test(name) ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > MAX_INSTALLER_SIZE
  )
    throw new Error('Conteúdo do ZIP de atualização inválido.');
  const filename = Buffer.from(name);
  const local = Buffer.alloc(30 + filename.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x800, 6);
  local.writeUInt16LE(0x21, 12); // 1980-01-01, deterministic DOS date
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(size, 18);
  local.writeUInt32LE(size, 22);
  local.writeUInt16LE(filename.length, 26);
  filename.copy(local, 30);
  const central = Buffer.alloc(46 + filename.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x314, 4); // UNIX, ZIP 2.0
  local.copy(central, 6, 4, 30);
  central.writeUInt32LE((0o100600 * 65536) >>> 0, 38);
  filename.copy(central, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length + size, 16);
  return { local, central, end };
}

async function readAt(handle, length, position) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset);
    if (!bytesRead) throw new Error('ZIP de atualização incompleto.');
    offset += bytesRead;
  }
  return buffer;
}

async function openRegular(file) {
  const entry = await fs.lstat(file);
  if (!entry.isFile() || entry.isSymbolicLink())
    throw new Error('Arquivo de atualização inválido.');
  return fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
}

async function createInstallerZip(source, destination, name) {
  const input = await openRegular(source);
  let output,
    created = false;
  try {
    const { size } = await input.stat();
    headers(name, size, 0); // Reject unsupported sizes before streaming the input.
    let crc = 0;
    for await (const chunk of input.createReadStream({ autoClose: false })) crc = crc32(chunk, crc);
    const { local, central, end } = headers(name, size, crc);
    output = await fs.open(destination, 'wx', 0o600);
    created = true;
    await output.writeFile(local);
    let copied = 0,
      copiedCrc = 0;
    for await (const chunk of input.createReadStream({ start: 0, autoClose: false })) {
      copied += chunk.length;
      if (copied > size) throw new Error('O instalador mudou durante o empacotamento.');
      copiedCrc = crc32(chunk, copiedCrc);
      await output.writeFile(chunk);
    }
    if (copied !== size || copiedCrc !== crc)
      throw new Error('O instalador mudou durante o empacotamento.');
    await output.writeFile(central);
    await output.writeFile(end);
    await output.sync();
  } catch (error) {
    await output?.close();
    output = undefined;
    if (created) await fs.unlink(destination).catch(() => {});
    throw error;
  } finally {
    await input.close();
    await output?.close();
  }
}

async function extractInstallerZip(
  source,
  destination,
  artifact,
  signal = new AbortController().signal,
) {
  signal.throwIfAborted();
  const input = await openRegular(source);
  let output,
    created = false;
  try {
    const first = await readAt(input, 30, 0);
    const crc = first.readUInt32LE(14);
    const { local, central, end } = headers(artifact.file, artifact.size, crc);
    const { size } = await input.stat();
    if (
      size !== local.length + artifact.size + central.length + end.length ||
      !(await readAt(input, local.length, 0)).equals(local) ||
      !(await readAt(input, central.length + end.length, local.length + artifact.size)).equals(
        Buffer.concat([central, end]),
      )
    )
      throw new Error('Estrutura do ZIP de atualização inválida.');
    signal.throwIfAborted();
    output = await fs.open(destination, 'wx', 0o600);
    created = true;
    const hash = createHash('sha512');
    let extracted = 0,
      actualCrc = 0;
    for await (const chunk of input.createReadStream({
      start: local.length,
      end: local.length + artifact.size - 1,
      autoClose: false,
    })) {
      signal.throwIfAborted();
      extracted += chunk.length;
      if (extracted > artifact.size)
        throw new Error('Conteúdo do ZIP excede o tamanho autorizado.');
      actualCrc = crc32(chunk, actualCrc);
      hash.update(chunk);
      await output.writeFile(chunk);
    }
    signal.throwIfAborted();
    if (extracted !== artifact.size || actualCrc !== crc || hash.digest('hex') !== artifact.sha512)
      throw new Error('O instalador extraído falhou na verificação de integridade.');
    await output.sync();
  } catch (error) {
    await output?.close();
    output = undefined;
    if (created) await fs.unlink(destination).catch(() => {});
    throw error;
  } finally {
    await input.close();
    await output?.close();
  }
}

module.exports = { createInstallerZip, extractInstallerZip };
