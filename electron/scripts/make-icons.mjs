// @ts-check
// Generates the desktop app icons from code so there is no binary asset to hand-maintain.
// Draws the dashboard's "broadcast control" mark — a graphite tile, a tally-red lamp, and a
// play glyph — at the sizes Electron and the Windows installer need.
//
//   electron/assets/icon.png  256x256  window + Linux icon
//   electron/assets/tray.png   32x32   system tray
//   build/icon.ico            256x256  NSIS installer / .exe icon (PNG-in-ICO)

import { createCanvas } from "@napi-rs/canvas";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const assetsDir = path.join(here, "..", "assets");
const buildDir = path.join(root, "build");
fs.mkdirSync(assetsDir, { recursive: true });
fs.mkdirSync(buildDir, { recursive: true });

/**
 * Draws the mark at a given pixel size and returns a PNG buffer.
 * @param {number} size
 * @returns {Buffer}
 */
function render(size) {
  const c = createCanvas(size, size);
  const ctx = c.getContext("2d");
  const s = size;

  // Graphite rounded tile.
  const r = s * 0.22;
  ctx.fillStyle = "#16191e";
  roundRect(ctx, 0, 0, s, s, r);
  ctx.fill();

  // Hairline inner seam for the rack look.
  ctx.strokeStyle = "#333a44";
  ctx.lineWidth = Math.max(1, s * 0.015);
  roundRect(ctx, ctx.lineWidth / 2, ctx.lineWidth / 2, s - ctx.lineWidth, s - ctx.lineWidth, r);
  ctx.stroke();

  // Play glyph (rounded triangle), slightly left of center for optical balance.
  ctx.fillStyle = "#e6e9ef";
  ctx.lineJoin = "round";
  ctx.lineWidth = s * 0.08;
  ctx.strokeStyle = "#e6e9ef";
  const cx = s * 0.44;
  const cy = s * 0.5;
  const t = s * 0.2;
  ctx.beginPath();
  ctx.moveTo(cx - t * 0.7, cy - t);
  ctx.lineTo(cx + t, cy);
  ctx.lineTo(cx - t * 0.7, cy + t);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Tally lamp — the on-air dot, top-right.
  ctx.fillStyle = "#ff3b30";
  ctx.beginPath();
  ctx.arc(s * 0.74, s * 0.28, s * 0.09, 0, Math.PI * 2);
  ctx.fill();

  return c.toBuffer("image/png");
}

/**
 * @param {import("@napi-rs/canvas").SKRSContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r
 */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Wraps a 256x256 PNG into a single-image .ico (Vista+ supports PNG-compressed entries).
 * @param {Buffer} png
 * @returns {Buffer}
 */
function pngToIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // image count

  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0); // width 0 == 256
  entry.writeUInt8(0, 1); // height 0 == 256
  entry.writeUInt8(0, 2); // palette
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8); // image size
  entry.writeUInt32LE(6 + 16, 12); // offset to image data

  return Buffer.concat([header, entry, png]);
}

const icon256 = render(256);
fs.writeFileSync(path.join(assetsDir, "icon.png"), icon256);
fs.writeFileSync(path.join(assetsDir, "tray.png"), render(32));
fs.writeFileSync(path.join(buildDir, "icon.ico"), pngToIco(icon256));

console.log("[icons] wrote assets/icon.png, assets/tray.png, build/icon.ico");
