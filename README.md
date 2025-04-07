# snes

<img src="examples/rects-output.png" width="50%" />

Separable Natural Evolution Strategy algorithm in JavaScript.

```js
import SNES from "snes";

// creates an optimizer with settings
const optimizer = SNES({
  solutionLength, // number of parameters
  populationCount,
});

// an array to store your fitnesses for each population
const fitnesses = new Float32Array(populationCount);

// for each epoch...
const epochs = 100;
for (let i = 0; i < epochs; i++) {
  // ask for a set of solutions (flat array)
  const solutions = optimizer.ask();

  // compute the fitness for each
  for (let j = 0; j < populationCount; j++) {
    // note this returns a subarray (i.e. no copy)
    const params = optimizer.getSolutionAt(solutions, j);

    // compute the fitness, which is often -err
    fitnesses[j] = fitness(params);
  }

  // update the optimizer with all fitnesses
  optimizer.tell(fitnesses);
}

// The optimized 'mean' solution
console.log(optimizer.center);
```

See the [examples](./examples/) directory for more.

## Install

Use [npm](https://npmjs.com/) to install.

```sh
npm install snes --save
```

## Usage

### `optimizer = SNES({ opts })`

With options:

- `solutionLength` number of parameters to optimize
- `populationCount` number of candidate solutions to use
- `alpha` (default=0.05) learning rate
- `state` a 4-element Uint32Array random seed state
- `random` (default=`Math.random`) randomizer for computing an initial `opts.state` if not specified; ignored if state is given
- `sigma` the initial standard deviation, defaults to:
  - `new Float32Array(solutionLength).fill(1)`
- `center` the initial mean, defaults to:
  - `new Float32Array(solutionLength).fill(0)`

### `solutions = optimizer.ask()`

Returns a flat array of solutions, strided by `solutionLength`. The total size of this array will be `solutionLength * populationCount`.

### `subarray = optimizer.getSolutionAt(solutions, index)`

From a flat array of `solutions`, gets a subarray at slot `index`. Since this is a view of the flat array, it is not a copy, and so any changes to the flat array will also be present in this view. You should use `subarray.slice()` if you want a copy.

### `optimizer.tell(fitnesses)`

Updates the parameters based on the list of fitnesses, which is expected to be parallel to the `solutions` array given by the `ask()` function. The size of this array should be `populationCount`.

### `optimizer.center`

The current mean of the optimizer, i.e. the optimization result. This may not always be the _best_ performing candidate, for example compared to candidates from prior epochs.

### other getters

- `optimizer.sigma` (length `solutionLength`)
- `optimizer.gaussian` (length `populationCount * solutionLength`)
- `optimizer.prng` (you can use `prng.next()` and `prng.nextGaussian()` for random values)

## References

- [Exponential Natural Evolution Strategies (2010) - T Glasmachers](https://people.idsia.ch/~juergen/xNES2010gecco.pdf)
- [Benchmarking Separable Natural Evolution Strategies on
  the Noiseless and Noisy Black-box Optimization Testbeds (2012) - T Schaul](https://dl.acm.org/doi/10.1145/2330784.2330815)
- [pints](https://github.com/pints-team/pints)

## License

MIT, see [LICENSE.md](http://github.com/mattdesl/snes/blob/master/LICENSE.md) for details.
