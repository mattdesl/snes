import sNES, { getRandomState } from "../index.js";

// A fairly useless example,
// but learns to print the target text in ASCII

const seed = getRandomState();
const populationCount = 64;
const target = "Hello world! Some target text.";
const solutionLength = target.length;

const min = 32;
const max = 126;
const mid = (min + max) / 2;
const range = max - min;
const alpha = 1;
const center = new Float32Array(solutionLength).fill(mid);
const sigma = new Float32Array(solutionLength).fill(range);
const epochs = 150;

function fitness(params, target) {
  let err = 0;
  for (let i = 0; i < params.length; i++) {
    const a = params[i];
    const b = target.charCodeAt(i);
    const diff = a - b;
    err += diff * diff;
  }
  return -err;
}

function paramsToText(params) {
  return [...params]
    .map((p) => {
      const ascii = Math.max(32, Math.min(126, Math.round(p)));
      return String.fromCharCode(ascii);
    })
    .join("");
}

const optimizer = sNES({
  sigma,
  center,
  solutionLength,
  populationCount,
  alpha,
  state: seed,
});

const fitnesses = new Float32Array(populationCount);
for (let i = 0; i < epochs; i++) {
  const solutions = optimizer.ask();
  for (let j = 0; j < populationCount; j++) {
    const params = optimizer.getSolutionAt(solutions, j);
    fitnesses[j] = fitness(params, target);
  }
  optimizer.tell(fitnesses);

  if (i == epochs - 1 || i % 10 == 0) {
    const bestParams = optimizer.center;
    const best = paramsToText(bestParams);
    console.log(`Epoch ${String(i).padStart(3, "0")}: ${best}`);
  }
}
