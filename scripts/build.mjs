#!/usr/bin/env node
/**
 * Potato Mode v3.0 — Unified Cross-Browser Build Script
 * Assembles src/ cleanly into releases/unpacked/chrome/ and releases/unpacked/firefox/.
 * Zero external dependencies.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateAllIcons } from './generate-icons.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const UNPACKED_ROOT = path.join(ROOT, 'releases', 'unpacked');

const TARGETS = [
  {
    name: 'chrome',
    outDir: path.join(UNPACKED_ROOT, 'chrome'),
    manifest: path.join(SRC, 'manifests', 'manifest.chrome.json')
  },
  {
    name: 'firefox',
    outDir: path.join(UNPACKED_ROOT, 'firefox'),
    manifest: path.join(SRC, 'manifests', 'manifest.firefox.json')
  }
];

function copyDirRecursive(srcDir, dstDir) {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

export function buildAll() {
  const start = Date.now();

  // 1. Always refresh icons cleanly from source generator
  const icons = generateAllIcons(path.join(SRC, 'icons'));

  // 2. Assemble each browser target from the unified source into releases/unpacked/
  const subdirs = ['shared', 'background', 'content', 'popup', 'icons'];

  for (const target of TARGETS) {
    fs.rmSync(target.outDir, { recursive: true, force: true });
    fs.mkdirSync(target.outDir, { recursive: true });

    for (const sub of subdirs) {
      copyDirRecursive(path.join(SRC, sub), path.join(target.outDir, sub));
    }

    fs.copyFileSync(target.manifest, path.join(target.outDir, 'manifest.json'));

    const privacyPath = path.join(ROOT, 'PRIVACY.md');
    if (fs.existsSync(privacyPath)) {
      fs.copyFileSync(privacyPath, path.join(target.outDir, 'PRIVACY.md'));
    }
  }

  const elapsed = Date.now() - start;
  console.log(`Built Chrome & Firefox unpacked v3.0.0 (${icons.length} icon assets) in ${elapsed}ms -> releases/unpacked/`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildAll();
}
