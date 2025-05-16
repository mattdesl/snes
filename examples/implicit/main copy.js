import canvasSketch from "canvas-sketch";
import * as Color from "@texel/color";
import Random from "canvas-sketch-util/random.js";
import sNES from "../../index.js";
import { makeSineLayer, makeSirenNetwork } from "./siren.js";
import { makeFFNNetwork } from "./ffn.js";
import imageUrl from "../monalisa.png";
import { convertRGBAToOKLab, loadImage } from "../util.js";
import { smoothstep } from "canvas-sketch-util/math.js";
import { sdf } from "./sdf.js";
Random.setSeed("1234" || Random.getRandomSeed());
console.log(`seed: ${Random.getSeed()}`);

const settings = {
  dimensions: [2048, 2048],
  suffix: Random.getSeed(),
  animate: true,
};

function l1Embed(u, v) {
  const feats = [];
  for (let [nx, ny] of normals) {
    const d = nx * u + ny * v;
    feats.push(Math.abs(d));
  }
  return feats; // → [|u|, |v|, |(u+v)/√2|, |(u–v)/√2|]
}

function planeSDF(u, v, offsets) {
  let d = Infinity;
  for (let j = 0; j < P; j++) {
    const [nx, ny] = normals[j];
    d = Math.min(d, nx * u + ny * v + offsets[j]);
  }
  return d;
}

function kaleido(u, v, N = 6) {
  // convert to polar
  const θ = Math.atan2(v, u);
  const r = Math.hypot(u, v);
  // fold θ into [–π/N, +π/N]
  const sector = ((θ + Math.PI / N) % ((2 * Math.PI) / N)) - Math.PI / N;
  // reconstruct coords
  return [r * Math.cos(sector), r * Math.sin(sector)];
}

canvasSketch(async (props) => {
  const DIM = 32;

  const tmpCanvas = document.createElement("canvas");
  const tmpCtx = tmpCanvas.getContext("2d", {
    willReadFrequently: true,
  });

  const downscale = 32;
  const targetSize = DIM * downscale;
  tmpCanvas.width = targetSize;
  tmpCanvas.height = targetSize;

  const glyphs = "&".split("");

  const glyphSDFs = glyphs.map((glyph) => {
    const fontScale = 1;
    tmpCtx.fillStyle = "white";
    tmpCtx.fillRect(0, 0, targetSize, targetSize);
    tmpCtx.font = `${targetSize * fontScale}px "Andale Mono", monospace`;
    tmpCtx.textAlign = "center";
    tmpCtx.textBaseline = "middle";
    tmpCtx.fillStyle = "black";
    tmpCtx.fillText(glyph, targetSize / 2, targetSize / 2 + targetSize / 32);

    const targetData = tmpCtx.getImageData(0, 0, targetSize, targetSize);
    const sdfData = sdf(targetData.data, targetSize, targetSize, {
      spread: DIM,
      downscale,
    });
    return sdfData;
  });

  // const image = await loadImage(imageUrl, DIM);
  // tmpCanvas.width = DIM;
  // tmpCanvas.height = DIM;
  // tmpCtx.drawImage(image, 0, 0, DIM, DIM);
  // const imageData = tmpCtx.getImageData(0, 0, DIM, DIM);
  // const imageLab = convertRGBAToOKLab(imageData.data);

  // const inputSize = l1Embed(0, 0).length;
  const inputSize = 2;
  const hiddenSize = 16;
  const hiddenLayerCount = 2;
  const outputSize = 1;
  const stepsPerFrame = 5;
  // const ffnBands = 16;

  // 1) Create a 2D→1D SIREN net with two 256-unit hidden layers
  // const net = makeSirenNetwork(
  //   [inputSize, hiddenSize, hiddenSize, outputSize],
  //   30
  // );

  const net = makeSirenNetwork(
    [
      inputSize,
      ...Array(hiddenLayerCount)
        .fill()
        .map(() => hiddenSize),
      outputSize,
    ],
    30
  );

  // 2) Initialize weights
  net.initialize();

  const populationCount = 8;
  const solutionLength = net.packParams().length;

  console.log("Image Size:", DIM * DIM);
  console.log("Network Size:", solutionLength);

  const optimizer = sNES({
    populationCount,
    solutionLength,
    alpha: 0.01,
    random: Random.value,
  });

  // const ffnScale = 1;
  // const ffnB = new Array(ffnBands).fill().map(() => {
  //   return Array(inputSize)
  //     .fill()
  //     .map(() => optimizer.prng.nextGaussian() * ffnScale);
  // });

  optimizer.center.set(net.packParams());

  const fitnesses = new Float32Array(populationCount);
  const loop = () => {
    update(DIM);
    // props.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  const tmpDimOut = new Float32Array(DIM * DIM * outputSize);
  const tmpOutput = new Float32Array(outputSize);

  let useGrid = true,
    param = 0;
  window.addEventListener("keydown", (ev) => {
    if (ev.key == "g") {
      ev.preventDefault();
      useGrid = !useGrid;
    } else if (ev.key == "p") {
      ev.preventDefault();
      param = param === 0 ? 1 : 0;
      console.log("param", param);
    } else if (ev.key == "n") {
      ev.preventDefault();
      const glsl = generateShadertoyGLSL(net);
      window.glsl = glsl;
      console.log("GLSL", glsl);
    }
  });

  let stopped = false;
  window.quant = (t) => {};
  window.stop = () => (stopped = true);

  const forward = (ux, uy, param = 0, out = tmpOutput) => {
    // const uv = [ux, uy];
    const rad = Math.hypot(ux, uy);
    // const rad = Math.abs(ux) + Math.abs(uy);
    // const rad = Math.max(Math.abs(ux), Math.abs(uy));
    // const ang = Math.atan2(uy, ux);
    // const [ox, oy] = Random.insideCircle(Random.gaussian(0, 0.01));
    // const pt = [ux + ox, uy + oy, 0];
    // const pt = [ux + ox, uy + oy, param * 2 - 1];

    // const [ox, oy] = [0, 0];
    // const pt = l1Embed(ux, uy);
    // const pt = [ux + ox, uy + oy, rad, param];

    const x = [ux, uy];

    if (x.length !== inputSize) throw new Error("Invalid input size");

    // let ffnInput = new Array(ffnBands * 2);
    // for (let i = 0; i < ffnBands; i++) {
    //   // compute dot(B[i], x)
    //   let dot = 0;
    //   for (let j = 0; j < inputSize; j++) {
    //     dot += ffnB[i][j] * x[j];
    //   }
    //   const angle = 2 * Math.PI * dot;
    //   ffnInput[2 * i] = Math.sin(angle);
    //   ffnInput[2 * i + 1] = Math.cos(angle);
    // }

    return net.forward(x, out);
  };

  function morphBandLimited(dA, dB, t, δ = 0.1) {
    // if we're "far" from both surfaces, just union them
    if (dA > δ && dB > δ) {
      // outside both glyphs
      return Math.min(dA, dB);
    }
    if (dA < -δ && dB < -δ) {
      // deep inside both glyphs
      return Math.max(dA, dB);
    }
    // near at least one surface, blend softly
    return dA * (1 - t) + dB * t;
  }

  return {
    render({ exporting, time, context, width, height }) {
      context.clearRect(0, 0, width, height);
      context.fillStyle = "white";
      context.fillRect(0, 0, width, height);

      // contour parameters
      const levels = 4; // number of contour lines
      const lineWidth = 0.1; // thickness in "height" units

      const renderSize = DIM * 8;
      // const renderSize = useGrid ? DIM * 8 : width / 4;
      let xCount = renderSize;
      let yCount = xCount;
      const cellWidth = width / xCount;
      const cellHeight = height / yCount;

      // const paramT = useGrid ? param : Math.sin(time / 2) * 0.5 + 0.5;
      const paramT = 0;

      const grid = useGrid
        ? drawToSDF(optimizer.center, DIM, tmpDimOut, paramT)
        : null;
      for (let y = 0; y < yCount; y++) {
        for (let x = 0; x < xCount; x++) {
          // const idx = (x + y * xCount) * outputSize;
          // const [L, a, b] = decodeLab(grid, idx);
          const u = xCount <= 1 ? 0.5 : x / (xCount - 1);
          const v = yCount <= 1 ? 0.5 : y / (yCount - 1);
          const ui = Math.floor(u * DIM);
          const vi = Math.floor(v * DIM);
          const sdfIdx = ui + vi * DIM;
          let d;
          if (useGrid) {
            d = sample(u, v, grid, DIM, DIM);
            // d = grid[sdfIdx];
          } else {
            d = forward(u * 2 - 1, v * 2 - 1, paramT)[0];
          }

          // const N = 4;
          // const idx = Math.floor(d * N); // 0,1,2,3
          // const Lq = idx / (N - 1); // 0, 1/3, 2/3, 1
          const Lq = d;

          const a = 0,
            b = 0;
          const thres = 0.05;
          const alpha = 0.0;

          // // scale into [0..levels]
          // const vScaled = d * levels;

          // // fractional distance to nearest integer, centered at 0
          // const f = Math.abs((vScaled % 1) - 0.5);

          // // draw a line when f < (lineWidth/2)
          // const isLine = f < lineWidth / 2;
          // const L = isLine ? 1 : 0;

          // const L = d;
          const L = smoothstep(alpha - thres, alpha + thres, Lq);
          const color = Color.serialize([L, a, b], Color.OKLab, Color.sRGB);
          context.fillStyle = color;
          context.fillRect(
            x * cellWidth,
            y * cellHeight,
            cellWidth,
            cellHeight
          );
        }
      }
    },
  };
  // helper: bilinear sample (u,v) in [0,1]
  function sample(u, v, sdf, w, h) {
    // map to [0 .. w-1], [0 .. h-1]
    const x = u * (w - 1),
      y = v * (h - 1);
    const x0 = Math.floor(x),
      y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, w - 1),
      y1 = Math.min(y0 + 1, h - 1);
    const fx = x - x0,
      fy = y - y0;
    // fetch four
    const i00 = sdf[y0 * w + x0],
      i10 = sdf[y0 * w + x1],
      i01 = sdf[y1 * w + x0],
      i11 = sdf[y1 * w + x1];
    // lerp in x, then y
    const ix0 = i00 + (i10 - i00) * fx;
    const ix1 = i01 + (i11 - i01) * fx;
    return ix0 + (ix1 - ix0) * fy;
  }

  function drawToSDF(
    solution,
    dimensions = DIM,
    out = tmpDimOut,
    glyphSDFParam = 0
  ) {
    let xCount = dimensions;
    let yCount = xCount;

    // // quantize
    // const { max, quantized } = quantizeArray(solution, 8);
    // const solSlice = solution.slice();
    // for (let i = 0; i < solution.length; i++) {
    //   solSlice[i] = quantized[i] / max;
    // }
    net.unpackParams(solution); // load

    for (let y = 0; y < yCount; y++) {
      for (let x = 0; x < xCount; x++) {
        // center pixel uv coords from 0...1 inclusive
        const u = xCount <= 1 ? 0.5 : x / (xCount - 1);
        const v = yCount <= 1 ? 0.5 : y / (yCount - 1);

        // remap to –1…+1
        const ux = u * 2 - 1;
        const uy = v * 2 - 1;

        // const pt = uv;
        // const pt = [Math.atan2(uy, ux), Math.hypot(ux, uy)];

        // net.forward(pt, tmpOutput);
        forward(ux, uy, glyphSDFParam, tmpOutput);
        const pixelIndex = x + y * xCount;
        for (let i = 0; i < outputSize; i++) {
          const a = tmpOutput[i];
          out[pixelIndex * outputSize + i] = a;
        }
      }
    }
    return out;
  }

  function fitness(solution, dimensions = DIM) {
    let error = 0;
    for (let p = 0; p < glyphSDFs.length; p++) {
      const raw = drawToSDF(solution, dimensions, tmpDimOut, p);
      const glyphSDF = glyphSDFs[p];
      for (let i = 0; i < raw.length; i++) {
        const d = raw[i];
        const targetSDF = glyphSDF[i];
        const diff = d - targetSDF;
        error += diff * diff;
      }

      error /= raw.length;

      // const imageDim =
      // debugger;
      // for (let i = 0; i < raw.length; i++) {

      // }
    }
    return -error / glyphSDFs.length;
  }

  function quantizeArray(arr, bits) {
    const scale = 2 ** (bits - 1) - 1; // e.g. 127 for 8-bit
    const n = arr.length;
    const quantized = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // e.g. scale = 255:  -0.002312 → round(-0.002312 * 255) = -1
      quantized[i] = Math.round(arr[i] * scale);
    }
    return { max: scale, quantized };
  }

  function update(dimensions = DIM) {
    if (stopped) return;
    for (let i = 0; i < stepsPerFrame; i++) {
      // evolve the searcher
      const solutions = optimizer.ask();

      for (let i = 0; i < optimizer.populationCount; i++) {
        const solution = optimizer.getSolutionAt(solutions, i);
        fitnesses[i] = fitness(solution, dimensions);
      }
      optimizer.tell(fitnesses);
    }
  }
  // Dynamically generate a fully-unrolled GLSL shader for a 4-input SIREN (x, y, radius, param)
  // with w0 cached in the shader.
  function generateShadertoyGLSL(net) {
    const { dims, w0 } = net;
    const params = net.packParams();
    let offset = 0;
    const L = dims.length - 1;

    // 1) slice out each layer’s weights and biases
    const layerData = [];
    for (let i = 0; i < L; i++) {
      const inD = dims[i],
        outD = dims[i + 1];
      const wCount = inD * outD;
      const bCount = outD;
      const W = Array.from(params.subarray(offset, offset + wCount));
      offset += wCount;
      const B = Array.from(params.subarray(offset, offset + bCount));
      offset += bCount;
      layerData.push({ inD, outD, W, B });
    }

    // 2) Build GLSL string
    let glsl = `// auto-generated SIREN shader [${dims.join("x")}]\n`;

    // 3) Unrolled forward pass signature
    // supports x0, x1, x2, x3 for (x, y, radius, param)
    glsl += `float siren_forward(float x0, float x1, float x2, float x3) {\n`;
    // cache w0
    glsl += `  float w0 = ${w0.toFixed(1)};\n`;

    // Layer 0 with omega0 = w0
    {
      const { inD, outD, W, B } = layerData[0];
      for (let j = 0; j < outD; j++) {
        const terms = [];
        for (let i = 0; i < inD; i++) {
          const varName = `x${i}`;
          terms.push(`${W[j * inD + i].toFixed(6)} * ${varName}`);
        }
        terms.push(B[j].toFixed(6));
        glsl += `  float h0_${j} = sin(w0 * (${terms.join(" + ")}));\n`;
      }
      glsl += `\n`;
    }

    // Middle hidden layers (ω0 = 1)
    for (let l = 1; l < layerData.length - 1; l++) {
      const { inD, outD, W, B } = layerData[l];
      for (let j = 0; j < outD; j++) {
        const terms = [];
        for (let i = 0; i < inD; i++) {
          terms.push(`${W[j * inD + i].toFixed(6)} * h${l - 1}_${i}`);
        }
        terms.push(B[j].toFixed(6));
        glsl += `  float h${l}_${j} = sin(${terms.join(" + ")});\n`;
      }
      glsl += `\n`;
    }

    // Final linear output layer
    {
      const l = layerData.length - 1;
      const { inD, outD, W, B } = layerData[l];
      for (let j = 0; j < outD; j++) {
        const terms = [];
        for (let i = 0; i < inD; i++) {
          terms.push(`${W[j * inD + i].toFixed(6)} * h${l - 1}_${i}`);
        }
        terms.push(B[j].toFixed(6));
        glsl += `  float out_${j} = ${terms.join(" + ")};\n`;
      }
      glsl += `\n`;
    }

    glsl += `  return out_0;
}\n\n`;

    // 4) Shadertoy mainImage with radius and paramT
    glsl += /*glsl*/ `
float morphBandLimited(float dA, float dB, float t, float K) {
    // if we're "far" from both surfaces, just union them
    if (dA > K && dB > K) {
      // outside both glyphs
      return min(dA, dB);
    }
    if (dA < -K && dB < -K) {
      // deep inside both glyphs
      return max(dA, dB);
    }
    // near at least one surface, blend softly
    return dA * (1.0 - t) + dB * t;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord.xy / iResolution.xy;
  uv = uv * 2.0 - 1.0;
  uv.x *= iResolution.x / iResolution.y;
  uv = clamp(uv, -1.0, 1.0);
  
  float rad = length(uv);
  float paramT = smoothstep(0.0, 1.0, sin(iTime));
  float d = morphBandLimited(
    siren_forward(uv.x, -uv.y, rad, 0.0),
    siren_forward(uv.x, -uv.y, rad, 1.0), paramT, 1.5);
  
  float v = smoothstep(0.0, fwidth(length(uv))*16.0, d);
  fragColor = vec4(vec3(v), 1.0);
}`;

    return glsl;
  }
}, settings);

export function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}
