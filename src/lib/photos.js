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
