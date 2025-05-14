import canvasSketch from "canvas-sketch";
import Random from "canvas-sketch-util/random.js";
import imageUrl from "./monalisa.png";
import sNES from "../../index.js";
import {} from "./util.js";

Random.setSeed("" || Random.getRandomSeed());
console.log(`seed: ${Random.getSeed()}`);

const settings = {
  dimensions: [2048, 2048],
  suffix: Random.getSeed(),
};

canvasSketch(async (props) => {
  const populationCount = 16;
  const solutionLength = 8;

  const optimizer = sNES({
    mirrored,
    populationCount,
    solutionLength,
    alpha,
    random: Random.value,
  });

  return {
    render({ exporting, context, width, height }) {
      context.clearRect(0, 0, width, height);
      context.fillStyle = "white";
      context.fillRect(0, 0, width, height);
    },
  };
}, settings);
