import canvasSketch from "canvas-sketch";
import Random from "canvas-sketch-util/random.js";
import SNES from "../../index.js";
import {
  clamp,
  clamp01,
  lerp,
  mod,
  smoothstep,
} from "canvas-sketch-util/math.js";
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

  const paramCount = 8;
  const colorCount = paramCount;
  const paramDimensions = 3; // x,y,angle
  const channels = 3;
  // const colorStops = paramCount;
  const solutionLength = paramCount * paramDimensions + colorCount * channels;
  const populationCount = 16;
  const totalEpochs = 400;
  const stepsPerEpoch = 2;
  let epoch = 0;

  // t = where the split happens
  // cA = color on first side
  // cB = color on second side

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

  const alpha = 0.025;

  const optimizer = SNES({
    populationCount,
    solutionLength,
    alpha,
  });

  for (let i = 0; i < paramCount; i++) {
    optimizer.center[i * paramDimensions + 0] = Random.range(-1, 1);
    optimizer.center[i * paramDimensions + 1] = Random.range(-1, 1);
    optimizer.center[i * paramDimensions + 2] = Random.range(-Math.PI, Math.PI);
    // optimizer.sigma[i * paramDimensions + 2] *= 1000;
  }

  // const boolRands = Array(128)
  //   .fill()
  //   .map(() => Random.boolean());
  // const boolRands2 = Array(128)
  //   .fill()
  //   .map(() => Random.boolean());

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

  function render({ exporting, context, width, height }) {
    context.fillStyle = "black";
    context.strokeStyle = "black";

    drawSolution(context, optimizer.center, W, H, width, height);
  }

  function decodeSolution(solution) {
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

  function drawSolution(context, solution, W, H, width, height) {
    // tmpCanvas.width = W;
    // tmpCanvas.height = H;

    // const [cx, cy] = params;
    // context.beginPath();
    // const rad = width * 0.15;
    // context.arc(
    //   width / 2 + (cx * width) / 2,
    //   height / 2 + (cy * height) / 2,
    //   rad,
    //   0,
    //   Math.PI * 2
    // );
    // context.fillStyle = hexes[0];
    // context.fill();

    // context.clearRect(0, 0, width, height);
    // context.fillStyle = "white";
    // context.fillRect(0, 0, width, height);

    tmpCanvas.width = W;
    tmpCanvas.height = H;

    const image = createLabImage(solution, W, H);
    const rgba = new ImageData(labPixelsToRGBA(image, W, H), W, H);
    tmpCtx.putImageData(rgba, 0, 0);

    context.drawImage(tmpCanvas, 0, 0, width, height);
  }

  function createShapes(solution, width, height) {
    const { params, colors } = decodeSolution(solution);
    const labs = colors.map((raw) => {
      const L = sigmoid(raw[0]);
      const maxChroma = 0.4;
      // const a = maxChroma * (sigmoid(raw[1]) * 2 - 1);
      // const b = maxChroma * (sigmoid(raw[2]) * 2 - 1);
      const a = Color.clamp(raw[1], -maxChroma, maxChroma);
      const b = Color.clamp(raw[2], -maxChroma, maxChroma);
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
      const point = [
        width / 2 + (params[i * paramDimensions + 0] * width) / 2,
        height / 2 + (params[i * paramDimensions + 1] * height) / 2,
      ];
      const lineAngle = params[i * paramDimensions + 2];
      const vecs = getLineSegment(point, lineAngle, width, height);
      shapes.push({
        point,
        angle: lineAngle,
        line: vecs,
        color: hexes[i],
        srgb: rgbs[i],
        oklab: labs[i],
      });
    }
    return shapes;
  }

  function createLabImage(solution, W, H) {
    const out = new Float32Array(W * H * 3);

    const shapes = createShapes(solution, W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let L = 0,
          a = 0,
          b = 0;
        let weightSum = 0;
        for (let shape of shapes) {
          const { point, angle, oklab } = shape;
          // const [ start, end ] = line;
          const pixelPoint = [x, y];
          const dist = pointDistanceToLine(pixelPoint, point, angle);

          // Gaussian weight based on distance
          // const weight = Math.exp((-0.5 * (dist * dist)) / (sigma * sigma));
          const maxDist = Math.hypot(W, H) / 2;

          let weight = 1 - clamp01(dist / maxDist);

          // Accumulate the weighted contribution of the line’s color
          L += oklab[0] * weight;
          a += oklab[1] * weight;
          b += oklab[2] * weight;

          // Accumulate the total weight for normalization
          weightSum += weight;
        }

        // Normalize the color by the sum of the weights to ensure we get a valid color
        if (weightSum > 0) {
          L /= weightSum;
          a /= weightSum;
          b /= weightSum;
        }
        const idx = x + y * W;
        out[idx * 3 + 0] = L;
        out[idx * 3 + 1] = a;
        out[idx * 3 + 2] = b;
      }
    }
    return out;
  }

  function fitness(solution) {
    let error = 0;

    const newDataLab = createLabImage(solution, W, H);
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

    // tmpCanvas.width = W;
    // tmpCanvas.height = H;
    // drawSolution(tmpCtx, solution, W, H);

    // const { data } = tmpCtx.getImageData(0, 0, W, H);
    // const tmp3 = [0, 0, 0];

    // for (let y = 0; y < H; y++) {
    //   for (let x = 0; x < W; x++) {
    //     const idx = x + y * W;
    //     const rgbaIdx = idx * 4;
    //     const labIdx = idx * 3;
    //     tmp3[0] = data[rgbaIdx] / 0xff;
    //     tmp3[1] = data[rgbaIdx + 1] / 0xff;
    //     tmp3[2] = data[rgbaIdx + 2] / 0xff;

    //     Color.convert(tmp3, Color.sRGB, Color.OKLab, tmp3);

    //     const L0 = tmp3[0];
    //     const A0 = tmp3[1];
    //     const B0 = tmp3[2];

    //     const L1 = imageLab[labIdx];
    //     const A1 = imageLab[labIdx + 1];
    //     const B1 = imageLab[labIdx + 2];

    //     const dL = L1 - L0;
    //     const dA = A1 - A0;
    //     const dB = B1 - B0;
    //     error += dL * dL + dA * dA + dB * dB;
    //   }
    // }

    // return -error;
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

function samplePaletteCircular(T, palette, K) {
  // Map T into [0,K), find two neighboring indices
  const tK = mod(T * K, K); // ensure wrap-around
  const i0 = Math.floor(tK);
  const i1 = mod(i0 + 1, K);
  const frac = tK - i0;

  const o0 = i0;
  const o1 = i1;
  // endpoint Lab
  const L0 = palette[o0][0],
    a0 = palette[o0][1],
    b0 = palette[o0][2];
  const L1 = palette[o1][0],
    a1 = palette[o1][1],
    b1 = palette[o1][2];
  // lerp
  const L = L0 * (1 - frac) + L1 * frac;
  const a = a0 * (1 - frac) + a1 * frac;
  const b = b0 * (1 - frac) + b1 * frac;

  return [L, a, b];
}

function splitBounds(bounds, fract = 0.5, horizontal = true, inverse = false) {
  const [min, max] = bounds;
  const [x1, y1] = min;
  const [x2, y2] = max;
  const width = x2 - x1;
  const height = y2 - y1;

  fract = Math.max(0, Math.min(1, fract));
  fract = inverse ? 1 - fract : fract;

  const dim = horizontal ? width : height;
  const off = dim * fract;

  let a, b;
  if (horizontal) {
    a = [
      [x1, y1],
      [x1 + off, y2],
    ];
    b = [
      [x1 + off, y1],
      [x2, y2],
    ];
  } else {
    a = [
      [x1, y1],
      [x2, y1 + off],
    ];
    b = [
      [x1, y1 + off],
      [x2, y2],
    ];
  }
  return [a, b];
}

function pointDistanceToLine(
  [pointX, pointY],
  [lineX, lineY],
  lineAngleThetaRad
) {
  // Calculate the perpendicular distance from the point to the line
  const dx = pointX - lineX; // Difference in x-coordinates
  const dy = pointY - lineY; // Difference in y-coordinates

  // The formula for the perpendicular distance from the point to the line
  const distance = Math.abs(
    dx * Math.cos(lineAngleThetaRad) + dy * Math.sin(lineAngleThetaRad)
  );
  return distance;
}

function getLineSegment(linePoint, lineAngle, width, height, threshold = 4) {
  const scale = Math.hypot(width, height) * threshold;
  return [-1, 1].map((dir) => {
    return [
      linePoint[0] + Math.cos(lineAngle) * scale * dir,
      linePoint[1] + Math.sin(lineAngle) * scale * dir,
    ];
  });
}
