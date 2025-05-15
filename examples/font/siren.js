import Random from "canvas-sketch-util/random.js";

/**
 * Create a SIREN layer:
 *  - inDim  = input dimensionality
 *  - outDim = number of output units
 *  - omega0 = ω₀ scaling for the sine (use 30 for first layer, 1 elsewhere)
 */
export function makeSineLayer(inDim, outDim, omega0 = 1.0, isFinal = false) {
  const W = new Float32Array(inDim * outDim);
  const b = new Float32Array(outDim);

  function initialize(isFirst = false) {
    const scale = isFirst ? 1.0 / inDim : Math.sqrt(6.0 / inDim) / omega0;
    for (let i = 0; i < W.length; i++) {
      W[i] = (Random.value() * 2 - 1) * scale;
    }
    b.fill(0);
  }

  function forward(x, out) {
    let ptrW = 0;
    for (let j = 0; j < outDim; j++) {
      let acc = b[j];
      for (let i = 0; i < inDim; i++, ptrW++) {
        acc += W[ptrW] * x[i];
      }
      out[j] = isFinal ? acc : Math.sin(omega0 * acc);
    }
  }

  return { inDim, outDim, omega0, W, b, initialize, forward };
}

/**
 * Build a SIREN network with zero-allocation forward + pack/unpack.
 * dims = [inDim, h1, h2, ..., outDim]
 * ω0First = ω₀ for the first layer
 */
export function makeSirenNetwork(dims, ω0First = 30) {
  const layers = [];
  let maxDim = 0;
  let totalSize = 0;

  for (let i = 0; i < dims.length - 1; i++) {
    const inD = dims[i];
    const outD = dims[i + 1];
    maxDim = Math.max(maxDim, inD, outD);
    const isFirst = i === 0;
    const isFinal = i === dims.length - 2;
    const ω0 = isFirst ? ω0First : 1.0;
    const layer = makeSineLayer(inD, outD, ω0, isFinal);
    layers.push(layer);
    totalSize += layer.W.length + layer.b.length;
  }

  // scratch buffers reused each forward call
  const bufA = new Float32Array(maxDim);
  const bufB = new Float32Array(maxDim);

  function initialize() {
    layers.forEach((L, idx) => L.initialize(idx === 0));
  }

  function packParams(vec = new Float32Array(totalSize)) {
    let p = 0;
    for (const L of layers) {
      vec.set(L.W, p);
      p += L.W.length;
      vec.set(L.b, p);
      p += L.b.length;
    }
    return vec;
  }

  function unpackParams(vec) {
    let p = 0;
    for (const L of layers) {
      L.W.set(vec.subarray(p, p + L.W.length));
      p += L.W.length;
      L.b.set(vec.subarray(p, p + L.b.length));
      p += L.b.length;
    }
  }

  function forward(
    input,
    output = new Float32Array(layers[layers.length - 1].outDim)
  ) {
    let cur = input;
    let nxt = bufA;
    for (let i = 0; i < layers.length; i++) {
      const L = layers[i];
      const target = i === layers.length - 1 ? output : nxt;
      L.forward(cur, target);
      if (i < layers.length - 1) {
        cur = nxt;
        nxt = nxt === bufA ? bufB : bufA;
      }
    }
    return output;
  }

  return { initialize, packParams, unpackParams, forward };
}
