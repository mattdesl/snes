import Random from "canvas-sketch-util/random.js";

/**
 * Create a Fourier Feature Network (FFN) mapping + MLP layers.
 * dims = [inDim, hiddenDim, ..., outDim]
 * options:
 *   embeddingDim (default 256): number of random Fourier features
 *   gaussianScale (default 10): scale for random B initialization
 *   nAngles (optional): for 2D inputs, number of fixed directions (rigid grid)
 *   angles (optional): explicit array of angles (in radians) for 2D inputs
 */
export function makeFFNNetwork(
  dims,
  { embeddingDim = 256, gaussianScale = 10, nAngles = null, angles = null } = {}
) {
  const [inDim, ...rest] = dims;
  const hiddenLayers = rest.slice(0, -1);
  const outDim = rest[rest.length - 1];

  // Determine Fourier directions B: embeddingDim x inDim
  let B;
  let actualEmbeddingDim;

  function initB() {
    if (inDim === 2 && (nAngles != null || Array.isArray(angles))) {
      const angs =
        angles ||
        Array.from({ length: nAngles }, (_, i) => (i * 2 * Math.PI) / nAngles);
      actualEmbeddingDim = angs.length;
      B = new Float32Array(actualEmbeddingDim * inDim);
      angs.forEach((θ, j) => {
        B[j * inDim + 0] = Math.cos(θ) * gaussianScale;
        B[j * inDim + 1] = Math.sin(θ) * gaussianScale;
      });
    } else {
      actualEmbeddingDim = embeddingDim;
      B = new Float32Array(actualEmbeddingDim * inDim);
      for (let i = 0; i < B.length; i++) {
        B[i] = Random.gaussian() * gaussianScale;
      }
    }
  }

  // Utility: Dense layer
  function makeDense(inD, outD, activation = null) {
    const W = new Float32Array(inD * outD);
    const b = new Float32Array(outD);
    function initialize() {
      const scale = Math.sqrt(2 / inD);
      for (let i = 0; i < W.length; i++) W[i] = Random.gaussian() * scale;
      b.fill(0);
    }
    function forward(x, out) {
      for (let j = 0, ptr = 0; j < outD; j++) {
        let sum = b[j];
        for (let i = 0; i < inD; i++, ptr++) {
          sum += W[ptr] * x[i];
        }
        out[j] = activation ? activation(sum) : sum;
      }
    }
    return { inD, outD, W, b, initialize, forward };
  }

  // Build MLP layers after B init
  const layers = [];
  // Buffers
  let maxDim, bufA, bufB;

  function initialize() {
    initB();

    let prevDim = actualEmbeddingDim * 2;
    hiddenLayers.forEach((hd, idx) => {
      const act = (x) => Math.max(0, x);
      layers.push(makeDense(prevDim, hd, act));
      prevDim = hd;
    });
    layers.push(makeDense(prevDim, outDim, (x) => Math.tanh(x)));

    maxDim = Math.max(actualEmbeddingDim * 2, ...hiddenLayers, outDim);
    bufA = new Float32Array(maxDim);
    bufB = new Float32Array(maxDim);

    layers.forEach((layer) => layer.initialize());
  }

  function packParams(
    vec = new Float32Array(
      B.length + layers.reduce((sum, L) => sum + L.W.length + L.b.length, 0)
    )
  ) {
    let p = 0;
    vec.set(B, p);
    p += B.length;
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
    B.set(vec.subarray(p, p + B.length));
    p += B.length;
    for (const L of layers) {
      L.W.set(vec.subarray(p, p + L.W.length));
      p += L.W.length;
      L.b.set(vec.subarray(p, p + L.b.length));
      p += L.b.length;
    }
  }

  // Fourier embedding: uses B rows directly
  function embed(x, out) {
    for (let j = 0; j < actualEmbeddingDim; j++) {
      let dot = 0;
      for (let i = 0; i < inDim; i++) {
        dot += 2 * Math.PI * x[i] * B[j * inDim + i];
      }
      out[j] = Math.sin(dot);
      out[j + actualEmbeddingDim] = Math.cos(dot);
    }
  }

  function forward(input, output = new Float32Array(outDim)) {
    const embedBuf = bufA;
    embed(input, embedBuf);
    let cur = embedBuf;
    let nxt = bufB;
    for (let i = 0; i < layers.length; i++) {
      const L = layers[i];
      const target = i === layers.length - 1 ? output : nxt;
      L.forward(cur, target);
      if (i < layers.length - 1) {
        cur = nxt;
        nxt = cur === bufA ? bufB : bufA;
      }
    }
    return output;
  }

  return {
    initialize,
    layers,
    dims,
    embeddingDim: actualEmbeddingDim,
    gaussianScale,
    nAngles,
    angles,
    B,
    packParams,
    unpackParams,
    forward,
  };
}
