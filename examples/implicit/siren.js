import Random from "canvas-sketch-util/random.js";

// real W ∈ ℝ  →  W_q ∈ {–α, 0, +α}
// where α = mean(|W|) over nonzero entries, or a fixed scale.
function quantizeTernary(W, threshold = 0.05, Wq = new Float32Array(W.length)) {
  // threshold in [0,1]: proportions of max(|W|)
  const n = W.length;

  // const α = 1.0; // or the scale you know your W’s will live around
  // const δ = threshold * α;

  // // each forward:
  // for (let i = 0; i < W.length; i++) {
  //   const v = W[i];
  //   Wq[i] = v > δ ? α : v < -δ ? -α : 0;
  // }
  // return Wq;
  // Single pass: find absMax, sum of |W|, and count > δ (using a temp δ guess)
  let absMax = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(W[i]);
    if (a > absMax) absMax = a;
  }
  const δ = threshold * absMax;

  let sum = 0,
    cnt = 0;
  // We already know δ, so now accumulate and quantize in one go:
  for (let i = 0; i < n; i++) {
    const v = W[i];
    const av = Math.abs(v);
    if (av > δ) {
      sum += av;
      cnt++;
    }
  }
  const α = cnt ? sum / cnt : 0;

  // Final pass: quantize
  for (let i = 0; i < n; i++) {
    const v = W[i];
    Wq[i] = v > δ ? α : v < -δ ? -α : 0;
  }
  return Wq;
}
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

/**
 * Create a SIREN layer:
 *  - inDim  = input dimensionality
 *  - outDim = number of output units
 *  - omega0 = ω₀ scaling for the sine (use 30 for first layer, 1 elsewhere)
 */
export function makeSineLayer(inDim, outDim, omega0 = 1.0, isFinal = false) {
  const W = new Float32Array(inDim * outDim);
  const b = new Float32Array(outDim);
  const Wq = new Float32Array(W.length);

  function initialize(isFirst = false) {
    const scale = isFirst ? 1.0 / inDim : Math.sqrt(6.0 / inDim) / omega0;
    for (let i = 0; i < W.length; i++) {
      W[i] = (Random.value() * 2 - 1) * scale;
    }
    b.fill(0);
  }

  function forward(x, out) {
    // quantizeTernary(W, 0.05, Wq);
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
    const Wq = quantizeTernary(W, thresh);
    for (let i = 0; i < W.length; i++) {
      W[i] = Wq[i];
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
