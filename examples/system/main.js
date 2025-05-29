import canvasSketch from "canvas-sketch";
import * as Color from "@texel/color";
import Random from "canvas-sketch-util/random.js";
import sNES, { getDefaultPopulationCount } from "../../index.js";
import { setup } from "./monalisa-circles.js";

Random.setSeed("" || Random.getRandomSeed());
console.log(`seed: ${Random.getSeed()}`);

const settings = {
  dimensions: [2048, 2048],
  suffix: Random.getSeed(),
};

canvasSketch(async (props) => {
  const options = await setup();
  const { targetWidth, targetHeight } = options;

  const tmpCanvas = document.createElement("canvas");
  tmpCanvas.width = targetWidth;
  tmpCanvas.height = targetHeight;
  const tmpCtx = tmpCanvas.getContext("2d", {
    willReadFrequently: true,
  });

  const solutionLength = options.numFeatures * options.paramsPerFeatures;
  const optimizer = sNES({
    solutionLength,
    populationCount:
      options.populationCount ?? getDefaultPopulationCount(solutionLength),
    alpha: options.learningRate ?? 0.05,
  });
  const fitnesses = new Float32Array(optimizer.populationCount);

  let epoch = 0;
  let bestFitness = -Infinity;
  let bestSolution = optimizer.center.slice();

  const loop = () => {
    update(optimizer, options);
    props.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  return {
    render({ context, width, height }) {
      context.clearRect(0, 0, width, height);
      options.draw(options.decode(optimizer.center, options), {
        ...options,
        context,
        width,
        height,
      });
    },
  };

  function update(optimizer, opts = {}) {
    const { stepsPerFrame, maxEpoch = 100 } = opts;
    for (let i = 0; i < stepsPerFrame && epoch < maxEpoch; i++, epoch++) {
      // evolve the searcher
      const solutions = optimizer.ask();
      let localMax = -Infinity,
        bestLocalIdx = 0;
      for (let i = 0; i < optimizer.populationCount; i++) {
        const solution = optimizer.getSolutionAt(solutions, i);
        const f = fitness(solution, opts);
        fitnesses[i] = f;
        if (f > localMax) {
          localMax = f;
          bestLocalIdx = i;
        }
      }
      optimizer.tell(fitnesses);

      if (localMax > bestFitness) {
        bestFitness = localMax;
        bestSolution.set(optimizer.getSolutionAt(solutions, bestLocalIdx));
      }
    }
  }

  function fitness(solution, opts = {}) {
    const { targetWidth, targetHeight } = opts;
    const features = opts.decode(solution, {
      ...opts,
      fitness: true, // hint that we are calculating fitness
    });

    tmpCtx.clearRect(0, 0, targetWidth, targetHeight);
    opts.draw(features, {
      ...opts,
      fitness: true, // hint that we are calculating fitness
      context: tmpCtx,
      width: targetWidth,
      height: targetHeight,
    });

    const { targetImageDataOKLab, grayscale = false } = opts;
    const imageDataRGBA = tmpCtx.getImageData(0, 0, targetWidth, targetHeight);
    const tmp3 = [0, 0, 0];
    let error = 0;
    const pixelCount = imageDataRGBA.data.length / 4;
    for (let i = 0; i < pixelCount; i++) {
      const idx = i * 4;
      tmp3[0] = imageDataRGBA.data[idx] / 0xff;
      tmp3[1] = imageDataRGBA.data[idx + 1] / 0xff;
      tmp3[2] = imageDataRGBA.data[idx + 2] / 0xff;
      Color.convert(tmp3, Color.sRGB, Color.OKLab, tmp3);

      const L0 = targetImageDataOKLab[i * 3 + 0];
      const a0 = grayscale ? 0 : targetImageDataOKLab[i * 3 + 1];
      const b0 = grayscale ? 0 : targetImageDataOKLab[i * 3 + 2];

      const L1 = tmp3[0];
      const a1 = tmp3[1];
      const b1 = tmp3[2];

      const dL = L1 - L0;
      const da = a1 - a0;
      const db = b1 - b0;
      error += dL * dL + da * da + db * db;
    }
    return -error / pixelCount;
  }
}, settings);
