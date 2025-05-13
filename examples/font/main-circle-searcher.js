import canvasSketch from "canvas-sketch";
import Random from "canvas-sketch-util/random.js";
import SNES from "../../index.js";
import PSO from "./pso.js";
import {
  clamp,
  clamp01,
  lerp,
  mod,
  smoothstep,
} from "canvas-sketch-util/math.js";
import imageUrl from "./monalisa.png";
import * as Color from "@texel/color";
import Optim from "./optim.js";

Random.setSeed("12345" || Random.getRandomSeed());
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

  const paramCount = 64;
  const colorCount = paramCount;
  const paramDimensions = 3; // x,y,angle
  const channels = 3;
  // const colorStops = paramCount;
  const solutionLength = paramCount * paramDimensions + colorCount * channels;
  const populationCount = 8;
  const stepsPerEpoch = 10;
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

  const searchAlpha = 0.05;
  const refinementAlphaScale = 1;

  // The searcher tries to find new directions that lead to a good outcome
  // Once a good outcome is found, i.e. better than any other outcome at that epoch,
  // the refiner will begin on it

  const totalRefinements = 400;
  const searcherEpochs = 25;

  let refinementEpoch = 0;
  let bestSearcherScore = -Infinity;

  const reset = (optimizer) => {
    optimizer.center.fill(0);
    optimizer.sigma.fill(searchAlpha);
    for (let i = 0; i < paramCount; i++) {
      optimizer.center[i * paramDimensions + 0] = Random.range(-1, 1);
      optimizer.center[i * paramDimensions + 1] = Random.range(-1, 1);
      // optimizer.center[i * paramDimensions + 2] = Random.range(
      //   -Math.PI,
      //   Math.PI
      // );
    }
  };

  const searcher = Optim({
    populationCount: 8,
    subPopulationCount: 4,
    solutionLength,
    alpha: searchAlpha,
    random: Random.value,
    fitness,
    stepCount: 5,
    reset,
  });
  let refiner = null;

  // reset(searcher);

  // const setupRefiner = () => {
  //   if (!refiner) {
  //     refiner = SNES({
  //       solutionLength,
  //       populationCount,
  //     });
  //   }
  //   // copy over the params
  //   refiner.center.set(searcher.center);
  //   refiner.sigma.set(searcher.sigma);
  //   for (let i = 0; i < refiner.sigma.length; i++) {
  //     refiner.sigma[i] *= refinementAlphaScale;
  //   }
  // };

  // reset(searcher);

  return {
    render,
    tick() {
      searcher.tick();

      // if the searcher has reached its max, check its score
      // const curScore = fitness(searcher.center);
      // let doSwap = false;
      // if (refiner) {
      //   const refinerScore = fitness(refiner.center);
      //   if (curScore > refinerScore) {
      //     console.log("Better than initial refiner");
      //     setupRefiner();
      //   }
      // }
      // if (!refiner || epoch >= searcherEpochs || doSwap) {
      //   // we reached a better score, so copy it over
      //   if (curScore > bestSearcherScore) {
      //     console.log("Better search");
      //     setupRefiner();
      //     bestSearcherScore = curScore;
      //     refinementEpoch = 0;
      //   }
      //   epoch = 0;
      //   // reset the searcher now
      //   reset(searcher);
      // }
      // // step the searcher forward
      // iterate(searcher, stepsPerEpoch);
      // epoch++;
      // if (refiner && refinementEpoch < totalRefinements) {
      // iterate(searcher, stepsPerEpoch);
      // refinementEpoch++;
      // }
    },
  };

  function perturb(optimizer, scale = 1) {
    for (let i = 0; i < optimizer.sigma.length; i++) {
      optimizer.sigma[i] += Random.gaussian() * scale;
    }
  }

  function render({ exporting, context, width, height }) {
    context.fillStyle = "black";
    context.strokeStyle = "black";

    // drawSolution(context, searcher.center, width, height);
    const dim = Math.sqrt(searcher.children.length + 1);
    const cellWidth = width / dim;
    const cellHeight = height / dim;
    outer: for (let y = 0, idx = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++, idx++) {
        if (idx >= searcher.children.length) {
          context.save();
          context.translate(x * cellWidth, y * cellHeight);
          drawSolution(context, searcher.center, cellWidth, cellHeight);
          context.restore();
          break outer;
        } else {
          const child = searcher.children[idx];
          context.save();
          context.translate(x * cellWidth, y * cellHeight);
          drawSolution(context, child.optimizer.center, cellWidth, cellHeight);
          context.restore();
        }
      }
    }
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

  function drawSolution(context, solution, width, height) {
    tmpCanvas.width = width;
    tmpCanvas.height = height;

    tmpCtx.clearRect(0, 0, width, height);
    tmpCtx.fillStyle = "white";
    tmpCtx.fillRect(0, 0, width, height);

    const shapes = createShapes(solution, width, height);

    for (let shape of shapes) {
      const { t, scale, color, point } = shape;
      tmpCtx.beginPath();
      const radius = scale * Math.min(width, height);
      tmpCtx.arc(...point, radius, 0, Math.PI * 2);
      tmpCtx.fillStyle = color;
      tmpCtx.fill();
    }

    // context.filter = `blur(${width * 0.05}px)`;
    context.drawImage(tmpCanvas, 0, 0, width, height);
    // context.filter = "none";
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
      // const point = [width / 2, height / 2];
      shapes.push({
        scale: clamp(
          0.1 * softplus(params[i * paramDimensions + 2]),
          0.01,
          0.5
        ),
        t: paramCount <= 1 ? 1 : i / (paramCount - 1),
        point,
        color: hexes[i],
        srgb: rgbs[i],
        oklab: labs[i],
      });
    }
    return shapes;
  }

  function calculateOcclusion(frontCircle, rearCircle, W, H) {
    const dx = frontCircle.point[0] - rearCircle.point[0];
    const dy = frontCircle.point[1] - rearCircle.point[1];
    const distance = Math.sqrt(dx * dx + dy * dy);

    const r1 = frontCircle.scale * Math.min(W, H);
    const r2 = rearCircle.scale * Math.min(W, H);

    // If the distance between centers is less than the absolute difference of the radii, the front circle is occluding the rear
    if (distance <= Math.abs(r1 - r2)) {
      // The front circle fully occludes the rear circle
      return 1; // Fully occluded
    } else if (distance < r1 + r2) {
      // If there's an overlap but not full occlusion
      // Approximate the occlusion area as a ratio of overlap (could be a more sophisticated calculation here)
      const overlapArea = Math.PI * Math.min(r1, r2) ** 2;
      const rearArea = Math.PI * r2 ** 2;
      return overlapArea / rearArea; // Proportional overlap area as a fraction of the rear circle's area
    } else {
      return 0; // No occlusion
    }
  }

  function fitness(solution) {
    let error = 0;

    tmpCanvas.width = W;
    tmpCanvas.height = H;
    drawSolution(tmpCtx, solution, W, H);

    const { data } = tmpCtx.getImageData(0, 0, W, H);
    const tmp3 = [0, 0, 0];

    const shapes = createShapes(solution, W, H);

    // let overlapPenalty = 0;
    // let outOfBoundsPenalty = 0;

    // // Check for overlaps and out-of-bounds circles
    // for (let i = 0; i < shapes.length; i++) {
    //   const circleA = shapes[i];

    //   const radius = circleA.scale * Math.min(W, H);
    //   const diam = radius * 2;

    //   // Penalty for being out of bounds
    //   if (
    //     circleA.point[0] - radius < -radius ||
    //     circleA.point[0] + radius > W + radius ||
    //     circleA.point[1] - radius < -radius ||
    //     circleA.point[1] + radius > H + radius
    //   ) {
    //     outOfBoundsPenalty += 10; // Add a penalty for circles out of bounds
    //   }

    //   for (let j = i + 1; j < shapes.length; j++) {
    //     const circleB = shapes[i];
    //     // const radiusB = circleA.scale * Math.min(W, H);

    //     // Calculate occlusion between circles
    //     const occlusionRatio = calculateOcclusion(circleB, circleA);

    //     // Penalize more for occlusion
    //     if (occlusionRatio > 0) {
    //       occlusionPenalty += occlusionRatio * 500;
    //     }
    //   }
    // }

    // Now include these penalties in the overall fitness score
    // error += overlapPenalty + outOfBoundsPenalty;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = x + y * W;
        const rgbaIdx = idx * 4;
        const labIdx = idx * 3;
        tmp3[0] = data[rgbaIdx] / 0xff;
        tmp3[1] = data[rgbaIdx + 1] / 0xff;
        tmp3[2] = data[rgbaIdx + 2] / 0xff;

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
    }

    return -error;
  }

  function iterate(optimizer, steps) {
    // first we evolve the searcher by N steps
    for (let i = 0; i < steps; i++) {
      evolve(optimizer);
    }
  }

  function evolve(optimizer) {
    // evolve the searcher
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
