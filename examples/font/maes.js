import xorshift128, { getRandomState } from "../../xorshift128.js";

export { xorshift128, getRandomState };

export function getDefaultPopulationCount(solutionLength) {
  return 4 + Math.floor(3 * Math.log(solutionLength));
}

export default function lmmaes(opts = {}) {
  const {
    solutionLength,
    populationCount = getDefaultPopulationCount(solutionLength),
    n_parents = Math.floor(populationCount / 2),
    n_evolution_paths = opts.n_evolution_paths ??
      4 + Math.floor(3 * Math.log(solutionLength)),
    alpha: sigmaInit = 0.05,
    mean: meanInit,
    lower,
    upper,
    c_s: c_sOpt,
    random = Math.random,
  } = opts;

  // Seed PRNG
  const state =
    opts.state ||
    new Uint32Array(
      Array(4)
        .fill()
        .map(() => (random() * 0xffffffff) >>> 0)
    );
  const prng = xorshift128(state);

  // Recombination weights and mu_eff
  const w = getWeightVector(populationCount, n_parents);
  const muEff = 1 / w.reduce((s, wi) => s + wi * wi, 0);

  // Learning rate for path and initialization
  const c_s = c_sOpt ?? (2 * populationCount) / solutionLength;
  const _s_1 = c_s < 1 ? 1 - c_s : 0.5;
  const _s_2 = Math.sqrt(Math.max(muEff * c_s * (2 - c_s), 0));

  // Low-rank transformation factors
  const c_c = new Float32Array(n_evolution_paths);
  for (let k = 0; k < n_evolution_paths; k++) {
    c_c[k] = populationCount / (solutionLength * Math.pow(4, k));
  }
  // Low-memory update coefficients for sampling
  const c_d = new Float32Array(n_evolution_paths);
  for (let k = 0; k < n_evolution_paths; k++) {
    c_d[k] = 1 / (solutionLength * Math.pow(1.5, k));
  }

  // Strategy parameters
  let sigma = sigmaInit || 0;

  const mean = new Float32Array(solutionLength);
  mean.fill(0);

  // Evolution path and transform matrix
  const s = new Float32Array(solutionLength);
  const tm = new Float32Array(n_evolution_paths * solutionLength);

  // Buffers
  const indexArray = new Uint16Array(populationCount);
  for (let i = 0; i < populationCount; i++) indexArray[i] = i;
  const baseIndexArray = indexArray.slice();
  const z = new Float32Array(populationCount * solutionLength);
  const d = new Float32Array(populationCount * solutionLength);
  const solutions = new Float32Array(populationCount * solutionLength);
  const d_w = new Float32Array(solutionLength);
  const z_w = new Float32Array(solutionLength);

  // Generation counter
  let generation = 0;

  return {
    get solutionLength() {
      return solutionLength;
    },
    get populationCount() {
      return populationCount;
    },
    get prng() {
      return prng;
    },
    get sigma() {
      return sigma;
    },
    get center() {
      return mean;
    },
    ask,
    tell,
    getSolutionAt(sols, idx) {
      const off = idx * solutionLength;
      return sols.subarray(off, off + solutionLength);
    },
  };

  function generateZ() {
    for (let i = 0; i < z.length; i++) {
      z[i] = prng.nextGaussian();
    }
  }

  function ask() {
    generateZ();
    // Transform and sample
    for (let i = 0; i < populationCount; i++) {
      const off = i * solutionLength;
      // initialize d = z
      for (let j = 0; j < solutionLength; j++) {
        d[off + j] = z[off + j];
      }
      // apply limited-memory adaptation
      const maxPaths = Math.min(generation, n_evolution_paths);
      for (let k = 0; k < maxPaths; k++) {
        // compute dot = tm[k] · d_i
        let dot = 0;
        const tmOff = k * solutionLength;
        for (let j = 0; j < solutionLength; j++) {
          dot += tm[tmOff + j] * d[off + j];
        }
        // update d_i
        const coeff1 = 1 - c_d[k];
        const coeff2 = c_d[k] * dot;
        for (let j = 0; j < solutionLength; j++) {
          d[off + j] = coeff1 * d[off + j] + coeff2 * tm[tmOff + j];
        }
      }
      // generate solution
      for (let j = 0; j < solutionLength; j++) {
        solutions[off + j] = mean[j] + sigma * d[off + j];
      }
    }
    return solutions;
  }

  function insertionSortIndices(indexArray, fitnesses) {
    // Insertion sort, sorting indices in descending order (higher fitness first)
    for (let i = 1; i < indexArray.length; i++) {
      let key = indexArray[i];
      let keyFitness = fitnesses[key];
      let j = i - 1;
      // Shift elements with lower fitness to the right
      while (j >= 0 && fitnesses[indexArray[j]] < keyFitness) {
        indexArray[j + 1] = indexArray[j];
        j--;
      }
      indexArray[j + 1] = key;
    }
  }

  function tell(fitnesses) {
    if (fitnesses.length !== populationCount) {
      throw new Error("Mismatch between population size and fitness values.");
    }

    // Reset the index array, so it goes from 0 ... N - 1
    indexArray.set(baseIndexArray);

    // Sort indices based on fitness
    insertionSortIndices(indexArray, fitnesses);

    // or with builtin sort
    // indexArray.sort((a, b) => fitnesses[b] - fitnesses[a]);

    // Weighted steps
    d_w.fill(0);
    z_w.fill(0);
    for (let kIdx = 0; kIdx < n_parents; kIdx++) {
      const idx = indexArray[kIdx];
      const wk = w[kIdx];
      const off = idx * solutionLength;
      for (let j = 0; j < solutionLength; j++) {
        d_w[j] += wk * d[off + j];
        z_w[j] += wk * z[off + j];
      }
    }

    // Update mean
    for (let j = 0; j < solutionLength; j++) {
      mean[j] += sigma * d_w[j];
    }
    // Update evolution path
    for (let j = 0; j < solutionLength; j++) {
      s[j] = _s_1 * s[j] + _s_2 * z_w[j];
    }
    // Update transform matrix
    for (let k = 0; k < n_evolution_paths; k++) {
      const off = k * solutionLength;
      let tm1 = 1 - c_c[k];
      if (tm1 < 0) tm1 = 0.5;
      let tm2 = muEff * c_c[k] * (2 - c_c[k]);
      if (tm2 < 0) tm2 = 0.25;
      const factor = Math.sqrt(tm2);
      for (let j = 0; j < solutionLength; j++) {
        tm[off + j] = tm1 * tm[off + j] + factor * z_w[j];
      }
    }

    // Update global step-size
    let sumSq = 0;
    for (let j = 0; j < solutionLength; j++) sumSq += s[j] * s[j];
    const factor = Math.exp((c_s / 2) * (sumSq / solutionLength - 1));
    sigma *= factor;

    generation++;
    return indexArray;
  }
}
function getWeightVector(lambda, mu) {
  const w = new Float32Array(mu);
  const w_base = Math.log((lambda + 1) / 2);
  let sum = 0;
  for (let i = 0; i < mu; i++) {
    // positive part
    w[i] = Math.max(0, w_base - Math.log(i + 1));
    sum += w[i];
  }
  for (let i = 0; i < mu; i++) {
    w[i] /= sum;
  }
  return w;
}
