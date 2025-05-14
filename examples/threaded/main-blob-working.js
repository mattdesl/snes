import canvasSketch from "canvas-sketch";
import Random from "canvas-sketch-util/random.js";
import SNES from "../../index.js";
import { lerp, mod, smoothstep } from "canvas-sketch-util/math.js";
import imageUrl from "./monalisa.png";
import * as Color from "@texel/color";

Random.setSeed("453357" || Random.getRandomSeed());
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

  const pointCount = 5 ** 2;
  const B = pointCount;

  const useHypercube = false;
  // palette hypercube dimensions
  const hypercubeDimensions = 2;
  const paletteCount = useHypercube ? Math.pow(2, hypercubeDimensions) : 4;
  console.log("Palette:", paletteCount);

  const K = paletteCount;

  const sampleDimensions = useHypercube ? hypercubeDimensions : paletteCount;

  const stdev = 1 / Math.sqrt(pointCount);
  // const scale = 1;
  const solutionLength = pointCount * sampleDimensions * 2 + 3 * paletteCount;
  const populationCount = 16;
  const totalEpochs = 400;
  const stepsPerEpoch = 2;
  let epoch = 0;

  console.log("Points:", B);
  console.log("Solution:", solutionLength);

  // for optimization purposes
  const W = 64;
  const H = 64;

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

  function sampleHypercube(U, palette) {
    const D = U.length;
    const N = 1 << D; // 2^D corners
    const result = [0, 0, 0]; // accumulator for L, a, b

    // Loop over every corner of the D‑cube
    for (let corner = 0; corner < N; corner++) {
      // Compute the weight for this corner as product over dims:
      // if bit d of `corner` is 1, use U[d], else use (1-U[d]).
      let w = 1;
      for (let d = 0; d < D; d++) {
        const bit = (corner >> d) & 1;
        w *= bit ? U[d] : 1 - U[d];
      }
      if (w === 0) continue; // skip zero‑weight corners for speed

      // Fetch the Lab triplet at this corner
      const base = 3 * corner;
      result[0] += palette[base] * w; // L
      result[1] += palette[base + 1] * w; // a
      result[2] += palette[base + 2] * w; // b
    }

    return result;
  }

  // function samplePaletteCircular(T, palette, K) {
  //   // Map T into [0,K), find two neighboring indices
  //   const tK = mod(T * K, K); // ensure wrap-around
  //   const i0 = Math.floor(tK);
  //   const i1 = mod(i0 + 1, K);
  //   const frac = tK - i0;

  //   const o0 = 3 * i0;
  //   const o1 = 3 * i1;
  //   // endpoint Lab
  //   const L0 = palette[o0],
  //     a0 = palette[o0 + 1],
  //     b0 = palette[o0 + 2];
  //   const L1 = palette[o1],
  //     a1 = palette[o1 + 1],
  //     b1 = palette[o1 + 2];
  //   // lerp
  //   const L = L0 * (1 - frac) + L1 * frac;
  //   const a = a0 * (1 - frac) + a1 * frac;
  //   const b = b0 * (1 - frac) + b1 * frac;

  //   return [L, a, b];
  // }

  function decodeSolution(solution, pointCount) {
    let idx = 0;
    // const seed = 0;
    // idx++;

    const params = solution.slice(idx, (idx += pointCount * sampleDimensions));
    const palette = solution.slice(idx, (idx += 3 * paletteCount));

    // for (let i = 0; i < K; i++) {
    //   const o = i * 3;
    //   const L = palette[o];
    //   const a = palette[o + 1];
    //   const b = palette[o + 2];
    //   // normalize
    //   const maxChroma = 0.4;
    //   palette[o] = sigmoid(L);
    //   palette[o + 1] = maxChroma * (sigmoid(a) * 2 - 1);
    //   palette[o + 2] = maxChroma * (sigmoid(b) * 2 - 1);
    // }

    return { seed: 0, params, palette };
  }

  // van der Corput in base `b`
  function vdc(n, b) {
    let v = 0,
      denom = 1;
    while (n > 0) {
      denom *= b;
      v += (n % b) / denom;
      n = Math.floor(n / b);
    }
    return v;
  }

  // Halton in 2D with seed
  function halton2DSeeded(N, seed = 0) {
    const pts = [];
    for (let i = 0; i < N; i++) {
      const idx = i + seed; // <-- shift by seed
      pts.push([vdc(idx + 1, 2), vdc(idx + 1, 3)]);
    }
    return pts;
  }

  function getCenters(pointCount) {
    // return halton2DSeeded(pointCount, seed);
    const φ = (1 + Math.sqrt(5)) / 2; // golden ratio
    const goldenAngle = 2 * Math.PI * (1 - 1 / φ);
    const centers = new Array(pointCount);
    const sqrDim = Math.floor(Math.sqrt(pointCount));
    for (let k = 0; k < pointCount; k++) {
      const isGrid = true;
      if (isGrid) {
        const x = k % sqrDim;
        const y = Math.floor(k / sqrDim);
        const u = (x + 0.5) / sqrDim; //+ (1 / sqrDim / 2) * off;
        const v = (y + 0.5) / sqrDim;
        const pad = 0; //1 / sqrDim / 4;
        const cx = lerp(pad, 1 - pad, u);
        const cy = lerp(pad, 1 - pad, v);
        centers[k] = [cx, cy];
      } else {
        // radius √(k/B) gives uniform disk density
        const r = Math.sqrt((k + 0.5) / B);
        const scale = 1;
        const θ = k * goldenAngle;
        // map from unit‑disk to unit square [0,1]^2 via simple radial → box:
        // here we place points in the *circle* inscribed in the square,
        // then shift+scale to [0,1]:
        const x = 0.5 + r * Math.cos(θ) * 0.5 * scale;
        const y = 0.5 + r * Math.sin(θ) * 0.5 * scale;
        centers[k] = [x, y];
      }
    }
    return centers;
  }

  function drawBlobCircles(context, solution, W, H, pointCount, paletteCount) {
    const { seed, params, palette } = decodeSolution(solution, pointCount);
    const centers = getCenters(pointCount);

    const colors = computeBlobColors(params, palette, pointCount, paletteCount);

    for (let k = 0; k < centers.length; k++) {
      // derive circle center and radius
      const [cxNorm, cyNorm] = centers[k];
      const cx = cxNorm * W;
      const cy = cyNorm * H;

      // interpret stdev as radius = stdev * max(W,H)
      const baseRadius = stdev * Math.max(W, H);

      const colorLab = [colors.L[k], colors.A[k], colors.B[k]];
      const srgb = Color.gamutMapOKLCH(
        Color.convert(colorLab, Color.OKLab, Color.OKLCH),
        Color.sRGBGamut,
        Color.sRGB,
        undefined,
        Color.MapToCuspL
      );
      context.fillStyle = Color.serialize(srgb, Color.sRGB);

      const splatter = false;
      const samplesPerBlob = 1;
      if (splatter) {
        // draw multiple random points
        for (let i = 0; i < samplesPerBlob; i++) {
          const baseRadius = stdev * Math.max(W, H);
          // sample Gaussian offsets via Box‑Muller
          // const u1 = Math.random();
          // const u2 = Math.random();
          // const mag = baseRadius * Math.sqrt(-2 * Math.log(u1));
          // const theta = 2 * Math.PI * u2;
          // const dx = mag * Math.cos(theta);
          // const dy = mag * Math.sin(theta);

          const theta = Random.noise3D(
            i * 0.1,
            cxNorm * 1,
            cyNorm * 1,
            1,
            baseRadius
          );
          const dx = Math.cos(theta) * baseRadius;
          const dy = Math.sin(theta) * baseRadius;

          const dotRadius = Math.min(W, H) * 0.01 * 1;
          context.beginPath();
          context.arc(cx + dx, cy + dy, dotRadius, 0, 2 * Math.PI);
          context.closePath();
          context.fill();
        }
      } else {
        // draw
        context.beginPath();
        context.arc(cx, cy, baseRadius * 0.15, 0, 2 * Math.PI);
        context.closePath();

        context.fill();
      }
    }
  }

  function computeBlobColors(params, palette, pointCount) {
    // returns two arrays of length pointCount: Ls, as, bs
    const Ls = new Float32Array(pointCount);
    const as_ = new Float32Array(pointCount);
    const bs = new Float32Array(pointCount);

    for (let k = 0; k < pointCount; k++) {
      let L = 0,
        a = 0,
        b = 0;

      const curParams = params.slice(
        k * sampleDimensions,
        (k + 1) * sampleDimensions
      );
      if (useHypercube) {
        [L, a, b] = sampleHypercube(
          curParams.map((x) => sigmoid(x)),
          palette
        );
      } else {
        // const weight = inferSimplexWeights(curParams);
        const weight = [...curParams].map((c) => Math.tanh(c));
        // simple weight of all colors
        for (let i = 0; i < paletteCount; i++) {
          const o = i * 3;
          const L0 = palette[o];
          const a0 = palette[o + 1];
          const b0 = palette[o + 2];
          const w = weight[i];
          L += w * L0;
          a += w * a0;
          b += w * b0;
        }
      }
      Ls[k] = L;
      as_[k] = a;
      bs[k] = b;
    }
    return { L: Ls, A: as_, B: bs };
  }

  function inferSimplexWeights(rawWeights) {
    // const rawAll = [...rawWeights].concat(0); // append a 0
    // const exps = rawAll.map((x) => Math.exp(x));
    // const sumExp = exps.reduce((s, v) => s + v, 0);
    // return exps;

    // 1) turn rawWeights into positive values
    //    (you can use Math.max(0, x), x*x, softplus, exp, etc.
    //     here we'll use softplus so that zeros stay small but >0)
    const pos = [...rawWeights].map((x) => Math.log1p(Math.exp(x))); // softplus

    // 2) add one more “raw” for the last corner
    pos.push(1.0);

    // 3) normalize so they sum to 1
    const sum = pos.reduce((s, v) => s + v, 0);
    return pos.map((v) => v / sum);
  }

  function createLabImage(solution, W, H, pointCount, paletteCount) {
    const { params, palette } = decodeSolution(
      solution,
      pointCount,
      paletteCount
    );
    const centers = getCenters(pointCount);
    const out = new Float32Array(W * H * 3);
    const accumG = new Float32Array(pointCount);
    const colors = computeBlobColors(params, palette, pointCount, paletteCount);

    for (let y = 0; y < H; y++) {
      const yy = y / (H - 1);
      for (let x = 0; x < W; x++) {
        const xx = x / (W - 1);

        // accumulate Gaussian weights per blob
        let totalG = 0;
        accumG.fill(0);
        for (let k = 0; k < centers.length; k++) {
          const [cx, cy] = centers[k];
          const G = Math.exp(
            -((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * stdev * stdev)
          );
          accumG[k] = G;
          totalG += G;
        }

        // blend each blob's single color, weighted by its Gaussian
        let l = 0,
          a = 0,
          b = 0;
        if (totalG > 0) {
          const invTG = 1 / totalG;
          for (let k = 0; k < centers.length; k++) {
            const weight = accumG[k] * invTG;
            l += weight * colors.L[k];
            a += weight * colors.A[k];
            b += weight * colors.B[k];
          }
        }

        const p = 3 * (y * W + x);
        out[p] = l;
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
    drawSolution(
      context,
      optimizer.center,
      RW,
      RH,
      pointCount,
      paletteCount,
      width,
      height
    );
    // drawBlobCircles(
    //   context,
    //   optimizer.center,
    //   width,
    //   height,
    //   pointCount,
    //   paletteCount
    // );
  }

  function unflattenPalette(palette) {
    const out = [];
    for (let i = 0; i < palette.length / 3; i++) {
      out.push([palette[i * 3 + 0], palette[i * 3 + 1], palette[i * 3 + 2]]);
    }
    return out;
  }

  function drawSolution(context, solution, W, H, B, K, width = W, height = H) {
    tmpCanvas.width = W;
    tmpCanvas.height = H;

    const image = createLabImage(solution, W, H, B, K);
    const rgba = new ImageData(labPixelsToRGBA(image, W, H), W, H);
    tmpCtx.putImageData(rgba, 0, 0);

    context.drawImage(tmpCanvas, 0, 0, width, height);
  }

  function fitness(solution) {
    const newDataLab = createLabImage(solution, W, H, B, K);

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
