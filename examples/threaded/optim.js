import xorshift128, { getRandomState } from "../../xorshift128.js";
import NES from "../../index.js";

export default function Optim(opts = {}) {
  const {
    solutionLength,
    // Population size (number of solutions)
    populationCount = 4,
    subPopulationCount = 4,
    alpha = 0.05,
    random = Math.random,
    fitness,
    reset = () => {},
    //
    stepCount = 1,
  } = opts;

  // Searcher is always going
  // When searcher convergence slows, we check against best score
  // and if needed reposition the refiner
  // before restarting the searcher

  let epoch = 0;

  const state =
    opts.state ||
    new Uint32Array(
      Array(4)
        .fill()
        .map(() => (random() * 0xffffffff) >>> 0)
    );

  const prng = xorshift128(state);

  // const searcher = NES({
  //   solutionLength,
  //   populationCount,
  //   alpha,
  //   random: prng.next,
  // });

  const searcherCount = populationCount;
  let searchers = Array(searcherCount)
    .fill()
    .map(() => {
      const r = {
        age: 0,
        score: 0,
        history: [],
        optimizer: NES({
          solutionLength,
          populationCount: subPopulationCount,
          alpha,
          random: prng.next,
        }),
      };
      return r;
    });
  const best = new Float32Array(solutionLength);
  let bestFitness = -Infinity;

  // const refiner = NES({
  //   solutionLength,
  //   populationCount,
  //   alpha,
  //   random: prng.next,
  // });

  // refiner.center.set(searcher.center);
  // refiner.sigma.set(searcher.sigma);

  // const bestCenter = refiner.center.slice();
  const fitnesses = new Float32Array(subPopulationCount);
  // const searchFitnesses = [];
  // const searchFitnessWindow = 10;
  const windowSize = 20;

  for (let s of searchers) {
    reset(s.optimizer);
  }

  return {
    get children() {
      return searchers;
    },
    get populationCount() {
      return populationCount;
    },
    get prng() {
      return prng;
    },
    // get sigma() {
    //   return sigma;
    // },
    // get gaussian() {
    //   return gausses;
    // },
    // get bestCenter() {
    //   return bestCenter;
    // },
    get center() {
      return best;
    },
    // ask,
    // getSolutionAt(solutions, index) {
    //   const off = index * solutionLength;
    //   return solutions.subarray(off, off + solutionLength);
    // },
    // tell,
    tick() {
      // iterate all searchers

      const checkpointEvery = 10;
      const replenEveryEpoch = 20;

      for (let searcher of searchers) {
        const score = iterate(searcher.optimizer, stepCount);
        searcher.score = score;
        if (score > bestFitness) {
          bestFitness = score;
          best.set(searcher.optimizer.center);
        }
        searcher.age++;
        searcher.history.push(searcher.score);
        if (searcher.history.length > windowSize) {
          searcher.history.shift();
        }
      }

      if (epoch % checkpointEvery === 0) {
        const prunes = searchers.filter(shouldPrune);
        prunes.sort((a, b) => b.score - a.score);
        const keepFirst = epoch % replenEveryEpoch === 0;
        for (let p of prunes.slice(1)) {
          // reset the optimizer
          resetOptimizer(p.optimizer);
          p.age = 0;
          p.history.length = 0;
          p.score = -Infinity;
        }
        // const scored = searchers.slice().sort((a, b) => b.score - a.score);
        // the bottom % will be copied from the top
        // const toRespawn = 0.5;
        // const startPoint = Math.floor(scored.length * toRespawn);
        // for (let i = startPoint; i < scored.length; i++) {
        //   const searcher = scored[i];
        //   const parent = scored[0];
        //   searcher.optimizer.center.set(parent.optimizer.center);
        //   searcher.optimizer.sigma.set(parent.optimizer.sigma);
        // }
        // console.log("Respawn");
        // shouldPrune
      }

      // const scored = searchers.slice().sort((a, b) => b.score - a.score);
      epoch++;
    },
  };

  function shouldPrune(island) {
    const h = island.history;
    // need a full window
    if (h.length < windowSize) return false;

    // absolute/relative check
    if (hasStalledAbsolute(h, 1e-3, 1e-6)) return true;

    // slope check
    if (hasStalledSlope(h, 1e-5)) return true;

    return false;
  }

  function slopeOfWindow(history) {
    const W = history.length;
    if (W < 2) return Infinity; // can’t compute slope yet
    let sumX = 0,
      sumY = 0,
      sumXY = 0,
      sumXX = 0;
    for (let i = 0; i < W; i++) {
      const x = i;
      const y = history[i];
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumXX += x * x;
    }
    // slope = (n*sumXY - sumX*sumY) / (n*sumXX - sumX^2)
    return (W * sumXY - sumX * sumY) / (W * sumXX - sumX * sumX);
  }

  function hasStalledAbsolute(history, epsRel = 1e-3, epsAbs = 1e-6) {
    if (history.length < 2) return false;
    const first = history[0];
    const last = history[history.length - 1];
    const absChange = last - first;
    const relChange = absChange / Math.max(Math.abs(first), 1e-12);
    return absChange < epsAbs || relChange < epsRel;
  }

  function hasStalledSlope(history, slopeEps = 1e-5) {
    const m = slopeOfWindow(history);
    return m < slopeEps;
  }

  function resetOptimizer(optimizer) {
    optimizer.center.fill(0);
    optimizer.sigma.fill(alpha);
    reset(optimizer);
  }

  function iterate(optimizer, steps) {
    // first we evolve the searcher by N steps
    let ranks;
    for (let i = 0; i < steps; i++) {
      ranks = evolve(optimizer);
    }
    return fitnesses[ranks[0]];
  }

  function evolve(optimizer) {
    // evolve the searcher
    const solutions = optimizer.ask();
    for (let i = 0; i < optimizer.populationCount; i++) {
      const solution = optimizer.getSolutionAt(solutions, i);
      fitnesses[i] = fitness(solution);
    }
    return optimizer.tell(fitnesses);
  }
}
