#!/usr/bin/env node
/**
 * Potato Mode — One-Command Full Release Pipeline
 * 1. Generates all 30 icon assets (5 states × 5 sizes + SVGs)
 * 2. Builds Chrome & Firefox MV3 unpacked extensions into releases/unpacked/
 * 3. Packs store-ready .zip, Firefox .xpi, Chrome .crx + SHA256SUMS.txt
 */

import { buildAll } from './build.mjs';
import { packAll } from './pack.mjs';

buildAll();
packAll();
