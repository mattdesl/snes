import canvasSketch from "canvas-sketch";
import imageUrl from "../monalisa.png";
import SNES from "../../index.js";
import { sigmoid, convertRGBAToOKLab, loadImage } from "../util.js";
import * as Color from "@texel/color";
import * as Random from "canvas-sketch-util/random.js";

const settings = {
  dimensions: [1024, 1024],
};

canvasSketch(async (props) => {
  const image = await loadImage(imageUrl);

  const targetDim = 16;
  const aspect = image.width / image.height;
  const tmpCanvas = document.createElement("canvas");
  const targetWidth = targetDim;
  const targetHeight = Math.floor(targetDim * aspect);
  tmpCanvas.width = targetDim;
  tmpCanvas.height = targetHeight;
  const tmpCtx = tmpCanvas.getContext("2d", {
    willReadFrequently: true,
  });
  tmpCtx.drawImage(image, 0, 0, tmpCanvas.width, tmpCanvas.height);

  const targetImage = tmpCtx.getImageData(
    0,
    0,
    tmpCanvas.width,
    tmpCanvas.height
  );
  const imageDataOKLab = convertRGBAToOKLab(targetImage.data);

  const numPoints = 32;
  const paramCount = 5; // x, y, l, a, b
  const solutionLength = numPoints * paramCount;
  const populationCount = 16;
  const alpha = 0.05; // learning rate
  const fps = 1000 / 60;
  const stepsPerFrame = 2;
  const maxEpoch = 5000;
  let epoch = 0;

  const radiusFactor = 1 / Math.sqrt(targetWidth);

  const optimizer = SNES({
    solutionLength,
    populationCount,
    alpha,
  });

  for (let i = 0; i < numPoints; i++) {
    for (let j = 0; j < paramCount; j++) {
      // optimizer.center[i * paramCount + j] = Random.gaussian();
    }
  }

  let interval = setInterval(() => {
    for (let i = 0; epoch < maxEpoch && i < stepsPerFrame; i++, epoch++) {
      step();
    }
    props.render();
    if (epoch >= maxEpoch) {
      clearInterval(interval);
    }
  }, fps);

  return ({ context, width, height }) => {
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#000";
    context.fillRect(0, 0, width, height);

    // context.drawImage(image, 0, 0, width, height);
    // tmpCtx.fillStyle = "black";
    // tmpCtx.fillRect(0, 0, targetWidth, targetHeight);
    // drawFeatures(
    //   tmpCtx,
    //   targetWidth,
    //   targetHeight,
    //   decodeSolution(optimizer.center)
    // );
    // context.drawImage(tmpCanvas, 0, 0, width, height);

    // const mask = renderMaskFromGaussians(
    //   decodeSolution(optimizer.center),
    //   targetWidth,
    //   targetHeight,
    //   0.1
    // );
    // const rgba = thresholdOKLabToRGBA(
    //   imageDataOKLab,
    //   mask,
    //   targetWidth,
    //   targetHeight
    // );
    // tmpCtx.putImageData(new ImageData(rgba, targetWidth, targetHeight), 0, 0);
    // context.drawImage(tmpCanvas, 0, 0, width, height);

    // const points = decodeSolution(optimizer.center).map((p) => p.position);
    drawFeatures(context, width, height, decodeSolution(optimizer.center));
    // const mask = createBitmask(points, targetWidth, targetHeight);
    // drawBitmask(context, width, height, mask);
  };

  function decodeSolution(solution) {
    const features = [];
    for (let i = 0; i < numPoints; i++) {
      const u = sigmoid(solution[i * paramCount]);
      const v = sigmoid(solution[i * paramCount + 1]);
      // const L = sigmoid(solution[i * paramCount + 2]);
      // const maxChroma = 0.4;
      // const a = Math.tanh(solution[i * paramCount + 3]) * maxChroma;
      // const b = Math.tanh(solution[i * paramCount + 4]) * maxChroma;

      const px = Color.clamp(
        Math.round(u * (targetWidth - 1)),
        0,
        targetWidth - 1
      );
      const py = Color.clamp(
        Math.round(v * (targetHeight - 1)),
        0,
        targetHeight - 1
      );
      const idx = (px + py * targetWidth) * 4;
      const R = targetImage.data[idx] / 255;
      const G = targetImage.data[idx + 1] / 255;
      const B = targetImage.data[idx + 2] / 255;
      const [L, a, b] = Color.convert([R, G, B], Color.sRGB, Color.OKLab);

      features.push({ position: [u, v], color: [L, a, b] });
    }
    return features;
  }

  function thresholdOKLabToRGBA(
    imageDataOKLab,
    mask,
    targetWidth,
    targetHeight
  ) {
    const rgba = new Uint8ClampedArray(targetWidth * targetHeight * 4);
    for (let i = 0; i < targetWidth * targetHeight; i++) {
      const idx4 = i * 4;
      const idx3 = i * 3;
      const L = imageDataOKLab[idx3];
      const M = mask[i];
      const value = L > M ? 1 : 0;
      rgba[idx4] = value * 255;
      rgba[idx4 + 1] = value * 255;
      rgba[idx4 + 2] = value * 255;
      rgba[idx4 + 3] = 255;
    }
    return rgba;
  }

  function drawFeatures(context, width, height, features) {
    for (let i = 0; i < features.length; i++) {
      const feature = features[i];
      const [u, v] = feature.position;
      const x = u * width;
      const y = v * height;

      const radius = ((1 / Math.sqrt(features.length)) * width) / 8;
      // const radius = Math.min(width, height) * 0.025;
      // const w = radius * 2;
      // const h = radius * 2;

      // const r =  * 0.02;
      // const grad = context.createRadialGradient(x, y, 0, x, y, radius);
      // grad.addColorStop(0, "white");
      // grad.addColorStop(1, "rgba(0,0,0,1.0)");
      // context.fillStyle = grad;
      // context.beginPath();
      // context.arc(x, y, radius, 0, 2 * Math.PI);
      // context.fill();

      const color = Color.serialize(feature.color, Color.OKLab, Color.sRGB);
      context.fillStyle = "white";
      // context.fillStyle = color;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();

      // context.fillStyle = color;
      // context.fillRect(x - w / 2, y - h / 2, w, h);
      // context.strokeStyle = "cyan";
      // context.strokeRect(x - w / 2, y - h / 2, w, h);
    }
  }

  function renderMaskFromGaussians(features, targetWidth, targetHeight, sigma) {
    const N = features.length;
    // 1. build an empty Float32Array
    const img = new Float32Array(targetWidth * targetHeight);

    // 2. for each Gaussian seed
    for (let i = 0; i < N; i++) {
      // decode normalized center
      const [u, v] = features[i].position;

      // for each pixel (px,py)
      for (let py = 0; py < targetHeight; py++) {
        const dy = py / (targetHeight - 1) - v;
        for (let px = 0; px < targetWidth; px++) {
          const dx = px / (targetWidth - 1) - u;
          const d2 = dx * dx + dy * dy;
          // Gaussian formula: exp(-d^2 / (2σ²))
          img[py * targetWidth + px] += Math.exp(-d2 / (2 * sigma * sigma));
        }
      }
    }

    // 3. normalize to [0,1]
    let maxVal = 0;
    for (let i = 0; i < img.length; i++) {
      if (img[i] > maxVal) maxVal = img[i];
    }
    if (maxVal > 0) {
      for (let i = 0; i < img.length; i++) {
        img[i] /= maxVal;
      }
    }

    return img;
    // 4. threshold at median (non-diff’erentiable)
    // const sorted = Float32Array.from(img).sort();
    // const T = sorted[Math.floor(sorted.length / 2)];

    // const mask = new Uint8ClampedArray(M * M);
    // for (let i = 0; i < img.length; i++) {
    //   mask[i] = img[i] > T ? 255 : 0;
    // }

    // return mask; // row-major 0/255 mask
  }

  function fitness(solution) {
    const features = decodeSolution(solution);
    const points = features.map((p) => [p.position[0], p.position[1]]);
    const spread = scoreSpread(points);

    // tmpCtx.fillStyle = "black";
    // tmpCtx.fillRect(0, 0, targetWidth, targetHeight);
    // drawFeatures(tmpCtx, targetWidth, targetHeight, features);
    // const imageData = tmpCtx.getImageData(0, 0, targetWidth, targetHeight);
    // const curOKLab = convertRGBAToOKLab(imageData.data);

    // let error = 0;
    // for (let i = 0; i < targetWidth * targetHeight; i++) {
    //   const srcIdx = i * 3;
    //   const L0 = curOKLab[srcIdx];
    //   const a0 = curOKLab[srcIdx + 1];
    //   const b0 = curOKLab[srcIdx + 2];

    //   const L1 = imageDataOKLab[srcIdx];
    //   const a1 = imageDataOKLab[srcIdx + 1];
    //   const b1 = imageDataOKLab[srcIdx + 2];

    //   const dL = L0 - L1;
    //   const da = a0 - a1;
    //   const db = b0 - b1;
    //   error += dL * dL + da * da + db * db;
    // }

    return spread;
  }

  function scoreSpread(pts, opts = {}) {
    const p = opts.p ?? 2;
    const epsilon = opts.epsilon ?? 1e-6;
    let energy = 0;
    const n = pts.length;

    // sum repulsion energy over all distinct pairs
    for (let i = 0; i < n; i++) {
      const pt = pts[i];
      const ui = pt[0];
      const vi = pt[1];
      for (let j = i + 1; j < n; j++) {
        const ptj = pts[j];
        const uj = ptj[0];
        const vj = ptj[1];
        const du = ui - uj;
        const dv = vi - vj;
        const d2 = du * du + dv * dv;
        // use (distance + epsilon)^p = (sqrt(d2)+epsilon)^p
        energy += 1 / Math.pow(Math.sqrt(d2) + epsilon, p);
      }
    }

    // map energy -> score in (0,1], the lower the energy the higher the score
    // you can adjust the divisor to tune sensitivity
    const score = 1 / (1 + energy);
    return score;
  }

  function step() {
    const fitnesses = new Float32Array(populationCount);
    const solutions = optimizer.ask();
    for (let i = 0; i < optimizer.populationCount; i++) {
      const solution = optimizer.getSolutionAt(solutions, i);
      fitnesses[i] = fitness(solution);
    }
    optimizer.tell(fitnesses);
  }
}, settings);

function setVec3(vec, x, y, z) {
  vec[0] = x;
  vec[1] = y;
  vec[2] = z;
  return vec;
}
