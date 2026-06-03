import sharp from 'sharp';
import heicConvert from 'heic-convert';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';

// SOP §7: 1200x800 .webp, deliberately sized for fast load + crisp on
// retina. We center-crop to that aspect ratio so phone-shot portrait
// frames still look right in the landscape card slot.
const TARGET_W = 1200;
const TARGET_H = 800;

// iPhones save HEIC by default. Sharp's prebuilt libvips includes a
// HEIF container reader but ships without the HEVC decoder plugin
// (patent reasons), so .heic files arrive as "No decoding plugin
// installed for this compression format". Sniff the magic bytes and
// run them through heic-convert (pure-JS WASM decoder) first.
async function loadAsSharpableBuffer(srcPath) {
  const buf = await readFile(srcPath);
  if (isHeic(buf)) {
    const jpeg = await heicConvert({
      buffer: buf,
      format: 'JPEG',
      quality: 0.9,
    });
    return Buffer.from(jpeg);
  }
  return buf;
}

// HEIC / HEIF files start with an ISO BMFF "ftyp" box whose brand is
// one of these. The brand sits at bytes 4-11.
function isHeic(buf) {
  if (buf.length < 12) return false;
  if (buf.slice(4, 8).toString('ascii') !== 'ftyp') return false;
  const brand = buf.slice(8, 12).toString('ascii');
  return ['heic', 'heix', 'heim', 'heis', 'mif1', 'msf1', 'hevc', 'hevm', 'hevs', 'avif'].includes(brand);
}

export async function resizeToWebp(srcPath, destPath) {
  await mkdir(dirname(destPath), { recursive: true });
  const input = await loadAsSharpableBuffer(srcPath);
  await sharp(input)
    .rotate() // honor EXIF orientation from phone cameras
    .resize(TARGET_W, TARGET_H, { fit: 'cover', position: 'centre' })
    .webp({ quality: 82 })
    .toFile(destPath);
  return destPath;
}

export async function processBeforeAfter({ before, after, slug, outDir }) {
  const beforeOut = join(outDir, `${slug}-before.webp`);
  const afterOut  = join(outDir, `${slug}-after.webp`);
  await Promise.all([
    resizeToWebp(before, beforeOut),
    resizeToWebp(after, afterOut),
  ]);
  // Clean the multer uploads — they're no longer needed.
  await Promise.allSettled([unlink(before), unlink(after)]);
  return { beforeOut, afterOut };
}

// Process up to N optional additional photos in parallel. Each gets a
// stable filename based on its slot index so the project page can
// reference them deterministically. Empty / missing slots are skipped.
// Returns the list of full output paths in submission order.
export async function processExtras({ files, slug, outDir, max = 5 }) {
  if (!files || files.length === 0) return [];
  const real = files.filter(f => f && f.size > 0).slice(0, max);
  const outs = [];
  for (let i = 0; i < real.length; i++) {
    const out = join(outDir, `${slug}-extra-${i + 1}.webp`);
    await resizeToWebp(real[i].path, out);
    await unlink(real[i].path).catch(() => {});
    outs.push(out);
  }
  return outs;
}

// Square avatar resizer for tech profile photos. Crops to a 600×600
// .webp so the published team page renders crisp at any retina
// density. We don't make it circular here — the template's CSS
// applies the mask via border-radius, so we keep the source square.
export async function resizeAvatar(srcPath, destPath) {
  await mkdir(dirname(destPath), { recursive: true });
  const input = await loadAsSharpableBuffer(srcPath);
  await sharp(input)
    .rotate()
    .resize(600, 600, { fit: 'cover', position: 'centre' })
    .webp({ quality: 88 })
    .toFile(destPath);
  return destPath;
}
