import sharp from 'sharp';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';

// SOP §7: 1200x800 .webp, deliberately sized for fast load + crisp on
// retina. We center-crop to that aspect ratio so phone-shot portrait
// frames still look right in the landscape card slot.
const TARGET_W = 1200;
const TARGET_H = 800;

export async function resizeToWebp(srcPath, destPath) {
  await mkdir(dirname(destPath), { recursive: true });
  await sharp(srcPath)
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
