export function getRandomState() {
  return new Uint32Array(
    Array(4)
      .fill()
      .map(() => (Math.random() * 0xffffffff) >>> 0)
  );
}

export default function xorshift128(state) {
  let xs_state = new Uint32Array(4);
  const TWO_PI = 2.0 * Math.PI;

  // set initial
  setState(state);

  return {
    getState() {
      return xs_state;
    },
    setState,
    // random functions
    nextUint32,
    nextGaussian: nextGaussianBoxMuller,
    next,
  };

  function nextGaussianBoxMuller(mean = 0, standardDerivation = 1) {
    return (
      mean +
      standardDerivation *
        (Math.sqrt(-2.0 * Math.log(next())) * Math.cos(TWO_PI * next()))
    );
  }

  function setState(view) {
    view = view || getRandomState();
    if (view.byteLength !== 16) throw new Error("expected 128 bit state");
    xs_state.set(view);
  }

  function next() {
    return nextUint32() / 0x100000000;
  }

  function nextUint32() {
    /* Algorithm "xor128" from p. 5 of Marsaglia, "Xorshift RNGs" */
    let s = xs_state[0];
    let t = xs_state[3];
    xs_state[3] = xs_state[2];
    xs_state[2] = xs_state[1];
    xs_state[1] = xs_state[0];
    t ^= t << 11;
    t ^= t >>> 8;
    xs_state[0] = t ^ s ^ (s >>> 19);
    return xs_state[0];
  }
}
