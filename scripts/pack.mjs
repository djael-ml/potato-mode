#!/usr/bin/env node
/**
 * Potato Mode — Zero-Dependency Cross-Browser Packager (.zip, .xpi, .crx)
 * - Generates POSIX-compliant ZIP archives (forward slashes '/' required by AMO & CWS)
 * - Generates Firefox .xpi package
 * - Generates Chrome CRX3 (.crx) package with local gitignored RSA-2048 key
 * - Generates releases/SHA256SUMS.txt for integrity verification
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RELEASES_DIR = path.join(ROOT, 'releases');
const KEYS_DIR = path.join(ROOT, '.keys');

// ---------------- Standard CRC32 ----------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------- Pure-Node POSIX ZIP Writer ----------------
function collectFiles(baseDir, currentDir = baseDir) {
  const entries = [];
  const list = fs.readdirSync(currentDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of list) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      entries.push(...collectFiles(baseDir, fullPath));
    } else if (entry.isFile()) {
      const relPosix = path.relative(baseDir, fullPath).split(path.sep).join('/');
      entries.push({ fullPath, relPosix });
    }
  }
  return entries;
}

export function createZipBuffer(sourceDir) {
  const files = collectFiles(sourceDir);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  // Deterministic DOS timestamp (2026-01-01 00:00:00)
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

  for (const file of files) {
    const raw = fs.readFileSync(file.fullPath);
    const compressed = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = compressed.length < raw.length;
    const data = useDeflate ? compressed : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);
    const nameBuf = Buffer.from(file.relPosix, 'utf8');

    // Local file header (30 bytes + name)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed 2.0
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, data);

    // Central directory header (46 bytes + name)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4); // UNIX + 2.0
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + data.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

// ---------------- Minimal Protobuf Encoder for CRX3 ----------------
function encodeVarint(value) {
  const bytes = [];
  let v = value >>> 0;
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v);
  return Buffer.from(bytes);
}

function encodeLenField(fieldNumber, payload) {
  const tag = encodeVarint((fieldNumber << 3) | 2);
  const len = encodeVarint(payload.length);
  return Buffer.concat([tag, len, payload]);
}

function loadOrCreateSigningKey(keyPath) {
  if (fs.existsSync(keyPath)) {
    const pem = fs.readFileSync(keyPath, 'utf8');
    const privateKey = crypto.createPrivateKey(pem);
    const publicKey = crypto.createPublicKey(privateKey);
    return { privateKey, publicKey };
  }

  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048
  });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  fs.writeFileSync(keyPath, pem, { mode: 0o600 });
  return { privateKey, publicKey };
}

export function createCrx3Buffer(zipBuffer, keyPath = path.join(KEYS_DIR, 'chrome-signing.pem')) {
  const { privateKey, publicKey } = loadOrCreateSigningKey(keyPath);
  const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' });

  // SignedData { bytes crx_id = 1; } -> first 16 bytes of SHA-256(publicKeyDer)
  const crxId = crypto.createHash('sha256').update(publicKeyDer).digest().subarray(0, 16);
  const signedHeaderData = encodeLenField(1, crxId);

  // CRX3 signed payload: "CRX3 SignedData\0" + uint32le(signedHeaderData.length) + signedHeaderData + zipBuffer
  const prefix = Buffer.from('CRX3 SignedData\0', 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(signedHeaderData.length, 0);

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(prefix);
  signer.update(lenBuf);
  signer.update(signedHeaderData);
  signer.update(zipBuffer);
  const signature = signer.sign(privateKey);

  // AsymmetricKeyProof { bytes public_key = 1; bytes signature = 2; }
  const proof = Buffer.concat([
    encodeLenField(1, publicKeyDer),
    encodeLenField(2, signature)
  ]);

  // CrxFileHeader { repeated AsymmetricKeyProof sha256_with_rsa = 2; bytes signed_header_data = 10000; }
  const headerProto = Buffer.concat([
    encodeLenField(2, proof),
    encodeLenField(10000, signedHeaderData)
  ]);

  const magic = Buffer.from('Cr24', 'ascii');
  const version = Buffer.alloc(4);
  version.writeUInt32LE(3, 0);
  const headerLen = Buffer.alloc(4);
  headerLen.writeUInt32LE(headerProto.length, 0);

  return Buffer.concat([magic, version, headerLen, headerProto, zipBuffer]);
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function packAll() {
  const chromeUnpacked = path.join(RELEASES_DIR, 'unpacked', 'chrome');
  const firefoxUnpacked = path.join(RELEASES_DIR, 'unpacked', 'firefox');

  if (!fs.existsSync(path.join(chromeUnpacked, 'manifest.json')) || !fs.existsSync(path.join(firefoxUnpacked, 'manifest.json'))) {
    throw new Error('Unpacked builds missing. Run `node scripts/build.mjs` first.');
  }

  const version = JSON.parse(fs.readFileSync(path.join(chromeUnpacked, 'manifest.json'), 'utf8')).version;

  const zipDir = path.join(RELEASES_DIR, 'zip');
  const packedDir = path.join(RELEASES_DIR, 'packed');
  fs.rmSync(zipDir, { recursive: true, force: true });
  fs.rmSync(packedDir, { recursive: true, force: true });
  fs.mkdirSync(zipDir, { recursive: true });
  fs.mkdirSync(packedDir, { recursive: true });

  const chromeZip = createZipBuffer(chromeUnpacked);
  const firefoxZip = createZipBuffer(firefoxUnpacked);
  const chromeCrx = createCrx3Buffer(chromeZip);

  const outputs = [
    { rel: `zip/potato-mode-chrome-v${version}.zip`, buf: chromeZip },
    { rel: `zip/potato-mode-firefox-v${version}.zip`, buf: firefoxZip },
    { rel: `packed/potato-mode-chrome-v${version}.crx`, buf: chromeCrx },
    { rel: `packed/potato-mode-firefox-v${version}.xpi`, buf: firefoxZip }
  ];

  const checksumLines = [];
  for (const out of outputs) {
    const abs = path.join(RELEASES_DIR, out.rel);
    fs.writeFileSync(abs, out.buf);
    checksumLines.push(`${sha256Hex(out.buf)}  ${out.rel}`);
  }

  fs.writeFileSync(path.join(RELEASES_DIR, 'SHA256SUMS.txt'), checksumLines.join('\n') + '\n', 'utf8');

  console.log(`Packed v${version} releases -> ${RELEASES_DIR}:`);
  for (const out of outputs) {
    console.log(`  - ${out.rel} (${(out.buf.length / 1024).toFixed(1)} KB)`);
  }

  return { version, outputs: outputs.map((o) => o.rel) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  packAll();
}
