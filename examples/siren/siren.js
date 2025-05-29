import Random from "canvas-sketch-util/random.js";

function square(x) {
  return x >= 0 ? +1 : -1;
}
// 3-level quantized tanh
function qtanh(x) {
  const t = Math.tanh(x);
  if (t > 0.5) return 1;
  if (t < -0.5) return -1;
  return 0;
}
function perReLU(x) {
  // wrap x into [0, 2π), then relu-shift to get a bump
  const y = x % (2 * Math.PI);
  return Math.max(0, Math.sin(y)); // or Math.max(0, y - π); for saw-style
}

// triangle wave with period 2π
function triangle(x) {
  // const DP = 1;
  // return x < -DP ? -DP : x > DP ? DP : x;

  // map x into [–π, +π)
  const y = ((x + Math.PI) % (2 * Math.PI)) - Math.PI;
  // piecewise linear: rises to +1 then falls to –1
  return 1 - (2 * Math.abs(y)) / Math.PI;
}

function quantizedSin(z, N = 4) {
  const step = (2 * Math.PI) / N;
  // wrap z into [0,2π), then quantize
  let a = z % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  const aq = Math.round(a / step) * step;
  return Math.sin(aq);
}

/**
 * Create a SIREN layer:
 *  - inDim  = input dimensionality
 *  - outDim = number of output units
 *  - omega0 = ω₀ scaling for the sine (use 30 for first layer, 1 elsewhere)
 */
export function makeSineLayer(inDim, outDim, omega0 = 1.0, isFinal = false) {
  const W = new Float32Array(inDim * outDim);
  const b = new Float32Array(outDim);
  // const Wq = new Float32Array(W.length);

  function initialize(isFirst = false) {
    const scale = isFirst ? 1.0 / inDim : Math.sqrt(6.0 / inDim) / omega0;
    for (let i = 0; i < W.length; i++) {
      W[i] = (Random.value() * 2 - 1) * scale;
    }
    b.fill(0);
  }

  function forward(x, out) {
    const Wq = W;
    let ptrW = 0;
    for (let j = 0; j < outDim; j++) {
      let acc = b[j];
      for (let i = 0; i < inDim; i++, ptrW++) {
        acc += Wq[ptrW] * x[i];
      }
      out[j] = isFinal ? acc : Math.sin(omega0 * acc);
    }
  }

  function quantize(thresh = 0.05) {
    for (let i = 0; i < W.length; i++) {
      W[i] = W[i] > thresh ? 1 : W[i] < -thresh ? -1 : 0;
    }
    for (let i = 0; i < b.length; i++) {
      b[i] = b[i] > thresh ? 1 : b[i] < -thresh ? -1 : 0;
    }
  }

  return { inDim, quantize, outDim, omega0, W, b, initialize, forward };
}

/**
 * Build a SIREN network with zero-allocation forward + pack/unpack.
 * dims = [inDim, h1, h2, ..., outDim]
 * w0 = ω₀ for the first layer
 */
export function makeSirenNetwork(dims, w0 = 30) {
  const layers = [];
  let maxDim = 0;
  let totalSize = 0;

  for (let i = 0; i < dims.length - 1; i++) {
    const inD = dims[i];
    const outD = dims[i + 1];
    maxDim = Math.max(maxDim, inD, outD);
    const isFirst = i === 0;
    const isFinal = i === dims.length - 2;
    const W0 = isFirst ? w0 : 1.0;
    const layer = makeSineLayer(inD, outD, W0, isFinal);
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

  function quantize(thresh = 0.05) {
    for (const L of layers) {
      L.quantize(thresh);
    }
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

  return {
    inputSize: dims[0],
    outputSize: dims[dims.length - 1],
    initialize,
    layers,
    dims,
    w0,
    quantize,
    packParams,
    unpackParams,
    forward,
  };
}
