import * as Color from "@texel/color";
import { clamp, mapRange } from "canvas-sketch-util/math.js";

export const paramCount = 128;
export const colorCount = paramCount;
export const paramDimensions = 6; // x,y,rad,shapeDetail
export const channels = 3;
export const solutionLength =
  paramCount * paramDimensions + colorCount * channels;
export const globalAlpha = 1;

// this choice may affect the optimizer, for example
// if you use magenta it will try to optimize away the BG gaps
// but if you use a color that may appear in the image, it may try to use it
export const backgroundColor = "cyan";

// we split the params into N scales
// each scale is progressively smaller, so later circles have smaller radii
// this helps a little establish finer details in the later parameters
export const numScales = 4;
export const paramsPerScale = Math.floor(paramCount / numScales);

// a linear scale
const globalScale = Array(numScales)
  .fill(0)
  // .map((_, i) => Math.pow(0.5, i));
  .map((_, i, lst) => 1 - i / lst.length); // linear

const tmp3 = [0, 0, 0];

export function decodeSolution(solution) {
  let idx = 0;
  const params = solution.slice(idx, idx + paramCount * paramDimensions);

  idx += paramCount * paramDimensions;

  const colors = [];
  for (let i = 0; i < colorCount; i++) {
    const color = solution.slice(idx, idx + channels);
    idx += channels;
    colors.push(color);
  }
  return {
    params,
    colors,
  };
}

export function clear(context, width, height) {
  context.clearRect(0, 0, width, height);
  context.fillStyle = backgroundColor;
  context.fillRect(0, 0, width, height);
}

export function drawSolution(
  context,
  solution,
  width,
  height,
  clearing = true
) {
  if (clearing) {
    clear(context, width, height);
  }

  const shapes = createShapes(solution, width, height);
  for (let shape of shapes) {
    const {
      scale,
      color,
      point,
      shapeAngle = 0,
      stretch,
      layer,
      sides = 4,
    } = shape;
    const radius = scale * Math.min(width, height);
    const sx = stretch[0];
    const sy = stretch[1];
    context.beginPath();
    for (let i = 0; i < sides; i++) {
      const angle = (i / sides) * Math.PI * 2 + Math.PI / 4;

      // local (unrotated) point on circle
      let xL = Math.cos(angle) * radius;
      let yL = Math.sin(angle) * radius;

      // 2) anisotropic (non-skew) scale in this local frame
      xL *= sx;
      yL *= sy;

      // 3) rotate by shapeAngle, then translate
      const x =
        point[0] + xL * Math.cos(shapeAngle) - yL * Math.sin(shapeAngle);
      const y =
        point[1] + xL * Math.sin(shapeAngle) + yL * Math.cos(shapeAngle);

      // const x = point[0] + Math.cos(angle) * radius;
      // const y = point[1] + Math.sin(angle) * radius;
      context.lineTo(x, y);
    }
    // context.arc(...point, radius, 0, Math.PI * 2);
    context.fillStyle = color;
    context.globalAlpha = globalAlpha;
    context.fill();
  }
  context.globalAlpha = 1;
}

export function createShapes(solution, width, height) {
  const { params, colors } = decodeSolution(solution);
  const labs = colors.map((raw) => {
    const L = sigmoid(raw[0]);
    const maxChroma = 0.4;
    const a = Color.clamp(Math.tanh(raw[1]) * maxChroma, -maxChroma, maxChroma);
    const b = Color.clamp(Math.tanh(raw[2]) * maxChroma, -maxChroma, maxChroma);
    return [L, a, b];
  });
  const rgbs = labs.map((lab) => {
    const srgb = Color.gamutMapOKLCH(
      Color.convert(lab, Color.OKLab, Color.OKLCH),
      Color.sRGBGamut,
      Color.sRGB,
      undefined,
      Color.MapToCuspL
    );
    return srgb;
  });

  const hexes = rgbs.map((c) => Color.serialize(c, Color.sRGB));
  const shapes = [];
  for (let i = 0; i < paramCount; i++) {
    const rMin = 0.01;
    const rMax = 0.25;

    // scaling method using tanh
    // let radiusScale = mapRange(
    //   Math.tanh(params[i * paramDimensions + 2]),
    //   -1,
    //   1,
    //   rMin,
    //   rMax
    // );

    // alternative using softplus
    const rMid = (rMin + rMax) / 2;
    let radiusScale = rMid * softplus(params[i * paramDimensions + 2]);

    const layer = Math.floor(i / paramsPerScale);
    radiusScale *= globalScale[layer];

    // clamp to bounds
    radiusScale = clamp(radiusScale, rMin, rMax);

    const point = [
      // if we just want to let the parameters freely decide their position
      // width / 2 + (params[i * paramDimensions + 0] * width) / 2,
      // height / 2 + (params[i * paramDimensions + 1] * height) / 2,

      // alternatively, if we want to ensure points are strictly inside the canvas
      width / 2 + Math.tanh(params[i * paramDimensions + 0]) * (width / 2),
      height / 2 + Math.tanh(params[i * paramDimensions + 1]) * (height / 2),

      // yet another alternative to tanh
      // sigmoid(params[i * paramDimensions + 0]) * width,
      // sigmoid(params[i * paramDimensions + 1]) * height,
    ];
    const shapeAngle = Math.tanh(params[i * paramDimensions + 3]) * Math.PI;
    shapes.push({
      layer,
      shapeAngle,
      stretch: [
        1, //Math.tanh(params[i * paramDimensions + 4]) * 0.5 + 0.5,
        1, //Math.tanh(params[i * paramDimensions + 5]) * 0.5 + 0.5,
      ],
      scale: radiusScale,
      point,
      color: hexes[i],
      srgb: rgbs[i],
      oklab: labs[i],
    });
  }
  return shapes;
}

export function fitness(solution, tmpCanvas, tmpCtx, imageLab, W, H) {
  tmpCanvas.width = W;
  tmpCanvas.height = H;
  drawSolution(tmpCtx, solution, W, H);

  const { data } = tmpCtx.getImageData(0, 0, W, H);

  return fitnessFromImageData(data, imageLab);
}

export function fitnessFromImageData(rgbaData, imageLab) {
  let error = 0;

  const pixelCount = rgbaData.length / 4;
  for (let i = 0; i < pixelCount; i++) {
    const rgbaIdx = i * 4;
    const labIdx = i * 3;
    tmp3[0] = rgbaData[rgbaIdx] / 0xff;
    tmp3[1] = rgbaData[rgbaIdx + 1] / 0xff;
    tmp3[2] = rgbaData[rgbaIdx + 2] / 0xff;
    Color.convert(tmp3, Color.sRGB, Color.OKLab, tmp3);

    const L0 = tmp3[0];
    const A0 = tmp3[1];
    const B0 = tmp3[2];

    const L1 = imageLab[labIdx];
    const A1 = imageLab[labIdx + 1];
    const B1 = imageLab[labIdx + 2];

    const dL = L1 - L0;
    const dA = A1 - A0;
    const dB = B1 - B0;
    error += dL * dL + dA * dA + dB * dB;
  }

  return -error;
}

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

export function waitForMessageType(worker, type) {
  return new Promise((resolve) => {
    const handler = (ev) => {
      const { data } = ev;
      if (data.type == type) {
        worker.removeEventListener("message", handler);
        resolve(ev.data);
      }
    };
    worker.addEventListener("message", handler);
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
