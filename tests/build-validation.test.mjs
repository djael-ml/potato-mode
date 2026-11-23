import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RELEASES = path.join(ROOT, 'releases');

const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const BUILDS = [
  { name: 'chrome', dir: path.join(RELEASES, 'unpacked', 'chrome') },
  { name: 'firefox', dir: path.join(RELEASES, 'unpacked', 'firefox') }
];

const ICON_STATES = ['active', 'inactive', 'paused', 'extreme', 'error'];
const ICON_SIZES = [16, 32, 48, 96, 128];

function walkFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkFiles(full));
    else results.push(full);
  }
  return results;
}

function readZipEntryNames(buf) {
  // Verify PK local header signature
  assert.equal(buf.readUInt32LE(0), 0x04034b50, 'Archive must start with PK ZIP signature');
  // Locate EOCD record at end of buffer
  const eocdOffset = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocdOffset >= 0, 'ZIP must have End of Central Directory record');

  const cdCount = buf.readUInt16LE(eocdOffset + 10);
  let pos = buf.readUInt32LE(eocdOffset + 16);
  const names = [];

  for (let i = 0; i < cdCount; i++) {
    assert.equal(buf.readUInt32LE(pos), 0x02014b50, 'Invalid Central Directory entry signature');
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
    names.push(name);
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

describe('MV3 Build Validation (Chrome & Firefox Parity)', () => {
  it('keeps repository root clean without legacy duplicated extension folders', () => {
    assert.equal(fs.existsSync(path.join(ROOT, 'potato-mode-chrome')), false);
    assert.equal(fs.existsSync(path.join(ROOT, 'potato-mode-firefox')), false);
  });

  for (const build of BUILDS) {
    it(`[${build.name}] has valid MV3 manifest and target-specific configuration`, () => {
      const manifestPath = path.join(build.dir, 'manifest.json');
      assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      assert.equal(manifest.manifest_version, 3);
      assert.equal(manifest.version, PKG_VERSION);
      assert.ok(manifest.permissions.includes('declarativeNetRequest'));
      assert.ok(manifest.permissions.includes('alarms'));
      assert.ok(manifest.permissions.includes('tabs'));
      // Must exclude extension popups (chrome-extension://, moz-extension://)
      assert.deepEqual(manifest.host_permissions, ['http://*/*', 'https://*/*']);
      for (const cs of manifest.content_scripts) {
        assert.deepEqual(cs.matches, ['http://*/*', 'https://*/*']);
      }

      if (build.name === 'chrome') {
        assert.equal(manifest.background.service_worker, 'background/background.js');
        assert.ok(manifest.permissions.includes('system.memory'));
        assert.ok(manifest.permissions.includes('system.cpu'));
      } else {
        assert.ok(Array.isArray(manifest.background.scripts));
        assert.ok(manifest.background.scripts.includes('background/background.js'));
        assert.ok(!manifest.permissions.includes('system.memory'), 'Firefox must not declare system.memory');
        assert.ok(!manifest.permissions.includes('system.cpu'), 'Firefox must not declare system.cpu');
        assert.equal(manifest.browser_specific_settings.gecko.id, 'potato-mode@djael-ml.github');
      }

      for (const cs of manifest.content_scripts) {
        for (const f of [...(cs.js || []), ...(cs.css || [])]) {
          assert.ok(fs.existsSync(path.join(build.dir, f)), `Missing content asset: ${f}`);
        }
      }
      assert.ok(fs.existsSync(path.join(build.dir, manifest.action.default_popup)));
    });

    it(`[${build.name}] contains all 25 valid RGBA PNG icons + 5 SVGs with exact sizes`, () => {
      for (const state of ICON_STATES) {
        const svgPath = path.join(build.dir, 'icons', `${state}.svg`);
        assert.ok(fs.existsSync(svgPath), `Missing SVG: ${svgPath}`);

        for (const size of ICON_SIZES) {
          const pngPath = path.join(build.dir, 'icons', `${state}-${size}.png`);
          assert.ok(fs.existsSync(pngPath), `Missing PNG: ${pngPath}`);

          const buf = fs.readFileSync(pngPath);
          assert.deepEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
          assert.equal(buf.readUInt32BE(16), size);
          assert.equal(buf.readUInt32BE(20), size);
          assert.equal(buf[25], 6, 'Icon must be RGBA');
        }
      }
    });

    it(`[${build.name}] passes MV3 CSP, Privacy, and Perplexity animation regression checks`, () => {
      const popupHtml = fs.readFileSync(path.join(build.dir, 'popup', 'popup.html'), 'utf8');
      const popupCss = fs.readFileSync(path.join(build.dir, 'popup', 'popup.css'), 'utf8');
      const contentCss = fs.readFileSync(path.join(build.dir, 'content', 'content.css'), 'utf8');

      assert.equal(/\bon[a-z]+\s*=/i.test(popupHtml), false, 'No inline event handlers');
      assert.equal(/<script(?![^>]*\bsrc=)/i.test(popupHtml), false, 'No inline scripts');
      assert.equal(/fonts\.googleapis\.com/i.test(popupHtml + popupCss), false, 'No Google Fonts');
      assert.equal(/@import\s+url\(/i.test(popupCss + contentCss), false, 'No external CSS @import');

      const cssNoComments = contentCss.replace(/\/\*[\s\S]*?\*\//g, '');
      assert.equal(/animation\s*:\s*none/i.test(cssNoComments), false, 'Must not use animation: none');
      assert.equal(/animation-play-state\s*:\s*paused/i.test(cssNoComments), false, 'Must not pause animations');
      assert.ok(/animation-duration\s*:\s*0\.001ms/i.test(cssNoComments), 'Must use 0.001ms safe completion');
      assert.equal(/\[class\*="banner"\]/i.test(cssNoComments), false, 'No destructive generic banner rule');
      assert.equal(/\[class\*="popup"\]/i.test(cssNoComments), false, 'No destructive generic popup rule');

      // Layout regression guard: scrollable settings/RAM views must use block layout (never flex-shrink clip cards)
      assert.ok(/\.view\.scrollable\s*\{[^}]*display\s*:\s*block/i.test(popupCss), 'Scrollable views must use display: block');

      // Extension popup exclusion guard in DNR background rules
      const bgJs = fs.readFileSync(path.join(build.dir, 'background', 'background.js'), 'utf8');
      assert.ok(bgJs.includes("urlFilter: '|http'"), 'DNR rules must target HTTP(S) only, excluding extension popups');
      assert.equal(bgJs.includes('Scan manuel'), false, 'Auto Adaptive must never label itself as Scan manuel');
    });

    it(`[${build.name}] passes Node.js syntax check on all generated JS files`, () => {
      const jsFiles = walkFiles(build.dir).filter((f) => f.endsWith('.js'));
      assert.ok(jsFiles.length >= 7);
      for (const file of jsFiles) {
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
      }
    });
  }
});

describe('Packed & ZIP Release Artifacts', () => {
  it('produces valid POSIX ZIP archives for Chrome & Firefox (zero backslashes)', () => {
    for (const rel of [`zip/potato-mode-chrome-v${PKG_VERSION}.zip`, `zip/potato-mode-firefox-v${PKG_VERSION}.zip`]) {
      const fullPath = path.join(RELEASES, rel);
      assert.ok(fs.existsSync(fullPath), `Missing ZIP: ${rel}`);
      const names = readZipEntryNames(fs.readFileSync(fullPath));
      assert.ok(names.includes('manifest.json'), `${rel} must contain root manifest.json`);
      assert.ok(names.includes('popup/popup.html'), `${rel} must contain popup/popup.html`);
      assert.ok(names.every((n) => !n.includes('\\')), `${rel} must use POSIX forward slashes only`);
    }
  });

  it('produces valid Firefox .xpi and Chrome CRX3 .crx packed extensions', () => {
    const xpiPath = path.join(RELEASES, 'packed', `potato-mode-firefox-v${PKG_VERSION}.xpi`);
    assert.ok(fs.existsSync(xpiPath), 'Missing Firefox .xpi');
    const xpiNames = readZipEntryNames(fs.readFileSync(xpiPath));
    assert.ok(xpiNames.includes('manifest.json'));

    const crxPath = path.join(RELEASES, 'packed', `potato-mode-chrome-v${PKG_VERSION}.crx`);
    assert.ok(fs.existsSync(crxPath), 'Missing Chrome .crx');
    const crx = fs.readFileSync(crxPath);
    assert.equal(crx.subarray(0, 4).toString('ascii'), 'Cr24', 'CRX3 magic must be Cr24');
    assert.equal(crx.readUInt32LE(4), 3, 'CRX version must be 3');
    const headerLen = crx.readUInt32LE(8);
    assert.ok(headerLen > 200, 'CRX3 header must include RSA key + signature');
    const embeddedZip = crx.subarray(12 + headerLen);
    const crxNames = readZipEntryNames(embeddedZip);
    assert.ok(crxNames.includes('manifest.json'));
  });

  it('verifies releases/SHA256SUMS.txt matches every generated archive', () => {
    const sumsPath = path.join(RELEASES, 'SHA256SUMS.txt');
    assert.ok(fs.existsSync(sumsPath), 'SHA256SUMS.txt must exist');
    const lines = fs.readFileSync(sumsPath, 'utf8').trim().split(/\r?\n/);
    assert.equal(lines.length, 4);
    for (const line of lines) {
      const [expectedHash, relFile] = line.split(/\s+/);
      const actualHash = crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(RELEASES, relFile)))
        .digest('hex');
      assert.equal(actualHash, expectedHash, `Checksum mismatch for ${relFile}`);
    }
  });
});
