export function sdf(srcData, width, height, opt = {}) {
  const { spread = 1, downscale = 1 } = opt;

  // 1) build a 1‐channel bitmask: 0 for “inside”, 255 for “outside”
  const N = width * height;
  const mask = new Uint8ClampedArray(N);
  for (let i = 0; i < N; i++) {
    const x = i % width,
      y = Math.floor(i / width);
    mask[i] = isInside(srcData, width, x, y) ? 0xff : 0x00;
  }

  // 2) prepare output
  const outW = Math.floor(width / downscale);
  const outH = Math.floor(height / downscale);
  const out = new Float32Array(outW * outH);

  // 3) compute SDF per‐pixel
  const maxDelta = Math.ceil(spread);
  for (let oy = 0; oy < outH; oy++) {
    for (let ox = 0; ox < outW; ox++) {
      // center of this block in source coords
      const cx = Math.floor(ox * downscale + downscale / 2);
      const cy = Math.floor(oy * downscale + downscale / 2);
      const d = signedDistance(mask, width, height, cx, cy, spread, maxDelta);
      out[oy * outW + ox] = d / spread; // -1..1 to 0..1
      // out[oy * outW + ox] = (d / spread) * 0.5 + 0.5; // -1..1 to 0..1
    }
  }

  return out;
}

// Is source pixel “inside”? based on alpha >128 AND any RGB >128
function isInside(data, w, x, y) {
  const idx = (y * w + x) * 4;
  const a = data[idx + 3];
  if (a <= 128) return false;
  return data[idx] > 128 || data[idx + 1] > 128 || data[idx + 2] > 128;
}

// Compute signed distance at (cx,cy)
function signedDistance(mask, w, h, cx, cy, spread, maxDelta) {
  const base = mask[cy * w + cx];
  const startX = Math.max(0, cx - maxDelta);
  const endX = Math.min(w - 1, cx + maxDelta);
  const startY = Math.max(0, cy - maxDelta);
  const endY = Math.min(h - 1, cy + maxDelta);

  let bestSq = maxDelta * maxDelta;
  for (let y = startY; y <= endY; y++) {
    const row = y * w;
    for (let x = startX; x <= endX; x++) {
      if (mask[row + x] !== base) {
        const dx = cx - x,
          dy = cy - y;
        const sq = dx * dx + dy * dy;
        if (sq < bestSq) bestSq = sq;
      }
    }
  }
  const dist = Math.sqrt(bestSq);
  // inside pixels should be negative SDF
  const sign = base === 0xff ? 1 : -1;
  return sign * Math.min(dist, spread);
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Example usage:
// const alphaMap = sdf(myImgData, imgWidth, imgHeight, { spread:5, downscale:2 });
