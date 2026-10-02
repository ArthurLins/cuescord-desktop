const { deflateSync } = require('node:zlib');

// Small local raster icons: no remote images, fonts or renderer privileges.
const digits = {
  0: ['111', '101', '101', '101', '111'],
  1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'],
  7: ['111', '001', '010', '010', '010'],
  8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
  '+': ['000', '010', '111', '010', '000'],
};

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([size, body, crc]);
}

function canvas() {
  const size = 64;
  const pixels = Buffer.alloc(size * size * 4);
  function paint(predicate, color) {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        if (!predicate(x + 0.5, y + 0.5)) continue;
        const offset = (y * size + x) * 4;
        for (let i = 0; i < 4; i++) pixels[offset + i] = color[i];
      }
  }
  const circle = (x, y, radius, color) =>
    paint((px, py) => (px - x) ** 2 + (py - y) ** 2 <= radius ** 2, color);
  function line(x1, y1, x2, y2, width, color) {
    const length = (x2 - x1) ** 2 + (y2 - y1) ** 2;
    paint((x, y) => {
      const t = Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / length));
      return (x - x1 - t * (x2 - x1)) ** 2 + (y - y1 - t * (y2 - y1)) ** 2 <= (width / 2) ** 2;
    }, color);
  }
  function png() {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header[8] = 8;
    header[9] = 6; // RGBA
    const rows = Buffer.alloc(size * (size * 4 + 1));
    for (let y = 0; y < size; y++)
      pixels.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(rows)),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
  return { paint, circle, line, png };
}

const white = [255, 255, 255, 255];
const red = [237, 66, 69, 255];

function badgePng(count) {
  const image = canvas();
  image.circle(32, 32, 31, red);
  const label = count > 99 ? '99+' : String(count);
  const scale = label.length === 1 ? 8 : label.length === 2 ? 6 : 4;
  const left = (64 - (label.length * 4 - 1) * scale) / 2;
  const top = (64 - 5 * scale) / 2;
  for (let i = 0; i < label.length; i++)
    for (let y = 0; y < 5; y++)
      for (let x = 0; x < 3; x++) {
        if (digits[label[i]][y][x] !== '1') continue;
        const x1 = left + (i * 4 + x) * scale;
        const y1 = top + y * scale;
        image.paint((px, py) => px >= x1 && px < x1 + scale && py >= y1 && py < y1 + scale, white);
      }
  return image.png();
}

function callPng(muted) {
  const image = canvas();
  image.circle(32, 32, 31, [35, 165, 90, 255]);
  const points = [
    [16, 15],
    [14, 22],
    [19, 31],
    [28, 39],
    [35, 41],
    [40, 36],
  ];
  for (let i = 1; i < points.length; i++) image.line(...points[i - 1], ...points[i], 7, white);
  image.line(16, 14, 22, 20, 9, white);
  image.line(35, 33, 42, 37, 9, white);
  image.circle(48, 48, 15, [22, 22, 26, 255]);
  image.circle(48, 48, 13, muted ? red : [35, 165, 90, 255]);
  image.line(48, 40, 48, 47, 5, white);
  image.line(42, 46, 42, 49, 2, white);
  image.line(42, 49, 45, 52, 2, white);
  image.line(45, 52, 51, 52, 2, white);
  image.line(51, 52, 54, 49, 2, white);
  image.line(54, 49, 54, 46, 2, white);
  image.line(48, 52, 48, 56, 2, white);
  image.line(45, 56, 51, 56, 2, white);
  if (muted) {
    image.line(40, 39, 56, 56, 5, red);
    image.line(40, 39, 56, 56, 2, white);
  }
  return image.png();
}

module.exports = { badgePng, callPng };
