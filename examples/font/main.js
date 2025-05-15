import canvasSketch from "canvas-sketch";
import * as Color from "@texel/color";
import Random from "canvas-sketch-util/random.js";
import sNES from "../../index.js";
import { makeSineLayer, makeSirenNetwork } from "./siren.js";
import imageUrl from "../monalisa.png";
import { convertRGBAToOKLab, loadImage } from "../util.js";

Random.setSeed("1234" || Random.getRandomSeed());
console.log(`seed: ${Random.getSeed()}`);

const settings = {
  dimensions: [2048, 2048],
  suffix: Random.getSeed(),
};

canvasSketch(async (props) => {
  const populationCount = 16;

  const targetSize = 32;
  const glyph = "A";

  const tmpCanvas = document.createElement("canvas");
  const tmpCtx = tmpCanvas.getContext("2d", {
    willReadFrequently: true,
  });

  tmpCanvas.width = targetSize;
  tmpCanvas.height = targetSize;

  const fontScale = 0.1;
  tmpCtx.fillStyle = "white";
  tmpCtx.fillRect(0, 0, targetSize, targetSize);
  tmpCtx.font = `${targetSize * fontScale}px monospace`;
  tmpCtx.textAlign = "center";
  tmpCtx.textBaseline = "middle";
  tmpCtx.fillStyle = "black";
  tmpCtx.fillText(glyph, targetSize / 2, targetSize / 2);

  const targetData = tmpCtx.getImageData(0, 0, targetSize, targetSize);
  const imageLab = convertRGBAToOKLab(targetData.data);

  // const optimizer = sNES({
  //   populationCount,
  //   solutionLength,
  //   alpha: 0.01,
  //   random: Random.value,
  // });

  // optimizer.center.set(siren.packParams());

  // const fitnesses = new Float32Array(populationCount);
  // const loop = () => {
  //   update(DIM);
  //   props.render();
  //   // requestAnimationFrame(loop);
  // };
  // requestAnimationFrame(loop);

  // const tmpOutput = new Float32Array(outputSize);

  return {
    render({ exporting, context, width, height }) {
      context.clearRect(0, 0, width, height);
      context.fillStyle = "white";
      context.fillRect(0, 0, width, height);
    },
  };

  function drawToOKLab(
    solution,
    dimensions = DIM,
    out = new Float32Array(dimensions * dimensions * outputSize)
  ) {
    let xCount = dimensions;
    let yCount = xCount;

    siren.unpackParams(solution); // load

    for (let y = 0; y < yCount; y++) {
      for (let x = 0; x < xCount; x++) {
        // center pixel uv coords from 0...1 inclusive
        const u = xCount <= 1 ? 0.5 : x / (xCount - 1);
        const v = yCount <= 1 ? 0.5 : y / (yCount - 1);

        const uv = [u * 2 - 1, v * 2 - 1];
        // const rad = Math.hypot(...uv);
        const pt = [...uv];

        siren.forward(pt, tmpOutput);
        const pixelIndex = x + y * xCount;
        for (let i = 0; i < outputSize; i++) {
          const a = tmpOutput[i];
          out[pixelIndex * outputSize + i] = a;
        }
      }
    }
    return out;
  }

  function decodeLab(raw, idx) {
    const L = sigmoid(raw[idx + 0]);
    const maxChroma = 0.4;
    const a = outputSize >= 2 ? maxChroma * Math.tanh(raw[idx + 1]) : 0;
    const b = outputSize >= 3 ? maxChroma * Math.tanh(raw[idx + 2]) : 0;
    return [L, a, b];
  }

  function fitness(solution, dimensions = DIM) {
    const raw = drawToOKLab(solution, dimensions);
    let error = 0;

    const pixelCount = imageLab.length / 3;
    for (let i = 0; i < pixelCount; i++) {
      const base = i * 3;
      const [L0, A0, B0] = decodeLab(raw, base);
      const L1 = imageLab[base + 0];
      const A1 = imageLab[base + 1];
      const B1 = imageLab[base + 2];
      const dL = L1 - L0,
        dA = outputSize >= 2 ? A1 - A0 : 0,
        dB = outputSize >= 3 ? B1 - B0 : 0;
      error += dL * dL + dA * dA + dB * dB;
    }

    return -error;
  }

  function update(dimensions = DIM) {
    console.profile("fit");
    for (let i = 0; i < stepsPerFrame; i++) {
      // evolve the searcher
      const solutions = optimizer.ask();
      for (let i = 0; i < optimizer.populationCount; i++) {
        const solution = optimizer.getSolutionAt(solutions, i);
        fitnesses[i] = fitness(solution, dimensions);
      }
      optimizer.tell(fitnesses);
    }
    console.profileEnd("fit");
  }
}, settings);

export function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}
