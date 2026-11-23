#!/usr/bin/env node
/**
 * Potato Mode v3.0 — Minimalist Apple-Style Icon Generator
 * Generates crisp, 4x supersampled, true-RGBA PNG icons across all 5 states
 * (active, inactive, paused, extreme, error) and all 5 standard sizes
 * (16, 32, 48, 96, 128) plus matching vector SVG masters.
 * Zero external dependencies — uses only Node.js built-in modules.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'src', 'icons');

const SIZES = [16, 32, 48, 96, 128];

const STATES = {
  active: {
    name: 'active',
    bgTop: [255, 178, 36],      // Warm Apple Amber
    bgBot: [232, 82, 12],       // Deep Vibrant Orange
    rimColor: [255, 236, 195],
    rimAlpha: 0.45,
    bodyTop: [253, 235, 198],   // Warm minimalist golden-cream potato
    bodyBot: [228, 176, 114],
    dimpleColor: [164, 88, 28],
    dimpleAlpha: 0.46,
    sproutTop: [130, 238, 125], // Fresh vibrant sprout leaf
    sproutBot: [42, 184, 86],
    badge: null
  },
  inactive: {
    name: 'inactive',
    bgTop: [104, 108, 116],     // Muted neutral slate (low contrast = clearly OFF)
    bgBot: [66, 69, 76],
    rimColor: [220, 224, 232],
    rimAlpha: 0.18,
    bodyTop: [198, 202, 210],
    bodyBot: [158, 162, 172],
    dimpleColor: [92, 96, 104],
    dimpleAlpha: 0.35,
    sproutTop: [164, 168, 176],
    sproutBot: [128, 132, 140],
    badge: null
  },
  paused: {
    name: 'paused',
    bgTop: [96, 196, 255],      // Apple Sky Blue (Site Excluded / Whitelisted)
    bgBot: [10, 112, 235],
    rimColor: [215, 240, 255],
    rimAlpha: 0.42,
    bodyTop: [246, 252, 255],
    bodyBot: [212, 234, 252],
    dimpleColor: [30, 122, 214],
    dimpleAlpha: 0.35,
    sproutTop: [176, 238, 255],
    sproutBot: [92, 198, 255],
    badge: { type: 'pause', bg: [24, 34, 52], fg: [255, 255, 255] }
  },
  extreme: {
    name: 'extreme',
    bgTop: [255, 214, 10],      // Radiant Apple Gold -> Blaze Orange
    bgBot: [228, 62, 10],
    rimColor: [255, 248, 200],
    rimAlpha: 0.55,
    bodyTop: [255, 240, 204],
    bodyBot: [238, 182, 112],
    dimpleColor: [168, 78, 18],
    dimpleAlpha: 0.45,
    sproutTop: [255, 246, 168],
    sproutBot: [255, 182, 28],
    badge: { type: 'bolt', bg: [28, 20, 14], fg: [255, 214, 10] }
  },
  error: {
    name: 'error',
    bgTop: [82, 82, 88],        // Dimmed graphite + Apple Coral alert dot
    bgBot: [48, 48, 54],
    rimColor: [210, 210, 218],
    rimAlpha: 0.22,
    bodyTop: [192, 192, 198],
    bodyBot: [152, 152, 160],
    dimpleColor: [84, 84, 92],
    dimpleAlpha: 0.35,
    sproutTop: [156, 156, 164],
    sproutBot: [118, 118, 126],
    badge: { type: 'alert', bg: [255, 69, 58], fg: [255, 255, 255] }
  }
};

// ---------------- Math & SDF Primitives ----------------

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Smooth Apple-like superellipse / squircle signed distance (approx)
function sdSquircle(x, y, r, n = 4.2) {
  const ax = Math.abs(x) / r;
  const ay = Math.abs(y) / r;
  const p = Math.pow(ax, n) + Math.pow(ay, n);
  const d = Math.pow(p, 1 / n) - 1;
  return d * r;
}

// Minimalist organic potato silhouette (smooth slightly tapered pebble)
function sdPotato(x, y) {
  // Slight organic tilt (-14 deg)
  const cos = 0.9703;
  const sin = -0.2419;
  const rx = x * cos - y * sin;
  const ry = x * sin + y * cos;

  // Gentle organic taper: slightly narrower at top, fuller at bottom
  const taper = 1 + 0.11 * clamp(ry / 0.34, -1, 1);
  const a = 0.235 * taper;
  const b = 0.305;

  // Normalized ellipse distance approximation
  const ex = rx / a;
  const ey = ry / b;
  const k0 = Math.hypot(ex, ey);
  if (k0 === 0) return -Math.min(a, b);
  const k1 = Math.hypot(rx / (a * a), ry / (b * b));
  return (k0 * (k0 - 1)) / k1;
}

// Smooth almond/leaf sprout shape
function sdLeaf(x, y, cx, cy, angle, rx, ry) {
  const dx = x - cx;
  const dy = y - cy;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  const ex = lx / rx;
  const ey = ly / ry;
  const k0 = Math.hypot(ex, ey);
  if (k0 === 0) return -Math.min(rx, ry);
  const k1 = Math.hypot(lx / (rx * rx), ly / (ry * ry));
  return (k0 * (k0 - 1)) / k1;
}

function sdBox(x, y, cx, cy, hw, hh, r = 0) {
  const dx = Math.abs(x - cx) - hw + r;
  const dy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h);
}

function sdTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const e0x = bx - ax, e0y = by - ay;
  const e1x = cx - bx, e1y = cy - by;
  const e2x = ax - cx, e2y = ay - cy;
  const v0x = px - ax, v0y = py - ay;
  const v1x = px - bx, v1y = py - by;
  const v2x = px - cx, v2y = py - cy;

  const pq0x = v0x - e0x * clamp((v0x * e0x + v0y * e0y) / (e0x * e0x + e0y * e0y), 0, 1);
  const pq0y = v0y - e0y * clamp((v0x * e0x + v0y * e0y) / (e0x * e0x + e0y * e0y), 0, 1);
  const pq1x = v1x - e1x * clamp((v1x * e1x + v1y * e1y) / (e1x * e1x + e1y * e1y), 0, 1);
  const pq1y = v1y - e1y * clamp((v1x * e1x + v1y * e1y) / (e1x * e1x + e1y * e1y), 0, 1);
  const pq2x = v2x - e2x * clamp((v2x * e2x + v2y * e2y) / (e2x * e2x + e2y * e2y), 0, 1);
  const pq2y = v2y - e2y * clamp((v2x * e2x + v2y * e2y) / (e2x * e2x + e2y * e2y), 0, 1);

  const s = Math.sign(e0x * e2y - e0y * e2x);
  const d0 = pq0x * pq0x + pq0y * pq0y;
  const d1 = pq1x * pq1x + pq1y * pq1y;
  const d2 = pq2x * pq2x + pq2y * pq2y;
  const c0 = s * (v0x * e0y - v0y * e0x);
  const c1 = s * (v1x * e1y - v1y * e1x);
  const c2 = s * (v2x * e2y - v2y * e2x);
  const minD = Math.min(d0, d1, d2);
  const minC = Math.min(c0, c1, c2);
  return -Math.sqrt(minD) * Math.sign(minC);
}

// Standard Porter-Duff source-over alpha compositing (premultiplied or straight)
function over(dst, srcR, srcG, srcB, srcA) {
  if (srcA <= 0) return;
  const a = clamp(srcA, 0, 1);
  const outA = a + dst[3] * (1 - a);
  if (outA <= 0) return;
  dst[0] = (srcR * a + dst[0] * dst[3] * (1 - a)) / outA;
  dst[1] = (srcG * a + dst[1] * dst[3] * (1 - a)) / outA;
  dst[2] = (srcB * a + dst[2] * dst[3] * (1 - a)) / outA;
  dst[3] = outA;
}

// Sample a single sub-pixel in normalized [-0.5, 0.5] icon coordinates
function sampleIcon(nx, ny, cfg, aa) {
  const px = [0, 0, 0, 0];

  // 1. Soft subtle contact shadow under squircle (keeps icon crisp on light & dark toolbars)
  const dShadow = sdSquircle(nx, ny - 0.018, 0.435, 4.3);
  if (dShadow < 0.04) {
    const shA = (1 - smoothstep(-0.01, 0.038, dShadow)) * 0.22;
    over(px, 0, 0, 0, shA);
  }

  // 2. Main Apple Squircle container
  const dSq = sdSquircle(nx, ny, 0.435, 4.3);
  const sqMask = 1 - smoothstep(-aa, aa, dSq);

  if (sqMask > 0) {
    const gradT = clamp((ny + 0.44) / 0.88 * 0.85 + (nx + 0.44) / 0.88 * 0.15, 0, 1);
    let r = lerp(cfg.bgTop[0], cfg.bgBot[0], gradT);
    let g = lerp(cfg.bgTop[1], cfg.bgBot[1], gradT);
    let b = lerp(cfg.bgTop[2], cfg.bgBot[2], gradT);

    // Top-left Liquid Glass radial highlight
    const glossDist = Math.hypot(nx + 0.16, ny + 0.24);
    const gloss = Math.pow(clamp(1 - glossDist / 0.58, 0, 1), 2.2) * 0.26;
    r = lerp(r, 255, gloss);
    g = lerp(g, 255, gloss);
    b = lerp(b, 255, gloss);

    // Subtle bottom inner darkening for tactile depth
    const bottomShade = smoothstep(0.18, 0.45, ny) * 0.14;
    r *= (1 - bottomShade);
    g *= (1 - bottomShade);
    b *= (1 - bottomShade);

    over(px, r, g, b, sqMask);

    // Inner Apple glass specular rim (stronger on top edge)
    const rimBand = (1 - smoothstep(0, 0.022, Math.abs(dSq + 0.011))) * sqMask;
    const topBias = clamp(1 - (ny + 0.42) / 0.72, 0.2, 1);
    if (rimBand > 0) {
      over(px, cfg.rimColor[0], cfg.rimColor[1], cfg.rimColor[2], rimBand * cfg.rimAlpha * topBias);
    }
  }

  // 3. Minimalist Potato emblem (centered slightly lower to leave room for sprout)
  const potX = nx;
  const potY = ny - 0.032;

  // Soft elevation shadow behind potato
  const dPotShadow = sdPotato(potX - 0.008, potY - 0.024);
  if (dPotShadow < 0.06 && sqMask > 0) {
    const pSh = (1 - smoothstep(-0.015, 0.055, dPotShadow)) * 0.22 * sqMask;
    over(px, 28, 12, 4, pSh);
  }

  // Tiny sleek sprout leaf emerging from top of potato
  const dLeafR = sdLeaf(nx, ny, 0.075, -0.295, -0.58, 0.095, 0.048);
  const dLeafL = sdLeaf(nx, ny, -0.042, -0.285, 0.72, 0.068, 0.036);
  const dSprout = Math.min(dLeafR, dLeafL);
  const sproutMask = 1 - smoothstep(-aa, aa, dSprout);
  if (sproutMask > 0) {
    const st = clamp((ny + 0.35) / 0.14, 0, 1);
    const sr = lerp(cfg.sproutTop[0], cfg.sproutBot[0], st);
    const sg = lerp(cfg.sproutTop[1], cfg.sproutBot[1], st);
    const sb = lerp(cfg.sproutTop[2], cfg.sproutBot[2], st);
    over(px, sr, sg, sb, sproutMask);
  }

  // Potato body
  const dPot = sdPotato(potX, potY);
  const potMask = 1 - smoothstep(-aa, aa, dPot);
  if (potMask > 0) {
    const pt = clamp((potY + 0.30) / 0.60, 0, 1);
    let br = lerp(cfg.bodyTop[0], cfg.bodyBot[0], pt);
    let bg = lerp(cfg.bodyTop[1], cfg.bodyBot[1], pt);
    let bb = lerp(cfg.bodyTop[2], cfg.bodyBot[2], pt);

    // Soft glass highlight on upper-left cheek of the potato
    const cheekDist = Math.hypot((potX + 0.075) * 1.15, (potY + 0.115) * 0.9);
    const cheek = Math.pow(clamp(1 - cheekDist / 0.19, 0, 1), 2.0) * 0.45;
    br = lerp(br, 255, cheek);
    bg = lerp(bg, 255, cheek);
    bb = lerp(bb, 255, cheek);

    over(px, br, bg, bb, potMask);

    // Subtle organic potato dimples (3 tiny refined marks, understated & clean)
    const d1 = Math.hypot((potX - 0.075) * 0.85, (potY + 0.045) * 1.35) - 0.028;
    const d2 = Math.hypot((potX + 0.068) * 0.9, (potY - 0.095) * 1.3) - 0.024;
    const d3 = Math.hypot((potX - 0.035) * 0.95, (potY - 0.155) * 1.3) - 0.019;
    const dDimple = Math.min(d1, d2, d3);
    const dimpleMask = (1 - smoothstep(-aa, aa, dDimple)) * potMask;
    if (dimpleMask > 0) {
      over(px, cfg.dimpleColor[0], cfg.dimpleColor[1], cfg.dimpleColor[2], dimpleMask * cfg.dimpleAlpha);
    }
  }

  // 4. Optional status badge (bottom-right corner) for paused / extreme / error
  if (cfg.badge) {
    const bx = 0.255;
    const by = 0.255;
    const br = 0.178;

    // Subtle outer halo ring for separation
    const dRing = Math.hypot(nx - bx, ny - by) - (br + 0.026);
    const ringMask = 1 - smoothstep(-aa, aa, dRing);
    if (ringMask > 0) {
      over(px, 255, 255, 255, ringMask * 0.92);
    }

    const dCircle = Math.hypot(nx - bx, ny - by) - br;
    const circleMask = 1 - smoothstep(-aa, aa, dCircle);
    if (circleMask > 0) {
      over(px, cfg.badge.bg[0], cfg.badge.bg[1], cfg.badge.bg[2], circleMask);

      const lx = nx - bx;
      const ly = ny - by;
      let glyphD = 1;

      if (cfg.badge.type === 'pause') {
        const barL = sdBox(lx, ly, -0.044, 0, 0.024, 0.074, 0.012);
        const barR = sdBox(lx, ly, 0.044, 0, 0.024, 0.074, 0.012);
        glyphD = Math.min(barL, barR);
      } else if (cfg.badge.type === 'alert') {
        const stem = sdBox(lx, ly, 0, -0.026, 0.021, 0.058, 0.014);
        const dot = Math.hypot(lx, ly - 0.068) - 0.023;
        glyphD = Math.min(stem, dot);
      } else if (cfg.badge.type === 'bolt') {
        // Crisp 2-triangle lightning bolt
        const t1 = sdTriangle(lx, ly, 0.026, -0.105, -0.068, 0.012, 0.012, 0.012);
        const t2 = sdTriangle(lx, ly, -0.026, 0.105, 0.068, -0.012, -0.012, -0.012);
        glyphD = Math.min(t1, t2);
      }

      const glyphMask = (1 - smoothstep(-aa, aa, glyphD)) * circleMask;
      if (glyphMask > 0) {
        over(px, cfg.badge.fg[0], cfg.badge.fg[1], cfg.badge.fg[2], glyphMask);
      }
    }
  }

  return px;
}

// ---------------- Minimalist Pure-Node PNG Encoder ----------------

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

function pngChunk(type, data) {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const combined = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([lenBuf, combined, crcBuf]);
}

function encodePNG(width, height, rgbaBuffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type None
    rgbaBuffer.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function renderStatePNG(cfg, size) {
  const ss = size <= 32 ? 4 : 3; // 4x4 supersampling for tiny toolbar icons, 3x3 for larger
  const aa = 0.75 / size;
  const rgba = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let accR = 0, accG = 0, accB = 0, accA = 0;

      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) / ss) / size - 0.5;
          const v = (y + (sy + 0.5) / ss) / size - 0.5;
          const s = sampleIcon(u, v, cfg, aa);
          // Premultiplied accumulation for artifact-free edges
          accR += s[0] * s[3];
          accG += s[1] * s[3];
          accB += s[2] * s[3];
          accA += s[3];
        }
      }

      const samples = ss * ss;
      const outA = accA / samples;
      const idx = (y * size + x) * 4;
      if (outA > 0.0001) {
        rgba[idx] = clamp(Math.round(accR / accA), 0, 255);
        rgba[idx + 1] = clamp(Math.round(accG / accA), 0, 255);
        rgba[idx + 2] = clamp(Math.round(accB / accA), 0, 255);
        rgba[idx + 3] = clamp(Math.round(outA * 255), 0, 255);
      } else {
        rgba[idx] = 0;
        rgba[idx + 1] = 0;
        rgba[idx + 2] = 0;
        rgba[idx + 3] = 0;
      }
    }
  }

  return encodePNG(size, size, rgba);
}

function rgbCss(arr) {
  return `rgb(${arr[0]},${arr[1]},${arr[2]})`;
}

function buildStateSVG(cfg) {
  let badgeSvg = '';
  if (cfg.badge) {
    const cx = 96.6;
    const cy = 96.6;
    const r = 22.8;
    let inner = '';
    if (cfg.badge.type === 'pause') {
      inner = `<rect x="${cx - 8.5}" y="${cy - 9.5}" width="5.8" height="19" rx="2.5" fill="${rgbCss(cfg.badge.fg)}"/>
      <rect x="${cx + 2.7}" y="${cy - 9.5}" width="5.8" height="19" rx="2.5" fill="${rgbCss(cfg.badge.fg)}"/>`;
    } else if (cfg.badge.type === 'alert') {
      inner = `<rect x="${cx - 2.6}" y="${cy - 11}" width="5.2" height="14.5" rx="2.4" fill="${rgbCss(cfg.badge.fg)}"/>
      <circle cx="${cx}" cy="${cy + 8.6}" r="3" fill="${rgbCss(cfg.badge.fg)}"/>`;
    } else if (cfg.badge.type === 'bolt') {
      inner = `<polygon points="${cx + 3},${cy - 13} ${cx - 8.5},${cy + 1.5} ${cx - 1},${cy + 1.5} ${cx - 3},${cy + 13} ${cx + 8.5},${cy - 1.5} ${cx + 1},${cy - 1.5}" fill="${rgbCss(cfg.badge.fg)}"/>`;
    }
    badgeSvg = `
  <circle cx="${cx}" cy="${cy}" r="${r + 3.4}" fill="#ffffff" fill-opacity="0.92"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${rgbCss(cfg.badge.bg)}"/>
  ${inner}`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <linearGradient id="bg-${cfg.name}" x1="15%" y1="5%" x2="85%" y2="95%">
      <stop offset="0%" stop-color="${rgbCss(cfg.bgTop)}"/>
      <stop offset="100%" stop-color="${rgbCss(cfg.bgBot)}"/>
    </linearGradient>
    <radialGradient id="gloss-${cfg.name}" cx="32%" cy="24%" r="60%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="body-${cfg.name}" x1="30%" y1="15%" x2="70%" y2="95%">
      <stop offset="0%" stop-color="${rgbCss(cfg.bodyTop)}"/>
      <stop offset="100%" stop-color="${rgbCss(cfg.bodyBot)}"/>
    </linearGradient>
    <linearGradient id="sprout-${cfg.name}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${rgbCss(cfg.sproutTop)}"/>
      <stop offset="100%" stop-color="${rgbCss(cfg.sproutBot)}"/>
    </linearGradient>
  </defs>
  <rect x="8" y="8" width="112" height="112" rx="28" fill="url(#bg-${cfg.name})"/>
  <rect x="8" y="8" width="112" height="112" rx="28" fill="url(#gloss-${cfg.name})"/>
  <rect x="9.5" y="9.5" width="109" height="109" rx="26.5" fill="none" stroke="${rgbCss(cfg.rimColor)}" stroke-opacity="${cfg.rimAlpha}" stroke-width="2"/>
  <ellipse cx="73.5" cy="26.5" rx="12" ry="6" transform="rotate(-33 73.5 26.5)" fill="url(#sprout-${cfg.name})"/>
  <ellipse cx="58.5" cy="28" rx="8.6" ry="4.6" transform="rotate(41 58.5 28)" fill="url(#sprout-${cfg.name})"/>
  <g transform="rotate(-14 64 68)">
    <path d="M64 31 C82 31 94 48 96 69 C98 92 84 107 64 107 C44 107 32 92 34 69 C36 48 46 31 64 31 Z" fill="url(#body-${cfg.name})"/>
    <ellipse cx="74" cy="61" rx="4.2" ry="2.6" fill="${rgbCss(cfg.dimpleColor)}" fill-opacity="${cfg.dimpleAlpha}"/>
    <ellipse cx="55" cy="80" rx="3.4" ry="2.2" fill="${rgbCss(cfg.dimpleColor)}" fill-opacity="${cfg.dimpleAlpha}"/>
    <ellipse cx="69" cy="88" rx="2.8" ry="1.8" fill="${rgbCss(cfg.dimpleColor)}" fill-opacity="${cfg.dimpleAlpha}"/>
  </g>${badgeSvg}
</svg>
`;
}

export function generateAllIcons(targetDir = OUT_DIR) {
  fs.mkdirSync(targetDir, { recursive: true });
  const generated = [];

  for (const cfg of Object.values(STATES)) {
    const svgPath = path.join(targetDir, `${cfg.name}.svg`);
    fs.writeFileSync(svgPath, buildStateSVG(cfg), 'utf8');
    generated.push(svgPath);

    for (const size of SIZES) {
      const pngBuffer = renderStatePNG(cfg, size);
      const pngPath = path.join(targetDir, `${cfg.name}-${size}.png`);
      fs.writeFileSync(pngPath, pngBuffer);
      generated.push(pngPath);
    }
  }

  return generated;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const start = Date.now();
  const files = generateAllIcons();
  console.log(`Generated ${files.length} icon assets in ${Date.now() - start}ms -> ${OUT_DIR}`);
}
