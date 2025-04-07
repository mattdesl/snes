import canvasSketch from "canvas-sketch";
import imageUrl from "./monalisa.png";
import SNES from "../../index.js";

const settings = {
  dimensions: [2048, 2048],
};

function loadImageData(src, maxSize) {
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
      resolve(ctx.getImageData(0, 0, w, h));
    };
    img.onerror = reject;
  });
}

canvasSketch(async (props) => {
  const image = await loadImageData(imageUrl, 128);

  const tmpCanvas = document.createElement("canvas");
  tmpCanvas.width = image.width;
  tmpCanvas.height = image.height;
  const tmpCtx = tmpCanvas.getContext("2d", {
    willReadFrequently: true,
  });
  tmpCtx.putImageData(image, 0, 0);

  const numRects = 200;
  const paramCount = 7;
  const solutionLength = numRects * paramCount;
  const populationCount = 32;
  const alpha = 0.05; // learning rate
  const fps = 1000 / 60;
  const stepsPerFrame = 2;
  const maxEpoch = 5000;
  let epoch = 0;

  // 1 = Rectangles move into place
  // 0 = Rectangles stay in origin
  const positionFactor = 0.0;

  const center = new Float32Array(solutionLength);
  const sigma = new Float32Array(solutionLength).fill(1);
  for (let i = 0; i < numRects; i++) {
    let idx = i * paramCount;
    center[idx++] = Math.random() * 2 - 1;
    center[idx++] = Math.random() * 2 - 1;
    idx = i * paramCount;
    sigma[idx++] = positionFactor;
    sigma[idx++] = positionFactor;
  }
  const optimizer = SNES({
    solutionLength,
    populationCount,
    alpha,
    sigma,
    center,
  });

  let interval = setInterval(() => {
    for (let i = 0; epoch < maxEpoch && i < stepsPerFrame; i++, epoch++) {
      step();
    }
    props.update();
    if (epoch >= maxEpoch) {
      clearInterval(interval);
    }
  }, fps);

  return ({ context, width, height }) => {
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);

    drawSolution(context, width, height, optimizer.center);
  };

  function sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
  }

  function softplus(x) {
    return Math.log(1 + Math.exp(x));
  }

  function drawSolution(context, width, height, solution) {
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    for (let i = 0; i < numRects; i++) {
      let idx = i * paramCount;

      const x = width / 2 + (solution[idx++] * width) / 2;
      const y = height / 2 + (solution[idx++] * height) / 2;

      const w = (softplus(solution[idx++]) * width) / 8;
      const h = (softplus(solution[idx++]) * height) / 8;

      const r = sigmoid(solution[idx++]);
      const g = sigmoid(solution[idx++]);
      const b = sigmoid(solution[idx++]);

      context.fillStyle = `rgb(${r * 255}, ${g * 255}, ${b * 255})`;
      context.fillRect(x - w / 2, y - h / 2, w, h);
    }
  }

  function fitness(solution) {
    const { width, height } = image;
    drawSolution(tmpCtx, width, height, solution);
    const { data } = tmpCtx.getImageData(0, 0, width, height);
    const targetData = image.data;
    let error = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const tr = targetData[i];
      const tg = targetData[i + 1];
      const tb = targetData[i + 2];

      const dr = r - tr;
      const dg = g - tg;
      const db = b - tb;

      error += dr * dr + dg * dg + db * db;
    }
    return -error;
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
