export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.loading = 'eager';
  img.src = dataUrl;
  await img.decode();
  return img;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Very lightweight edge/bounds detection for "scanner-like" auto-crop.
 * v1: axis-aligned bounds only (no perspective correction).
 */
export async function detectDocumentBounds(dataUrl: string): Promise<CropRect | null> {
  const img = await loadImage(dataUrl);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (!srcW || !srcH) return null;

  // Downsample for speed.
  const targetW = Math.min(320, srcW);
  const scale = targetW / srcW;
  const targetH = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0, targetW, targetH);
  const { data } = ctx.getImageData(0, 0, targetW, targetH);

  // Build grayscale buffer.
  const gray = new Uint8ClampedArray(targetW * targetH);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    // Luma (Rec. 601)
    gray[p] = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) as unknown as number;
  }

  // Sobel magnitude (L1) + simple adaptive threshold.
  let sumMag = 0;
  let count = 0;
  let maxMag = 0;
  const step = 2;

  const magAt = (x: number, y: number) => {
    const idx = y * targetW + x;
    // Sobel kernels
    const gx =
      -gray[idx - targetW - 1] + gray[idx - targetW + 1] +
      -2 * gray[idx - 1] + 2 * gray[idx + 1] +
      -gray[idx + targetW - 1] + gray[idx + targetW + 1];
    const gy =
      -gray[idx - targetW - 1] - 2 * gray[idx - targetW] - gray[idx - targetW + 1] +
      gray[idx + targetW - 1] + 2 * gray[idx + targetW] + gray[idx + targetW + 1];
    return Math.abs(gx) + Math.abs(gy);
  };

  for (let y = 1; y < targetH - 1; y += step) {
    for (let x = 1; x < targetW - 1; x += step) {
      const m = magAt(x, y);
      sumMag += m;
      count += 1;
      if (m > maxMag) maxMag = m;
    }
  }

  if (!count || maxMag <= 0) return null;
  const meanMag = sumMag / count;
  const threshold = clamp(meanMag + (maxMag - meanMag) * 0.35, 80, 700);

  let minX = targetW, minY = targetH, maxX = 0, maxY = 0;
  let hit = 0;
  for (let y = 1; y < targetH - 1; y += step) {
    for (let x = 1; x < targetW - 1; x += step) {
      const m = magAt(x, y);
      if (m > threshold) {
        hit += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (!hit) return null;
  const boxW = maxX - minX;
  const boxH = maxY - minY;

  // If detection is too small, prefer no crop.
  if (boxW < targetW * 0.35 || boxH < targetH * 0.35) return null;

  // Expand with a small margin.
  const marginX = Math.round(targetW * 0.03);
  const marginY = Math.round(targetH * 0.03);
  minX = clamp(minX - marginX, 0, targetW - 1);
  minY = clamp(minY - marginY, 0, targetH - 1);
  maxX = clamp(maxX + marginX, 0, targetW - 1);
  maxY = clamp(maxY + marginY, 0, targetH - 1);

  // Map to original pixels.
  const invScale = 1 / scale;
  const x = Math.round(minX * invScale);
  const y = Math.round(minY * invScale);
  const width = Math.round((maxX - minX) * invScale);
  const height = Math.round((maxY - minY) * invScale);

  return {
    x: clamp(x, 0, srcW - 1),
    y: clamp(y, 0, srcH - 1),
    width: clamp(width, 1, srcW),
    height: clamp(height, 1, srcH),
  };
}

export async function cropImageDataUrl(
  dataUrl: string,
  rect: CropRect,
  options?: { mode?: 'color' | 'grayscale' | 'bw'; output?: 'jpeg' | 'png'; quality?: number }
): Promise<string> {
  const { mode = 'bw', output = 'jpeg', quality = 0.9 } = options || {};
  const img = await loadImage(dataUrl);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;

  const x = clamp(Math.round(rect.x), 0, Math.max(0, srcW - 1));
  const y = clamp(Math.round(rect.y), 0, Math.max(0, srcH - 1));
  const w = clamp(Math.round(rect.width), 1, srcW - x);
  const h = clamp(Math.round(rect.height), 1, srcH - y);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return dataUrl;

  ctx.drawImage(img, x, y, w, h, 0, 0, w, h);

  if (mode !== 'color') {
    const imageData = ctx.getImageData(0, 0, w, h);
    const pixels = imageData.data;

    // Simple adaptive threshold based on mean grayscale (fast).
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      sum += 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    }
    const mean = sum / (pixels.length / 4);
    const threshold = clamp(mean, 140, 220);

    for (let i = 0; i < pixels.length; i += 4) {
      const g = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      const v = mode === 'bw' ? (g > threshold ? 255 : 0) : g;
      pixels[i] = v;
      pixels[i + 1] = v;
      pixels[i + 2] = v;
    }
    ctx.putImageData(imageData, 0, 0);
  }

  const mime = output === 'png' ? 'image/png' : 'image/jpeg';
  return canvas.toDataURL(mime, output === 'png' ? undefined : quality);
}

