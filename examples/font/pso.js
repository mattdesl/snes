import xorshift128, { getRandomState } from "../../xorshift128.js";

export { xorshift128, getRandomState };

export function getDefaultPopulationCount(solutionLength) {
  return 4 + Math.floor(3 * Math.log(solutionLength));
}

export default function pSO(opts = {}) {
  const {
    solutionLength,
    populationCount = getDefaultPopulationCount(solutionLength),
    inertia = 0.5, // Inertia weight
    cognitive = 1.5, // Cognitive coefficient
    social = 1.5, // Social coefficient
    random = Math.random,
    alpha = 0.005,
  } = opts;

  const state =
    opts.state ||
    new Uint32Array(
      Array(4)
        .fill()
        .map(() => (random() * 0xffffffff) >>> 0)
    );

  const prng = xorshift128(state);

  // Initialize particles
  const particles = new Array(populationCount);
  for (let i = 0; i < populationCount; i++) {
    particles[i] = {
      position: new Float32Array(solutionLength),
      velocity: new Float32Array(solutionLength),
      bestPosition: new Float32Array(solutionLength),
      bestFitness: Infinity,
    };

    // Randomize initial particle positions and velocities
    for (let j = 0; j < solutionLength; j++) {
      particles[i].position[j] = prng.nextGaussian();
      particles[i].velocity[j] = 0; //prng.nextGaussian() * alpha; // Small initial velocities
    }
    particles[i].bestPosition.set(particles[i].position); // Initial best position is the same as the starting position
  }

  let globalBestPosition = new Float32Array(solutionLength);
  let globalBestFitness = Infinity;

  return {
    get center() {
      return globalBestPosition;
    },
    get populationCount() {
      return populationCount;
    },
    get prng() {
      return prng;
    },
    get particles() {
      return particles;
    },
    ask,
    getSolutionAt(_, index) {
      return particles[index].position;
    },
    tell,
  };

  function ask() {
    // Nothing to do here for PSO, as positions are already initialized.
    // Particle positions will be updated directly in the `tell` method.
    return particles.map((p) => p.position);
  }

  function tell(fitnesses) {
    if (fitnesses.length !== populationCount) {
      throw new Error("Mismatch between population size and fitness values.");
    }

    // Update personal bests and global best
    for (let i = 0; i < populationCount; i++) {
      const particle = particles[i];
      const fitness = fitnesses[i];

      if (fitness < particle.bestFitness) {
        particle.bestFitness = fitness;
        particle.bestPosition.set(particle.position);
      }

      if (fitness < globalBestFitness) {
        globalBestFitness = fitness;
        globalBestPosition.set(particle.position);
      }
    }

    // Update velocity and position of each particle
    for (let i = 0; i < populationCount; i++) {
      const particle = particles[i];

      for (let j = 0; j < solutionLength; j++) {
        // Update velocity
        const r1 = 1; // * prng.nextGaussian();
        const r2 = 1; // * prng.nextGaussian();

        const inertiaTerm = inertia * particle.velocity[j];
        const cognitiveTerm =
          cognitive * r1 * (particle.bestPosition[j] - particle.position[j]);
        const socialTerm =
          social * r2 * (globalBestPosition[j] - particle.position[j]);

        // Update velocity
        particle.velocity[j] = inertiaTerm + cognitiveTerm + socialTerm;

        // Update position
        particle.position[j] += particle.velocity[j];

        // Keep particle within bounds
        particle.position[j] = Math.max(-1, Math.min(1, particle.position[j])); // Assuming bounds [0, 1] for each parameter
      }
    }

    return particles.map((p) => p.position); // Return new positions after updates
  }
}
