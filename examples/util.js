import * as Color from "@texel/color";

export function loadImage(src, maxSize) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = src;
    img.crossOrigin = "Anonymous"; // In case of cross-origin issues.
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ratio =
        maxSize == null
          ? 1
          : Math.min(1, maxSize / img.width, maxSize / img.height);
      const w = Math.round(img.width * ratio);
      const h = Math.round(img.height * ratio);
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas);
    };
    img.onerror = reject;
  });
}

export function convertRGBAToOKLab(rgba) {
  const pixelCount = rgba.length / 4;
  const imageLab = new Float32Array(pixelCount * 3);
  for (let i = 0; i < pixelCount; i++) {
    const srcIdx = i * 4;
    const dstIdx = i * 3;
    const r = rgba[srcIdx] / 255;
    const g = rgba[srcIdx + 1] / 255;
    const b = rgba[srcIdx + 2] / 255;

    const lab = Color.convert([r, g, b], Color.sRGB, Color.OKLab);
    imageLab[dstIdx] = lab[0];
    imageLab[dstIdx + 1] = lab[1];
    imageLab[dstIdx + 2] = lab[2];
  }
  return imageLab;
}

export function softplus(x) {
  return Math.log(1 + Math.exp(x));
}

export function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}
