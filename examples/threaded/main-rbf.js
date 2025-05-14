import canvasSketch from "canvas-sketch";
import Random from "canvas-sketch-util/random.js";
import SNES from "../../index.js";
import { lerp } from "canvas-sketch-util/math.js";
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
  const K = 3; // palette size
  const stdev = 1 / M;
  const solutionLength = M * M * K + K * 3;
  const populationCount = 16;

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
      const steps = 5;
      for (let i = 0; i < steps; i++) {
        evolve();
      }
    },
  };

  function decodeSolution(solution) {
    const weights = solution.slice(0, M * M * K);
    const palette = solution.slice(M * M * K);
    return { palette, weights };
  }

  function createLabImage(solution, W, H, M, K) {
    const { weights, palette } = decodeSolution(solution);
    const out = new Float32Array(W * H * 3);
    const accum = new Float32Array(K);
    for (let y = 0; y < H; y++) {
      const yy = y / (H - 1);
      for (let x = 0; x < W; x++) {
        const xx = x / (W - 1);

        // accumulate un-normalized palette weights
        let totalG = 0;
        accum.fill(0);

        for (let i = 0, idx = 0; i < M; i++) {
          for (let j = 0; j < M; j++, idx++) {
            const cx = (i + 0.5) / M;
            const cy = (j + 0.5) / M;
            const dx = xx - cx,
              dy = yy - cy;
            const G = Math.exp(-(dx * dx + dy * dy) / (2 * stdev * stdev));
            totalG += G;
            for (let k = 0; k < K; k++) {
              accum[k] += weights[idx * K + k] * G;
            }
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

  function render({ context, width, height }) {
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
    drawSolution(context, optimizer.center, W, H, M, K, width, height);
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
