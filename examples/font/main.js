import canvasSketch from "canvas-sketch";
import Random from "canvas-sketch-util/random.js";
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
import MAES, { getDefaultPopulationCount } from "./maes.js";
import sNES from "../../index.js";
import {
  sigmoid,
  paramCount,
  channels,
  colorCount,
  paramDimensions,
  drawSolution,
  fitness,
} from "./util.js";

Random.setSeed("501272" || Random.getRandomSeed());
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

  const solutionLength = paramCount * paramDimensions + colorCount * channels;
  const populationCount = 16;
  const stepsPerEpoch = 10;
  let epoch = 0;
  const totalEpochs = 250;
  const alpha = 0.05 * 1;
  const isAsync = true;

  const workerCount = 8;
  if ((populationCount / workerCount) % 1 !== 0) {
    throw new Error(
      `populationCount (${populationCount}) is not divisible by workerCount (${workerCount})`
    );
  }

  const batchCount = populationCount / workerCount;
  console.log("Population:", populationCount);
  console.log("Workers:", workerCount);
  console.log("Batch Count:", batchCount);
  console.log("Solution:", solutionLength);

  // for optimization purposes
  const W = 128;
  const H = 128;

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

  const workerPool = Array(workerCount)
    .fill()
    .map(
      (_, i) =>
        new Worker(new URL("./worker.js", import.meta.url), {
          type: "module",
        })
    );

  const waitForMessageType = (worker, type) => {
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
  };

  for (let i = 0; i < workerPool.length; i++) {
    const worker = workerPool[i];
    worker.postMessage({
      type: "init",
      id: i,
      targetOKLab: imageLab,
      width: W,
      height: H,
      solutionLength,
      batchCount,
    });
    await waitForMessageType(worker, "ready");
  }

  const optimizer = sNES({
    mirrored: false,
    populationCount,
    solutionLength,
    alpha,
    random: Random.value,
  });

  const fitnesses = new Float32Array(optimizer.populationCount);
  const bestSolution = new Float32Array(solutionLength);
  let bestFitness = -Infinity;

  for (let i = 0; i < paramCount; i++) {
    optimizer.center[i * paramDimensions + 0] = Random.gaussian();
    optimizer.center[i * paramDimensions + 1] = Random.gaussian();
    optimizer.center[i * paramDimensions + 2] = Random.range(-1, 1);
  }

  let finished = false;
  console.time("opt");
  if (isAsync) requestAnimationFrame(updateLoop);

  async function updateLoop() {
    if (epoch < totalEpochs) {
      for (let i = 0; i < stepsPerEpoch; i++) {
        await send(optimizer);
      }
      requestAnimationFrame(updateLoop);
      epoch++;
    } else if (!finished) {
      finished = true;
      console.log("Done");
      console.timeEnd("opt");
    }
  }

  return {
    render,
    tick() {
      if (!isAsync) {
        if (epoch < totalEpochs) {
          iterate(optimizer, stepsPerEpoch);
          epoch++;
        } else if (!finished) {
          finished = true;
          console.log("Done");
          console.timeEnd("opt");
        }
      }
    },
  };

  async function send(optimizer) {
    // evolve the searcher by sending chunks to workers
    const solutions = optimizer.ask();
    const batchLength = batchCount * solutionLength;

    // first, we post each sub-solution to the workers
    for (let i = 0; i < workerPool.length; i++) {
      const worker = workerPool[i];
      const start = i * batchLength;
      const end = start + batchLength;
      // a batch of N solutions
      const batch = solutions.subarray(start, end);
      worker.postMessage({
        type: "ask",
        solutions: batch,
      });
    }

    // now we wait for all to be ready
    const fitnessChunks = (
      await Promise.all(
        workerPool.map((worker) => waitForMessageType(worker, "tell"))
      )
    ).sort(sortAscendingID);

    // now we un-chunk the fitnesses into the final array
    for (let i = 0; i < fitnessChunks.length; i++) {
      const { fitness, id } = fitnessChunks[i];
      const start = id * batchCount;
      fitnesses.set(fitness, start);
    }

    const ranks = optimizer.tell(fitnesses);
    matchBest(solutions, fitnesses, ranks);
  }

  function sortAscendingID(a, b) {
    return a.id - b.id;
  }

  function render({ exporting, context, width, height }) {
    context.fillStyle = "black";
    context.strokeStyle = "black";

    drawSolution(context, optimizer.center, width, height);
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
      fitnesses[i] = fitness(solution, tmpCanvas, tmpCtx, imageLab, W, H);
    }
    const ranks = optimizer.tell(fitnesses);
    matchBest(solutions, fitnesses, ranks);
  }

  function matchBest(solutions, fitnesses, ranks) {
    const f = fitnesses[ranks[0]];
    if (f > bestFitness) {
      const sub = optimizer.getSolutionAt(solutions, ranks[0]);
      bestSolution.set(sub);
      bestFitness = f;
      console.log(`Epoch: ${epoch}, Fitness: ${bestFitness}`);
    }
  }
}, settings);

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
