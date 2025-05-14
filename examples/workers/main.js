import canvasSketch from "canvas-sketch";
import Random from "canvas-sketch-util/random.js";
import imageUrl from "../monalisa.png";
import * as Color from "@texel/color";
import sNES from "../../index.js";
import {
  paramCount,
  solutionLength,
  paramDimensions,
  drawSolution,
  fitness,
  waitForMessageType,
  loadImage,
  convertRGBAToOKLab,
  backgroundColor,
} from "./util.js";
import { lerp } from "canvas-sketch-util/math.js";

Random.setSeed("" || Random.getRandomSeed());
console.log(`seed: ${Random.getSeed()}`);

const SHOULD_USE_WORKERS = true;
const CAN_USE_WORKERS = typeof window.OffscreenCanvas != "undefined";
const useWorkers = SHOULD_USE_WORKERS && CAN_USE_WORKERS;

const settings = {
  dimensions: [2048, 2048],
  suffix: Random.getSeed(),
};

canvasSketch(async (props) => {
  const image = await loadImage(imageUrl);
  const aspect = image.width / image.height;

  // rescale the canvas to the image aspect
  props.update({ dimensions: [props.width, Math.round(props.width / aspect)] });

  const tmpCanvas = document.createElement("canvas");
  const tmpCtx = tmpCanvas.getContext("2d", {
    willReadFrequently: true,
  });

  const populationCount = 24; // number of individuals
  const workerCount = 8; // number of threads
  const stepsPerEpoch = 10; // steps per 'evolution' tick
  const totalEpochs = 400;
  const alpha = 0.05; // learning rate
  const mirrored = true; // whether optimizer is antithetic
  const renderScale = 0.6; // scale at which to draw on canvas
  const showBest = false; // whether to show the best, or the mean
  const scaleWidths = [64];

  // note: if globalAlpha is lower than 1 you'll probably
  // want to match this to the background color used during optimization
  const renderBackground = "tan";

  const scales = scaleWidths.map((width) => {
    const height = Math.floor(width / aspect);
    tmpCanvas.width = width;
    tmpCanvas.height = height;
    tmpCtx.drawImage(image, 0, 0, width, height);
    const imageData = tmpCtx.getImageData(0, 0, width, height);
    const imageLab = convertRGBAToOKLab(imageData.data);
    return {
      data: imageLab,
      width,
      height,
    };
  });

  let epoch = 0;
  let scaleIndex = 0;

  console.log(
    "Scales:",
    scales.map((s) => s.width)
  );
  console.log("Population Count:", populationCount);
  console.log("Solution Length:", solutionLength);

  const batchCount = populationCount / workerCount; // for workers only
  let workerPool;
  if (useWorkers) workerPool = await initWorkers();

  const optimizer = sNES({
    mirrored,
    populationCount,
    solutionLength,
    alpha,
    random: Random.value,
  });

  const fitnesses = new Float32Array(optimizer.populationCount);
  const bestSolution = new Float32Array(solutionLength);
  let bestFitness = -Infinity;

  // Optionally we can bias the initial mean such as evenly spreading out
  // the positions across the canvas
  for (let i = 0; i < paramCount; i++) {
    // optimizer.center[i * paramDimensions + 0] = Random.gaussian(); // x, y
    // optimizer.center[i * paramDimensions + 1] = Random.gaussian();
    // optimizer.center[i * paramDimensions + 2] = Random.gaussian(); // radius
    // optimizer.center[i * paramDimensions + 3] = Random.gaussian(); // scale
    // optimizer.center[i * paramDimensions + 4] = Random.pick([
    //   -1, -0.5, 0, 0.5, 1,
    // ]); // stretchX
    // optimizer.center[i * paramDimensions + 5] = Random.pick([
    //   -1, -0.5, 0, 0.5, 1,
    // ]); // stretchY
    // optimizer.sigma[i * paramDimensions + 4] = 0;
    // optimizer.sigma[i * paramDimensions + 5] = 0;
  }

  let finished = false;
  console.time("opt");

  requestAnimationFrame(updateLoop);

  return {
    render({ exporting, context, width, height }) {
      context.clearRect(0, 0, width, height);
      context.fillStyle = renderBackground;
      context.fillRect(0, 0, width, height);
      context.save();
      context.translate(width / 2, height / 2);
      context.scale(renderScale, renderScale);
      context.translate(-width / 2, -height / 2);
      context.beginPath();
      context.rect(0, 0, width, height);
      // context.clip(); // if you want
      drawSolution(
        context,
        showBest ? bestSolution : optimizer.center,
        width,
        height,
        false
      );
      context.restore();

      if (!exporting) {
        // debug info
        context.fillStyle = "black";
        const fontSize = width * 0.025;
        context.font = `${fontSize}px monospace`;
        context.textAlign = "left";
        context.textBaseline = "top";
        context.fillText(
          `Epoch: ${epoch} / Best Fitness: ${bestFitness.toFixed(2)} / Scale: ${
            scales[scaleIndex].width
          }px`,
          fontSize,
          fontSize
        );
      }
    },
  };

  function finish() {
    finished = true;
    console.log("Done");
    console.timeEnd("opt");
    props.stop();
  }

  async function updateLoop() {
    if (epoch < totalEpochs) {
      scaleIndex = Math.min(
        scales.length - 1,
        Math.floor((epoch / totalEpochs) * scales.length)
      );

      for (let i = 0; i < stepsPerEpoch; i++) {
        if (useWorkers) {
          await updateAsync(optimizer);
        } else {
          udpateSync(optimizer);
        }
      }
      epoch++;
      // prepare next update
      requestAnimationFrame(() => {
        props.render(); // dispatch new frame
        updateLoop();
      });
    } else if (!finished) {
      finish();
    }
  }

  async function initWorkers() {
    if ((populationCount / workerCount) % 1 !== 0) {
      throw new Error(
        `populationCount (${populationCount}) is not divisible by workerCount (${workerCount})`
      );
    }
    console.log("Workers:", workerCount);
    console.log("Batch Count:", batchCount);

    workerPool = Array(workerCount)
      .fill()
      .map(
        (_, i) =>
          new Worker(new URL("./worker.js", import.meta.url), {
            type: "module",
          })
      );

    for (let i = 0; i < workerPool.length; i++) {
      const worker = workerPool[i];
      worker.postMessage({
        type: "init",
        id: i,
        scales,
        solutionLength,
        batchCount,
      });
      await waitForMessageType(worker, "ready");
    }
    return workerPool;
  }

  async function updateAsync(optimizer) {
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
        scaleIndex,
        solutions: batch,
      });
    }

    // now we wait for all to be ready
    const fitnessChunks = await Promise.all(
      workerPool.map((worker) => waitForMessageType(worker, "tell"))
    );

    // now we un-chunk the fitnesses into the final array
    for (let i = 0; i < fitnessChunks.length; i++) {
      const { fitness, id } = fitnessChunks[i];
      const start = id * batchCount;
      fitnesses.set(fitness, start);
    }

    const ranks = optimizer.tell(fitnesses);
    matchBest(solutions, fitnesses, ranks);
  }

  function udpateSync(optimizer) {
    const { width: W, height: H, data: imageLab } = scales[scaleIndex];

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
    }
  }
}, settings);
