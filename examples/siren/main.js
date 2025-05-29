// This example is still a WIP
import canvasSketch from "canvas-sketch";
import * as Color from "@texel/color";
import Random from "canvas-sketch-util/random.js";
import sNES from "../../index.js";
import { makeSirenNetwork } from "./siren.js";
import { smoothstep } from "canvas-sketch-util/math.js";
import { sdf } from "./sdf.js";
Random.setSeed("1234" || Random.getRandomSeed());
console.log(`seed: ${Random.getSeed()}`);

const settings = {
  dimensions: [2048, 2048],
  suffix: Random.getSeed(),
  animate: true,
};

canvasSketch(async (props) => {
  const DIM = 32;

  const tmpCanvas = document.createElement("canvas");
  const tmpCtx = tmpCanvas.getContext("2d", {
    willReadFrequently: true,
  });

  const positionJitter = 0.0;
  const downscale = 32;
  const targetSize = DIM * downscale;
  tmpCanvas.width = targetSize;
  tmpCanvas.height = targetSize;

  const glyphs = "A".split("");

  if (glyphs.length > 2)
    throw new Error("only supports 1 or 2 glyphs currently");

  const glyphSDFs = glyphs.map((glyph, i, lst) => {
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

    const tmpCanvas2 = document.createElement("canvas");
    const tmpCtx2 = tmpCanvas2.getContext("2d", {
      willReadFrequently: true,
    });
    tmpCanvas2.width = DIM;
    tmpCanvas2.height = DIM;
    tmpCtx2.drawImage(tmpCanvas, 0, 0, DIM, DIM);
    const imageData = tmpCtx2.getImageData(0, 0, DIM, DIM);
    const imageL = new Float32Array(DIM * DIM);
    const pixelCount = DIM * DIM;
    for (let i = 0; i < pixelCount; i++) {
      imageL[i] = imageData.data[i * 4] / 255;
    }
    return {
      param: lst.length <= 1 ? 0 : i / (lst.length - 1),
      L: imageL,
      sdf: sdfData,
    };
  });

  const inputParamCount = glyphSDFs.length === 1 ? 0 : 1;
  const inputSize = 3 + inputParamCount; // (x, y, radius, [param])
  const outputSize = 1;
  const stepsPerFrame = 5;
  let epoch = 0;
  const maxEpoch = 5000;

  const net = makeSirenNetwork([inputSize, 16, 16, outputSize], 30);

  // 2) Initialize weights
  net.initialize();

  const populationCount = 12;
  const solutionLength = net.packParams().length;

  console.log("Image Size:", DIM * DIM);
  console.log("Network Size:", solutionLength);

  const optimizer = sNES({
    populationCount,
    solutionLength,
    alpha: 0.01,
    random: Random.value,
  });

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
    }
  });

  let stopped = false;
  window.quant = (t) => {};
  window.stop = () => (stopped = true);
  window.generateGLSL = () => generateShadertoyGLSL(net, glyphSDFs.length);

  const button = document.createElement("button");
  let buttonTimer = null;
  button.style.cssText = `
position: absolute; top: 20px; left: 20px`;
  const copyTxt = "Copy GLSL to Clipboard";
  button.textContent = copyTxt;
  document.body.appendChild(button);

  const setButtonText = (msg) => {
    clearTimeout(buttonTimer);
    button.textContent = msg;

    buttonTimer = setTimeout(() => {
      button.textContent = copyTxt;
    }, 1000);
  };

  button.onclick = async () => {
    try {
      clipboardCopy(generateShadertoyGLSL(net, glyphSDFs.length));
      setButtonText("Copied to clipboard!");
    } catch (err) {
      alert(err.message);
    }

    // var element = document.createElement('a');
    // element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(generateGLSL));
    // element.setAttribute('download', filename);

    // element.style.display = 'none';
    // document.body.appendChild(element);

    // element.click();

    // document.body.removeChild(element);
  };

  const forward = (ux, uy, param = 0, out = tmpOutput, jitter = 1) => {
    const [ox, oy] = Random.insideCircle(
      Random.gaussian(0, jitter * positionJitter)
    );
    ux += ox;
    uy += oy;

    // euclidean
    const rad = Math.hypot(ux, uy);

    // manhattan
    // const rad = Math.abs(ux) + Math.abs(uy);

    const x = [ux, uy, rad];

    // alternatively, pass in only angles
    // const thetas = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4];
    // const di = thetas.map((θ) => ux * Math.cos(θ) + uy * Math.sin(θ));
    // const x = [...di, rad];

    if (glyphSDFs.length == 2) {
      x.push(param > 0.5 ? 1 : -1);
    }
    if (x.length !== inputSize) throw new Error("Invalid input size");
    net.forward(x, out);
    return out;
  };

  return {
    render({ exporting, time, context, width, height }) {
      context.clearRect(0, 0, width, height);
      context.fillStyle = "white";
      context.fillRect(0, 0, width, height);

      const lineWidth = 0.1; // thickness in "height" units

      // const renderSize = DIM * 8;
      const renderSize = useGrid ? DIM * 8 : width / 4;
      let xCount = renderSize;
      let yCount = xCount;
      const cellWidth = width / xCount;
      const cellHeight = height / yCount;

      const paramT = param;
      // const paramT = useGrid ? param : Math.sin(time / 2) * 0.5 + 0.5;

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

          if (useGrid) {
            for (let j = 0; j < outputSize; j++) {
              tmpOutput[j] = sample(u, v, grid, DIM, DIM, outputSize, j);
            }
          } else {
            forward(u * 2 - 1, v * 2 - 1, paramT, tmpOutput, 0);
          }

          let d;
          if (outputSize == 1) d = tmpOutput[0];
          else d = median(tmpOutput);

          const a = 0,
            b = 0;
          const thres = 0.05;
          const alpha = 0.0;
          const Lq = d;
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

  // Utility: compute the median of an array (arbitrary length)
  // arr: Array or TypedArray of numeric values
  function median(arr) {
    const a = Array.from(arr);
    const n = a.length;
    if (n === 0) return NaN;
    a.sort((x, y) => x - y);
    const mid = Math.floor(n / 2);
    if (n % 2 === 1) {
      return a[mid];
    } else {
      return (a[mid - 1] + a[mid]) / 2;
    }
  }

  // helper: bilinear sample (u,v) in [0,1]
  function sample(u, v, sdf, w, h, stride = 1, off = 0) {
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
    const i00 = sdf[(y0 * w + x0) * stride + off],
      i10 = sdf[(y0 * w + x1) * stride + off],
      i01 = sdf[(y1 * w + x0) * stride + off],
      i11 = sdf[(y1 * w + x1) * stride + off];
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
        forward(ux, uy, glyphSDFParam, tmpOutput, 1);
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
    // const curGlyphs = Random.shuffle(glyphSDFs);

    for (let p = 0; p < glyphSDFs.length; p++) {
      const pT = p;
      const raw = drawToSDF(solution, dimensions, tmpDimOut, pT);
      const { sdf: glyphSDF, L } = glyphSDFs[p];
      const pixelCount = dimensions * dimensions;
      for (let i = 0; i < pixelCount; i++) {
        const idx = i * outputSize;
        const d =
          outputSize == 1
            ? raw[idx]
            : median([raw[idx + 0], raw[idx + 1], raw[idx + 2]]);
        const threshold = 0.05;
        const alpha = 0;
        // computed lightness
        const cL = smoothstep(alpha - threshold, alpha + threshold, d);
        // target lightness
        const tL = L[i];
        const diff = cL - tL;
        error += diff * diff;

        if (outputSize == 1) {
          const dSDF = glyphSDF[i];
          const diffSDF = d - dSDF;
          error += diffSDF * diffSDF;
        }
      }
      // error /= pixelCount / (outputSize == 1 ? 2 : 1);

      // const imageDim =
      // debugger;
      // for (let i = 0; i < raw.length; i++) {

      // }
    }
    return -error;
  }

  function update(dimensions = DIM) {
    if (stopped) return;
    for (let i = 0; i < stepsPerFrame && epoch < maxEpoch; i++) {
      // evolve the searcher
      const solutions = optimizer.ask();

      for (let i = 0; i < optimizer.populationCount; i++) {
        const solution = optimizer.getSolutionAt(solutions, i);
        fitnesses[i] = fitness(solution, dimensions);
      }
      optimizer.tell(fitnesses);
      epoch++;
    }
  }
  // Dynamically generate a fully-unrolled GLSL shader for a 4-input SIREN (x, y, radius, param)
  // with w0 cached in the shader.
  function generateShadertoyGLSL(net, glyphCount = 1) {
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
}\n`;

    // 4) Shadertoy mainImage with radius and paramT
    if (glyphCount == 2) {
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
    siren_forward(uv.x, -uv.y, rad, -1.0),
    siren_forward(uv.x, -uv.y, rad, 1.0), paramT, 1.5);
  
  float v = smoothstep(0.0, fwidth(length(uv))*16.0, d);
  fragColor = vec4(vec3(v), 1.0);
}`;
    } else if (glyphCount == 1) {
      glsl += /*glsl*/ `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord.xy / iResolution.xy;
  uv = uv * 2.0 - 1.0;
  uv.x *= iResolution.x / iResolution.y;
  uv = clamp(uv, -1.0, 1.0);
  
  float rad = length(uv);
  float d = siren_forward(uv.x, -uv.y, rad, -1.0);
  float v = smoothstep(0.0, fwidth(length(uv))*16.0, d);
  fragColor = vec4(vec3(v), 1.0);
}`;
    } else {
      throw new Error("no support for glyphCount > 2");
    }

    return glsl;
  }
}, settings);

export function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

async function clipboardCopy(value) {
  if (!value) return false;
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(value);
  } else {
    fallbackCopyTextToClipboard(value);
  }
  return true;
}

function fallbackCopyTextToClipboard(string) {
  let textarea;
  let result;

  try {
    textarea = document.createElement("textarea");
    textarea.setAttribute("readonly", true);
    textarea.setAttribute("contenteditable", true);
    textarea.style.position = "fixed"; // prevent scroll from jumping to the bottom when focus is set.
    textarea.style.top = "-99999px";
    textarea.style.left = "-99999px";
    textarea.value = string;

    document.body.appendChild(textarea);

    textarea.focus();
    textarea.select();

    const range = document.createRange();
    range.selectNodeContents(textarea);

    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    textarea.setSelectionRange(0, textarea.value.length);
    result = document.execCommand("copy");
  } catch (err) {
    console.error(err);
    result = null;
  } finally {
    document.body.removeChild(textarea);
  }
}

function euclideanDistance(a, b) {
  const dx = a[0] - b[0],
    dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

// helper: Manhattan distance between [x,y] points
function manhattanDistance(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

function chebyshevDistance(a, b) {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}
