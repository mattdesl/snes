import canvasSketch from "canvas-sketch";
import Random from "canvas-sketch-util/random.js";
import SNES from "../../index.js";
import { lerp, smoothstep } from "canvas-sketch-util/math.js";
import imageUrl from "./monalisa.png";
import * as Color from "@texel/color";

Random.setSeed("" || Random.getRandomSeed());
console.log(`seed: ${Random.getSeed()}`);

const settings = {
  dimensions: [2048, 2048],
  suffix: Random.getSeed(),
  animate: true,
};

canvasSketch(async (props) => {
  const image = await loadImage(imageUrl, 128);

  const tmpCanvas = document.createElement("canvas");
  const tmpCtx = tmpCanvas.getContext("2d", {
    willReadFrequently: true,
  });

  const aspect = image.width / image.height;
  props.update({ dimensions: [props.width, Math.round(props.width / aspect)] });

  const { width, height } = props;
  const columns = 6;
  const rows = 6;
  const grid = new Float32Array(columns * rows);
  const dim = Math.min(width, height);
  const padding = 0.1 * dim;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const cellWidth = columns <= 1 ? innerWidth : innerWidth / (columns - 1);
  const cellHeight = rows <= 1 ? innerHeight : innerHeight / (rows - 1);
  const rad = Math.min(cellWidth, cellHeight) / 2;
  const lineWidth = 0.00175 * dim;

  const M = 8;
  const B = M * M;
  console.log("Points:", B);
  const K = 4; // palette size
  const stdev = 1 / M;
  const scale = 1;
  const solutionLength = M * M * K + K * 3;
  const populationCount = 16;
  const totalEpochs = 200;
  const stepsPerEpoch = 2;
  let epoch = 0;

  console.log("Solution:", solutionLength);

  // for optimization purposes
  const W = 32;
  const H = 32;

  tmpCanvas.width = W;
  tmpCanvas.height = H;
  tmpCtx.drawImage(image, 0, 0, W, H);
  const imageData = tmpCtx.getImageData(0, 0, W, H);

  const imageLab = new Float32Array(3 * W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = x + y * W;
      const srcIdx = idx * 4;
      const dstIdx = idx * 3;
      const r = imageData.data[srcIdx] / 255;
      const g = imageData.data[srcIdx + 1] / 255;
      const b = imageData.data[srcIdx + 2] / 255;

      const lab = Color.convert([r, g, b], Color.sRGB, Color.OKLab);
      imageLab[dstIdx] = lab[0];
      imageLab[dstIdx + 1] = lab[1];
      imageLab[dstIdx + 2] = lab[2];
    }
  }

  const optimizer = SNES({
    populationCount,
    solutionLength,
    // alpha: 0.005,
  });

  return {
    render,
    tick() {
      if (epoch < totalEpochs) {
        for (let i = 0; i < stepsPerEpoch; i++) {
          evolve();
        }
        epoch++;
      }
    },
  };

  function decodeSolution(solution) {
    let idx = 0;
    // const amplitudes = solution.subarray(idx, (idx += B));
    const weights = solution.subarray(idx, (idx += B * K));
    const palette = solution.subarray(idx, (idx += K * 3));
    return { weights, palette };
  }

  function getCenters(M, K) {
    const B = M * M; // same budget of blobs
    const φ = (1 + Math.sqrt(5)) / 2; // golden ratio
    const goldenAngle = 2 * Math.PI * (1 - 1 / φ);

    const centers = new Array(B);
    for (let k = 0; k < B; k++) {
      // radius √(k/B) gives uniform disk density
      const r = Math.sqrt((k + 0.5) / B);
      const θ = k * goldenAngle;
      // map from unit‑disk to unit square [0,1]^2 via simple radial → box:
      // here we place points in the *circle* inscribed in the square,
      // then shift+scale to [0,1]:
      const x = 0.5 + r * Math.cos(θ) * 0.5 * scale;
      const y = 0.5 + r * Math.sin(θ) * 0.5 * scale;
      centers[k] = [x, y];
    }
    return centers;
  }

  function drawBlobCircles(context, solution, W, H, M, K) {
    const { weights, palette } = decodeSolution(solution);
    const centers = getCenters(M, K);
    const colorLab = [0, 0, 0];
    for (let k = 0; k < centers.length; k++) {
      // compute this blob’s color by blending the K palette entries
      // weighted by weights[k*K + p]
      let L = 0,
        a = 0,
        b = 0;
      for (let p = 0; p < K; p++) {
        const w = weights[k * K + p];
        L += w * palette[p * 3];
        a += w * palette[p * 3 + 1];
        b += w * palette[p * 3 + 2];
      }
      colorLab[0] = L;
      colorLab[1] = a;
      colorLab[2] = b;

      // derive circle center and radius
      const [cxNorm, cyNorm] = centers[k];
      const cx = cxNorm * W;
      const cy = cyNorm * H;

      // interpret stdev as radius = stdev * max(W,H)
      const radius = stdev * Math.max(W, H) * 0.15;

      // draw
      context.beginPath();
      context.arc(cx, cy, radius, 0, 2 * Math.PI);
      context.closePath();
      context.fillStyle = Color.serialize(colorLab, Color.OKLab, Color.sRGB);
      context.fill();
    }
  }

  function createLabImage(solution, W, H, M, K) {
    const { weights, palette } = decodeSolution(solution);
    const centers = getCenters(M, K);
    const out = new Float32Array(W * H * 3);
    const accum = new Float32Array(K);
    for (let y = 0; y < H; y++) {
      const yy = y / (H - 1);
      for (let x = 0; x < W; x++) {
        const xx = x / (W - 1);

        // accumulate un-normalized palette weights
        let totalG = 0;
        accum.fill(0);

        for (let k = 0; k < centers.length; k++) {
          const [cx, cy] = centers[k];
          const sigma = stdev;
          const G = Math.exp(
            -((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * sigma * sigma)
          );
          totalG += G;
          for (let p = 0; p < K; p++) {
            accum[p] += weights[k * K + p] * G;
          }
        }

        // normalize and blend palette colors
        const invTotal = totalG != 0 ? 1 / totalG : 0;

        let L = 0,
          a = 0,
          b = 0;
        for (let k = 0; k < K; k++) {
          const w = accum[k] * invTotal;
          L += w * palette[k * 3];
          a += w * palette[k * 3 + 1];
          b += w * palette[k * 3 + 2];
        }

        const p = 3 * (y * W + x);
        out[p] = L;
        out[p + 1] = a;
        out[p + 2] = b;
      }
    }
    return out;
  }

  function render({ exporting, context, width, height }) {
    context.fillStyle = "white";
    context.fillRect(0, 0, width, height);

    context.fillStyle = "black";
    context.strokeStyle = "black";

    context.beginPath();
    drawGrid({
      context,
      width,
      height,
      rows,
      columns,
      padding,
    });
    context.lineWidth = lineWidth;
    context.stroke();

    // console.log(...unflattenPalette(decodeSolution(optimizer.center).palette));
    const RW = exporting ? W : W;
    const RH = exporting ? H : H;
    drawSolution(context, optimizer.center, RW, RH, M, K, width, height);
    drawBlobCircles(context, optimizer.center, width, height, M, K);
  }

  function unflattenPalette(palette) {
    const out = [];
    for (let i = 0; i < palette.length / 3; i++) {
      out.push([palette[i * 3 + 0], palette[i * 3 + 1], palette[i * 3 + 2]]);
    }
    return out;
  }

  function drawSolution(context, solution, W, H, M, K, width = W, height = H) {
    tmpCanvas.width = W;
    tmpCanvas.height = H;

    const image = createLabImage(solution, W, H, M, K);
    const rgba = new ImageData(labPixelsToRGBA(image, W, H), W, H);
    tmpCtx.putImageData(rgba, 0, 0);

    context.drawImage(tmpCanvas, 0, 0, width, height);
  }

  function fitness(solution) {
    const newDataLab = createLabImage(solution, W, H, M, K);

    let error = 0;
    for (let i = 0; i < newDataLab.length; i += 4) {
      const L0 = newDataLab[i];
      const A0 = newDataLab[i + 1];
      const B0 = newDataLab[i + 2];

      const L1 = imageLab[i];
      const A1 = imageLab[i + 1];
      const B1 = imageLab[i + 2];

      const dL = L1 - L0;
      const dA = A1 - A0;
      const dB = B1 - B0;
      error += dL * dL + dA * dA + dB * dB;
    }

    return -error;
  }

  function evolve() {
    const fitnesses = new Float32Array(populationCount);
    const solutions = optimizer.ask();
    for (let i = 0; i < optimizer.populationCount; i++) {
      const solution = optimizer.getSolutionAt(solutions, i);
      fitnesses[i] = fitness(solution);
    }
    optimizer.tell(fitnesses);
  }

  function drawGrid({ context, width, height, padding, columns, rows }) {
    const chunkSizeX = (width - padding * 2) / columns;
    const chunkSizeY = (height - padding * 2) / rows;

    for (let y = 1; y < rows; y++) {
      const px = padding;
      const py = padding + y * chunkSizeY;
      context.moveTo(px, py);
      context.lineTo(px + width - padding * 2, py);
    }
    for (let x = 1; x < columns; x++) {
      const px = padding + x * chunkSizeX;
      const py = padding;
      context.moveTo(px, py);
      context.lineTo(px, py + height - padding * 2);
    }
    context.moveTo(padding, padding);
    context.lineTo(width - padding, padding);
    context.lineTo(width - padding, height - padding);
    context.lineTo(padding, height - padding);
    context.closePath();
  }
}, settings);

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function loadImage(src, maxSize) {
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

function normalizeAlpha(k) {
  return k === 0 ? 1 / Math.SQRT2 : 1;
}

function labPixelsToRGBA(labPixels, W, H) {
  const out = new Uint8ClampedArray(4 * W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = x + y * W;
      const labIdx = idx * 3;
      const rgbaIdx = idx * 4;
      const L = labPixels[labIdx];
      const A = labPixels[labIdx + 1];
      const B = labPixels[labIdx + 2];

      const rgb = Color.convert([L, A, B], Color.OKLab, Color.sRGB);
      out[rgbaIdx] = 0xff * rgb[0];
      out[rgbaIdx + 1] = 0xff * rgb[1];
      out[rgbaIdx + 2] = 0xff * rgb[2];
      out[rgbaIdx + 3] = 0xff;
    }
  }
  return out;
}

function softplus(x) {
  return Math.log1p(Math.exp(x));
}
