import xorshift128, { getRandomState } from "./xorshift128.js";

export { xorshift128, getRandomState };

export function getDefaultPopulationCount(solutionLength) {
  return 4 + Math.floor(3 * Math.log(solutionLength));
}

export default function sNES(opts = {}) {
  const {
    solutionLength,
    alpha = 0.05,
    etaCenter = 1,
    // Population size (number of solutions)
    populationCount = getDefaultPopulationCount(solutionLength),
    // alternative
    // https://people.idsia.ch/~juergen/xNES2010gecco.pdf
    // etaSigma = ((3 / 5) * (3 + Math.log(solutionLength))) /
    //   (solutionLength * Math.sqrt(solutionLength)),
    // https://citeseerx.ist.psu.edu/document?repid=rep1&type=pdf&doi=b49838b5393b9da9be8789115a850df5a2a64867
    etaSigma = (3 + Math.log(solutionLength)) / (5 * Math.sqrt(solutionLength)),
    random = Math.random,
    mirrored = false,
  } = opts;

  const state =
    opts.state ||
    new Uint32Array(
      Array(4)
        .fill()
        .map(() => (random() * 0xffffffff) >>> 0)
    );

  const prng = xorshift128(state);

  const utilities = getWeightVector(populationCount);

  // Initialize center (mu)
  const center = new Float32Array(opts.center ?? solutionLength);

  const indexArray = new Uint16Array(populationCount);
  for (let i = 0; i < populationCount; i++) indexArray[i] = i;
  const baseIndexArray = indexArray.slice();

  const solutions = new Float32Array(populationCount * solutionLength);

  // Initialize std deviation (sigma)
  const sigma = new Float32Array(opts.sigma ?? solutionLength);
  if (opts.sigma == null) sigma.fill(1);
  // apply alpha to sigma
  for (let i = 0; i < sigma.length; i++) sigma[i] = sigma[i] * alpha;
  const gausses = new Float32Array(populationCount * solutionLength);

  return {
    get populationCount() {
      return populationCount;
    },
    get solutionLength() {
      return solutionLength;
    },
    get prng() {
      return prng;
    },
    get sigma() {
      return sigma;
    },
    get gaussian() {
      return gausses;
    },
    get center() {
      return center;
    },
    ask,
    getSolutionAt(solutions, index) {
      const off = index * solutionLength;
      return solutions.subarray(off, off + solutionLength);
    },
    tell,
  };

  function ask() {
    if (mirrored) {
      const half = Math.floor(populationCount / 2);
      const stride = solutionLength;
      const mirrorOffset = half * stride;
      let k1 = 0; // write-pointer into solutions/gausses for first half
      let k2 = mirrorOffset; // write-pointer for mirrored half

      // Generate mirrored pairs
      for (let i = 0; i < half; i++) {
        for (let j = 0; j < stride; j++, k1++, k2++) {
          const g = prng.nextGaussian();
          gausses[k1] = g;
          gausses[k2] = -g;
          const mu = center[j];
          const sig = sigma[j];
          solutions[k1] = mu + sig * g;
          solutions[k2] = mu - sig * g;
        }
      }

      // If odd, generate one extra (unpaired) sample at the end
      if (populationCount % 2 !== 0) {
        const off = populationCount - 1;
        let k = off * stride;
        for (let j = 0; j < stride; j++, k++) {
          const g = prng.nextGaussian();
          gausses[k] = g;
          solutions[k] = center[j] + sigma[j] * g;
        }
      }
    } else {
      for (let i = 0, k = 0; i < populationCount; i++) {
        for (let j = 0; j < solutionLength; j++, k++) {
          gausses[k] = prng.nextGaussian();
          solutions[k] = center[j] + sigma[j] * gausses[k];
        }
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

    // Update each parameter dimension
    for (let j = 0; j < solutionLength; j++) {
      let deltaMu = 0;
      let deltaSigma = 0;
      // Sum the utility-weighted noise for this parameter dimension
      for (let i = 0; i < populationCount; i++) {
        const idx = indexArray[i];
        const gaussIndex = idx * solutionLength + j;
        const noise = gausses[gaussIndex];
        deltaMu += utilities[i] * noise;
        deltaSigma += utilities[i] * (noise * noise - 1);
      }
      // Update center (mu)
      center[j] += etaCenter * sigma[j] * deltaMu;

      // Update sigma: multiplicative update via exponential
      sigma[j] *= Math.exp(0.5 * etaSigma * deltaSigma);
    }

    return indexArray;
  }
}

function getWeightVector(n) {
  // Pre-calculate utilities vector 'us'
  // For i in 0 ... n-1: us[i] = max(0, log(n/2 + 1) - log(1 + i))
  // Then normalize: divide by sum(us) and subtract 1/n
  const us = new Float32Array(n);
  let sumUs = 0;
  for (let i = 0; i < n; i++) {
    let u = Math.max(0, Math.log(n / 2 + 1) - Math.log(1 + i));
    us[i] = u;
    sumUs += u;
  }
  for (let i = 0; i < n; i++) {
    us[i] = us[i] / sumUs - 1 / n;
  }
  return us;
}
