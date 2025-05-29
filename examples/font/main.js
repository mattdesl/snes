import canvasSketch from "canvas-sketch";
import * as Color from "@texel/color";
import Random from "canvas-sketch-util/random.js";
import sNES from "../../index.js";
import { makeSineLayer, makeSirenNetwork } from "./siren.js";
import imageUrl from "../monalisa.png";
import { convertRGBAToOKLab, loadImage } from "../util.js";
import stackblur from "stackblur";

Random.setSeed("" || Random.getRandomSeed());
console.log(`seed: ${Random.getSeed()}`);

const settings = {
  dimensions: [2048, 2048],
  suffix: Random.getSeed(),
};

canvasSketch(async (props) => {
  const targetSize = 32;
  // const glyphs = "G".toUpperCase().split("");
  const glyphs = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

  const populationCount = 16;
  const fitnesses = new Float32Array(populationCount);

  const nodeCountMin = 6;
  const nodeCountMax = 6;

  const gridCount = 16;

  // windows for tracking patience
  const shortWindow = 5;
  const longWindow = 40;
  // number of stagnant ticks to wait before restart
  const patience = 10;

  const stepsPerFrame = 20;

  const blurRadius = 0;
  const visualizeLines = false;
  const targetLineScale = 7;
  const alpha = 0.5; // learning rate
  const weightThreshold = 0.5;

  // shared by all fitnesses
  const tmpCanvas = document.createElement("canvas");
  tmpCanvas.width = targetSize;
  tmpCanvas.height = targetSize;
  const tmpCtx = tmpCanvas.getContext("2d", {
    willReadFrequently: true,
  });

  const cells = glyphs.map((glyph) => {
    const tmpCanvas = document.createElement("canvas");
    const tmpCtx = tmpCanvas.getContext("2d", {
      willReadFrequently: true,
    });

    tmpCanvas.width = targetSize;
    tmpCanvas.height = targetSize;

    const fontScale = 1.0;
    tmpCtx.fillStyle = "white";
    tmpCtx.fillRect(0, 0, targetSize, targetSize);
    tmpCtx.font = `${targetSize * fontScale}px "Andale Mono", monospace`;
    tmpCtx.textAlign = "center";
    tmpCtx.textBaseline = "top";

    const metrics = tmpCtx.measureText(glyph);
    const yoff = metrics.fontBoundingBoxAscent
      ? (0.5 / fontScale) * metrics.fontBoundingBoxAscent
      : 0;
    // const yoff = 0;
    tmpCtx.fillStyle = "black";
    tmpCtx.fillText(glyph, targetSize / 2, 0 + yoff);

    const targetData = tmpCtx.getImageData(0, 0, targetSize, targetSize);
    if (blurRadius > 0)
      stackblur(targetData.data, targetSize, targetSize, blurRadius);

    const targetMask = buildBinaryMask(targetData);
    const imageDistance = computeDistanceTransform(targetMask);

    const options = createOptions();

    const cell = {
      options,
      character: glyph,
      canvas: tmpCanvas,
      context: tmpCtx,
      imageDistance,
      imageData: targetData,
      bestFitness: -Infinity,
      bestSolution: {
        center: new Float32Array(options.solutionLength),
        options: { ...options },
      },
      deltaShort: [],
      deltaLong: [],
      stagnation: 0,
      prevScore: -Infinity,
    };
    restart(cell); // will add the .optimizer field
    return cell;
  });

  const loop = () => {
    for (let cell of cells) {
      update(cell);
    }
    props.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  return {
    render({ exporting, context, width, height }) {
      context.clearRect(0, 0, width, height);
      context.fillStyle = "tan";
      context.fillRect(0, 0, width, height);

      // layout into square
      const columns = Math.ceil(Math.sqrt(cells.length));
      const rows = Math.ceil(cells.length / columns);
      const cellWidth = width / columns;
      const cellHeight = height / rows;

      // drawGridPoints(context, {
      //   alpha: 0.2,
      //   width: width,
      //   height: height,
      //   radius: Math.min(cellWidth, cellHeight) * 0.02,
      //   count: gridCount * columns,
      // });
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const x = (i % columns) * cellWidth;
        const y = Math.floor(i / columns) * cellHeight;
        context.save();
        context.translate(x, y);

        // context.fillStyle = "white";
        // context.fillRect(0, 0, cellWidth, cellHeight);

        // drawGridPoints(context, {
        //   alpha: 0.2,
        //   width: cellWidth,
        //   height: cellHeight,
        //   count: gridCount,
        // });

        // context.globalAlpha = 0.25;
        // tmpCtx.putImageData(cell.imageData, 0, 0);
        // context.drawImage(tmpCtx.canvas, 0, 0, cellWidth, cellHeight);
        // context.globalAlpha = 1;
        // context.strokeRect(0, 0, cellWidth, cellHeight);

        const solutions = [
          // [
          //   cell.optimizer.center,
          //   cell.options,
          //   {
          //     alpha: 1,
          //     drawNodes: false,
          //     lineScale: targetLineScale,
          //   },
          // ],
          [cell.bestSolution.center, cell.bestSolution.options],
        ];

        for (let [center, options, params] of solutions) {
          const { alpha = 1 } = params || {};
          let { nodes, links } = decodeSolution(center, options);
          context.globalAlpha = alpha;
          drawGraph(context, {
            stylize: true,
            links,
            nodes,
            // snapping: true,
            gridCount,
            lineScale: visualizeLines ? targetLineScale : 1,
            drawNodes: true,
            useWeightScaling: false,
            thresholdWeights: true,
            weightThreshold,
            width: cellWidth,
            height: cellHeight,
            ...params,
          });
          context.globalAlpha = 1;
        }

        // context.drawImage(tmpCtx.canvas, 0, 0, cellWidth, cellHeight);

        context.restore();
      }
    },
  };

  function createOptions() {
    const nodeCount = Random.rangeFloor(nodeCountMin, nodeCountMax + 1);
    const edgeCount = (nodeCount * (nodeCount - 1)) / 2;
    const paramsPerNode = 2;
    const paramsPerEdge = 1;
    const solutionLength =
      nodeCount * paramsPerNode + edgeCount * paramsPerEdge;
    return {
      nodeCount,
      edgeCount,
      solutionLength,
      paramsPerNode,
      paramsPerEdge,
    };
  }

  function drawGridPoints(
    context,
    {
      width,
      height,
      count = 4,
      radius = Math.min(width, height) * 0.02,
      alpha = 1,
    } = {}
  ) {
    context.beginPath();
    context.globalAlpha = alpha;
    context.fillStyle = "black";
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        const u = count <= 1 ? 0.5 : x / (count - 1);
        const v = count <= 1 ? 0.5 : y / (count - 1);
        const px = u * width;
        const py = v * height;
        context.moveTo(px, py);
        context.arc(px, py, radius, 0, Math.PI * 2);
      }
    }
    context.fill();
    context.globalAlpha = 1;
  }

  function restart(cell) {
    // re‑initialize the convergence trackers
    cell.prevScore = -Infinity;
    cell.stagnation = 0;
    cell.deltaShort.length = 0;
    cell.deltaLong.length = 0;

    // re-initialize the optimizer features
    cell.options = createOptions();
    cell.optimizer = sNES({
      populationCount,
      solutionLength: cell.options.solutionLength,
      alpha,
      random: Random.value,
    });
    for (let i = 0; i < cell.optimizer.center.length; i++) {
      // randomize positions and weights
      // cell.optimizer.center[i] = cell.optimizer.prng.nextGaussian() * 1;

      // randomize just the node positions
      for (
        let j = 0;
        j < cell.options.paramsPerNode * cell.options.nodeCount;
        j++
      ) {
        cell.optimizer.center[i] = cell.optimizer.prng.nextGaussian() * 1;
      }

      cell.optimizer.sigma[i] = alpha;
    }
  }

  function decodeSolution(solution, options = {}) {
    const { nodeCount } = options;

    const nodes = []; // a list of [x,y]
    const links = []; // a set of indices into the nodes array { edge: [a,b], weight }
    // the edges are fixed but the weight parameter is from the solution
    let idx = 0;
    // 1) Decode node coordinates
    for (let i = 0; i < nodeCount; i++) {
      // const x = Math.tanh(solution[idx++]);
      // const y = Math.tanh(solution[idx++]);
      const x = sigmoid(solution[idx++]) * 2 - 1;
      const y = sigmoid(solution[idx++]) * 2 - 1;
      nodes.push([x, y]);
    }

    // 2) Decode undirected edge weights
    //    Order: (0,1), (0,2), ..., (0,3), (1,2), (1,3), (2,3)
    for (let i = 0; i < nodeCount; i++) {
      for (let j = i + 1; j < nodeCount; j++) {
        // const weight = Math.tanh(solution[idx++]) * 0.5 + 0.5;
        const weight = sigmoid(solution[idx++]);
        links.push({ edge: [i, j], weight });
      }
    }
    return { nodes, links };
  }

  function fitness(solution, targetImageData, targetDist, options = {}) {
    const { nodes: nodesRaw, links } = decodeSolution(solution, options);
    const {
      snapStrategy = "pre", // pre or post
      snapping = false,
      gridCount,
      blurRadius = 0,
    } = options;

    // we can choose to pre-snap the nodes to a grid
    // or we can softly guide them to grid points
    const nodes =
      snapStrategy == "pre"
        ? nodesRaw.map((uv) => {
            return snapping ? snapUVToGrid(uv, gridCount) : uv;
          })
        : nodesRaw;

    let error = getImageError(
      nodes,
      links,
      targetImageData,
      targetSize,
      targetSize,
      tmpCtx,
      targetLineScale,
      blurRadius
    );

    const nodeCount = nodes.length;
    const t = getThreshold(links, weightThreshold);
    const keptLinks = links.filter((l) => l.weight >= t);

    // build the adjacency matrix
    const degree = new Array(nodeCount).fill(0);
    for (let { edge } of keptLinks) {
      const [i, j] = edge;
      degree[i] += 1;
      degree[j] += 1;
    }

    let penalty = 0;
    /*

    // other penalties or rewards
    // e.g. grid snap

    const K = keptLinks.length;
    const keptPairs = (K * (K - 1)) / 2;
    const intersections = countIntersections(nodes, keptLinks);
    const interNorm = keptPairs > 0 ? intersections / keptPairs : 0;
    const interPenalty = interNorm * interNorm;
    penalty += interPenalty * 1;

    // grid snap penalty
    if (snapping && snapStrategy !== "pre") {
      penalty += getSnapPenalty(nodes, gridCount) * 1;
    }

    // angular edges
    penalty +=
      getAnglePenalty(nodes, keptLinks, {
        snapDegrees: 45 / 2,
      }) * 1;

    // penalize when nodes cluster together
    const step = 2 / (gridCount - 1);
    const stepCount = 1;
    const minDistance = step * stepCount;
    penalty +=
      getProximitiyPenalty(nodes, {
        minDistance,
      }) * 1;

    // test
    // penalty +=
    //   getNodeCountPenalty(nodes, {
    //     preferredCount: 4,
    //     weight: 0.001,
    //   }) * 1;

    // degree penalty
    penalty +=
      getHubPenalty(nodes, degree, {
        minDegree: 1,
        maxDegree: 3,
      }) * 1;
*/
    const penaltyScore = 0;
    return -(error + penalty * penaltyScore);
  }

  function update(cell) {
    for (let i = 0; i < stepsPerFrame; i++) {
      const {
        optimizer,
        imageData: targetImageData,
        imageDistance: targetDist,
      } = cell;
      // evolve the searcher
      const solutions = optimizer.ask();
      let localMax = -Infinity,
        bestLocalIdx = 0;
      for (let i = 0; i < optimizer.populationCount; i++) {
        const solution = optimizer.getSolutionAt(solutions, i);
        const f = fitness(solution, targetImageData, targetDist, {
          ...cell.options,
          // snapping: true,
          gridCount,
          blurRadius,
        });
        fitnesses[i] = f;
        if (f > localMax) {
          localMax = f;
          bestLocalIdx = i;
        }
      }
      optimizer.tell(fitnesses);

      if (localMax > cell.bestFitness) {
        cell.bestFitness = localMax;
        // Important: remember to slice() this for a deep copy
        const center = optimizer.getSolutionAt(solutions, bestLocalIdx).slice();
        cell.bestSolution = {
          center,
          options: { ...cell.options },
        };
      }

      // measure "convergence" by how much bestFitness moved since last tick
      let delta;
      if (!isFinite(cell.prevScore)) {
        cell.prevScore = localMax;
        delta = 0;
      } else {
        delta = Math.abs(localMax - cell.prevScore);
        cell.prevScore = localMax;
      }

      // 2) push into short & long windows
      cell.deltaShort.push(delta);
      if (cell.deltaShort.length > shortWindow) cell.deltaShort.shift();

      cell.deltaLong.push(delta);
      if (cell.deltaLong.length > longWindow) cell.deltaLong.shift();

      // reached the long window, start checking
      if (cell.deltaLong.length === longWindow) {
        // the average delta of the short is less than the long,
        // so we are converging, otherwise reset the stagnation count
        const avgShort =
          cell.deltaShort.reduce((a, b) => a + b, 0) / cell.deltaShort.length;
        const avgLong =
          cell.deltaLong.reduce((a, b) => a + b, 0) / cell.deltaLong.length;
        if (avgShort < avgLong) {
          cell.stagnation++;
        } else {
          cell.stagnation = 0;
        }
      }
      // if it's been plateaued for too long, reset just this cell
      if (cell.stagnation >= patience) {
        restart(cell);
      }
    }
  }
}, settings);

export function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

export function convertRGBAToOKL(rgba) {
  const pixelCount = rgba.length / 4;
  const imageL = new Float32Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const srcIdx = i * 4;
    const dstIdx = i * 1;
    const r = rgba[srcIdx] / 255;
    const g = rgba[srcIdx + 1] / 255;
    const b = rgba[srcIdx + 2] / 255;
    const lab = Color.convert([r, g, b], Color.sRGB, Color.OKLab);
    imageL[dstIdx] = lab[0];
  }
  return imageL;
}

function snapToGrid([x, y], count, width, height) {
  // single‐point grid sits at canvas center
  if (count <= 1) {
    return [width / 2, height / 2];
  }

  // how far apart each grid‐point is, in pixels
  const stepX = width / (count - 1);
  const stepY = height / (count - 1);

  // nearest grid index in each axis
  let ix = Math.round(x / stepX);
  let iy = Math.round(y / stepY);

  // clamp to valid range [0, count-1]
  ix = Math.min(Math.max(ix, 0), count - 1);
  iy = Math.min(Math.max(iy, 0), count - 1);

  // return the exact pixel position of that grid index
  return [ix * stepX, iy * stepY];
}

// uv is -1...1 normalized
function snapUVToGrid([u, v], count) {
  if (count <= 1) {
    return [0, 0]; // single-point grid at center
  }

  // step between grid points in UV-space
  const step = 2 / (count - 1); // e.g. count=5 → step=0.5

  // convert from [-1..1] to [0..count-1] index space, round
  let ix = Math.round((u + 1) / step);
  let iy = Math.round((v + 1) / step);

  // clamp indices to [0, count-1]
  ix = Math.min(Math.max(ix, 0), count - 1);
  iy = Math.min(Math.max(iy, 0), count - 1);

  // convert back to [-1..1]
  const uSnapped = ix * step - 1;
  const vSnapped = iy * step - 1;

  return [uSnapped, vSnapped];
}

function getProximitiyPenalty(nodes, options = {}) {
  // if distance is less than minDist, apply a penalty
  const { minDistance = Infinity, weight = 1 } = options;
  const md2 = minDistance * minDistance;
  const N = nodes.length;
  let proxPenalty = 0;

  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const [u1, v1] = nodes[i];
      const [u2, v2] = nodes[j];
      const du = u1 - u2,
        dv = v1 - v2;
      const d2 = du * du + dv * dv;
      if (d2 < md2) {
        const deficit = Math.sqrt(d2) - minDistance; // negative
        proxPenalty += weight * -deficit * -deficit;
      }
    }
  }
  // normalize
  const numPairs = (N * (N - 1)) / 2;
  proxPenalty = numPairs > 0 ? proxPenalty / numPairs : 0;
  return proxPenalty;
}

function getNodeCountPenalty(nodes, options = {}) {
  const {
    preferredCount = 4,
    weight = 0.01, // small value to nudge simplicity preference
  } = options;

  const excess = nodes.length - preferredCount;
  return excess > 0 ? weight * excess : 0;
}
function getSnapPenalty(nodes, count = 4) {
  let penalty = 0;

  if (count > 1) {
    for (const [u, v] of nodes) {
      // UV‐step between adjacent grid lines in [-1..1] space
      const step = 2 / (count - 1); // e.g. count=5 → step=0.5

      // find the nearest grid‐index for u and v
      const ix = Math.round((u + 1) / step);
      const iy = Math.round((v + 1) / step);

      // turn that index back into a grid‐aligned coordinate
      const uGrid = ix * step - 1;
      const vGrid = iy * step - 1;

      // distance in UV‐space
      const du = u - uGrid;
      const dv = v - vGrid;

      // accumulate a soft‐penalty
      penalty += du * du + dv * dv;
    }
  } else {
    // Single‐point grid at center [0,0]: penalize distance from center
    for (const [u, v] of nodes) {
      penalty += u * u + v * v;
    }
  }
  // normalize to node count
  penalty /= nodes.length;
  return penalty;
}

function getAnglePenalty(nodes, links, options = {}) {
  const { snapDegrees = 45, weight = 1 } = options;

  const snapRadians = (snapDegrees * Math.PI) / 180;
  let totalPenalty = 0;
  let totalLength = 0;

  for (const { edge } of links) {
    const [a, b] = edge;
    const [x1, y1] = nodes[a];
    const [x2, y2] = nodes[b];

    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length === 0) continue;

    let angle = Math.atan2(dy, dx);
    if (angle < 0) angle += 2 * Math.PI;

    const snappedAngle = Math.round(angle / snapRadians) * snapRadians;
    const angleDiff = angle - snappedAngle;

    // Longer links are penalized more heavily for angular drift
    const weightedPenalty = angleDiff * angleDiff * length;

    totalPenalty += weightedPenalty;
    totalLength += length;
  }

  // Normalize to total length to keep consistent scaling
  return totalLength > 0 ? (weight * totalPenalty) / totalLength : 0;
}

function getHubPenalty(nodes, degree, options = {}) {
  const N = nodes.length;
  const { weight = 1, minDegree, maxDegree } = options;

  const center = (minDegree + maxDegree) / 2; // middle of your band
  const halfW = (maxDegree - minDegree) / 2; // half‐width of band

  // accumulate penalty
  let hubPenalty = 0;
  for (let i = 0; i < N; i++) {
    const d = degree[i];

    // distance from center, using sqrt to avoid non‐diff abs
    // const dist = Math.sqrt((d - center) * (d - center));
    // how far outside the band [–halfW, halfW] we are
    // const excess = dist - halfW;
    // // soft‐ReLU via SoftPlus: ln(1 + e^excess)
    // const smoothExcess = Math.log1p(Math.exp(excess));
    // quadratic cost on that
    // hubPenalty += weight * smoothExcess * smoothExcess;

    if (d < minDegree) {
      const deficit = minDegree - d; // how many too few
      // quadratic:
      hubPenalty += weight * (deficit * deficit);
    } else if (d > maxDegree) {
      const excess = d - maxDegree; // how many too many
      // quadratic:
      hubPenalty += weight * (excess * excess);
    }
    // if in [minDegree..maxDegree], no penalty
  }

  // normalize so it scales invariantly with node‐count
  hubPenalty /= N;
  return hubPenalty;
}

function getImageErrorChamfer(
  nodes,
  links,
  targetImageData,
  targetDist,
  targetWidth,
  targetHeight,
  tmpCtx,
  options = {}
) {
  const { targetLineScale = 1, pixelWeight = 1, chamferWeight = 1 } = options;

  // 1) render your graph into a mask
  tmpCtx.clearRect(0, 0, targetWidth, targetHeight);
  tmpCtx.fillStyle = "white";
  tmpCtx.fillRect(0, 0, targetWidth, targetHeight);
  drawGraph(tmpCtx, {
    nodes,
    links,
    lineScale: targetLineScale,
    width: targetWidth,
    height: targetHeight,
    drawNodes: false,
    thresholdWeights: false,
  });

  const cur = tmpCtx.getImageData(0, 0, targetWidth, targetHeight);
  const renderedMask = [];
  for (let y = 0; y < targetHeight; y++) {
    renderedMask[y] = [];
    for (let x = 0; x < targetWidth; x++) {
      const i = (y * targetWidth + x) * 4;
      renderedMask[y][x] = cur.data[i] < 128 ? 1 : 0; // black=on
    }
  }

  // 2) per-pixel L2
  let pixelErr = 0;
  const tgt = targetImageData.data;
  const RGBA = cur.data;
  for (let i = 0; i < targetWidth * targetHeight; i++) {
    const d = RGBA[4 * i] / 255 - tgt[4 * i] / 255;
    pixelErr += d * d;
  }
  pixelErr /= targetWidth * targetHeight;

  // 3) asymmetric chamfer: rendered→target
  let chamferRT = 0,
    cntRT = 0;
  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      if (renderedMask[y][x] === 1 && tgt[(y * targetWidth + x) * 4] === 255) {
        chamferRT += targetDist[y][x];
        cntRT++;
      }
    }
  }
  chamferRT = cntRT > 0 ? chamferRT / cntRT : 0;

  // 4) combine
  return pixelWeight * pixelErr + chamferWeight * chamferRT;
}

function getImageError(
  nodes,
  links,
  targetImageData,
  targetWidth,
  targetHeight,
  tmpCtx,
  targetLineScale = 1,
  blurRadius = 0
) {
  let error = 0;
  tmpCtx.clearRect(0, 0, targetWidth, targetHeight);
  tmpCtx.fillStyle = "white";
  tmpCtx.fillRect(0, 0, targetWidth, targetHeight);
  drawGraph(tmpCtx, {
    nodes,
    links,
    lineScale: targetLineScale,
    width: targetWidth,
    height: targetHeight,
    drawNodes: false,
    thresholdWeights: false,
  });
  const curImageData = tmpCtx.getImageData(0, 0, targetWidth, targetHeight);
  if (blurRadius > 0) {
    stackblur(curImageData.data, targetWidth, targetHeight, blurRadius);
  }

  const pixelCount = curImageData.data.length / 4;
  for (let i = 0; i < pixelCount; i++) {
    const base = i * 4;
    const r0 = curImageData.data[base];
    const r1 = targetImageData.data[base];
    const d = r0 / 0xff - r1 / 0xff;
    error += d * d;
  }
  return error / pixelCount;
}

function drawGraph(context, opts = {}) {
  const {
    nodes,
    links,
    width,
    height,
    fillStyle = "black",
    drawNodes = false,
    useWeightScaling = true,
    thresholdWeights = false,
    lineScale = 1,
    weightThreshold = 0.1,
    snapping = false,
    gridCount = 4,
    stylize = false,
  } = opts;

  const positions = nodes.map((uv) => {
    const x = width / 2 + (uv[0] * width) / 2;
    const y = height / 2 + (uv[1] * height) / 2;
    return snapping ? snapToGrid([x, y], gridCount, width, height) : [x, y];
  });

  const lineWidth = Math.min(width, height) * 0.01;
  const threshold = getThreshold(links, weightThreshold);

  for (let { edge, weight } of links) {
    if (weight <= 1e-6) continue;

    if (thresholdWeights && weight < threshold) continue;

    const [a, b] = edge;
    const [x0, y0] = positions[a];
    const [x1, y1] = positions[b];

    const styleScale = stylize ? 8 : 1;
    context.strokeStyle = fillStyle;
    context.lineWidth =
      styleScale * lineScale * lineWidth * (useWeightScaling ? weight : 1);
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(x0, y0);
    context.lineTo(x1, y1);
    context.stroke();
  }

  if (drawNodes) {
    for (let node of positions) {
      const [x, y] = node;
      context.strokeStyle = context.fillStyle = stylize ? "white" : "black";
      context.beginPath();
      const radius = lineWidth * 2;
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.lineWidth = lineWidth;
      if (stylize) context.fill();
      else context.stroke();
    }
  }
}

function getThreshold(links, weightThreshold) {
  return weightThreshold;
  // return adaptiveThresholdPercentile(links, 0.75);
}

function adaptiveThresholdPercentile(links, p = 0.7) {
  // p = fraction below threshold, e.g. 0.7 → keep top 30%
  const ws = links.map((l) => l.weight).sort((a, b) => a - b);
  const idx = Math.floor(ws.length * p);
  return ws[Math.min(idx, ws.length - 1)];
}

function countIntersections(nodes, links) {
  let count = 0;
  for (let i = 0; i < links.length; i++) {
    const { edge: e0 } = links[i];
    const [a, b] = e0;
    for (let j = i + 1; j < links.length; j++) {
      const { edge: e1 } = links[j];
      const [c, d] = e1;
      // skip if they share a node
      if (a === c || a === d || b === c || b === d) continue;
      if (segmentsIntersectInterior(nodes[a], nodes[b], nodes[c], nodes[d])) {
        count++;
      }
    }
  }
  return count;
}

/**
 * Returns true only if segment p1→p2 and p3→p4 cross in their interiors.
 * Touching at endpoints (like a "Y" joint) will return false.
 */
function segmentsIntersectInterior(p1, p2, p3, p4) {
  const sa = intersectLineSegmentLineSegmenInterior(p1, p2, p3, p4);
  // intersectLineSegmentLineSegment returns `sa` for the first segment
  // and calculates `sb` internally — we’ll tweak it below to return both.
  if (!sa) return false;
  const { sa: tA, sb: tB } = sa;
  // strictly between 0 and 1
  return tA > 0 && tA < 1 && tB > 0 && tB < 1;
}

function intersectLineSegmentLineSegmenInterior(p1, p2, p3, p4) {
  const d21x = p2[0] - p1[0];
  const d21y = p2[1] - p1[1];
  const d43x = p4[0] - p3[0];
  const d43y = p4[1] - p3[1];

  const d = d21x * d43y - d21y * d43x;
  if (d === 0) return null; // parallel or collinear

  const nb = (p1[1] - p3[1]) * d21x - (p1[0] - p3[0]) * d21y;
  const sb = nb / d;
  if (sb <= 0 || sb >= 1) return null;

  const na = (p1[1] - p3[1]) * d43x - (p1[0] - p3[0]) * d43y;
  const sa = na / d;
  if (sa <= 0 || sa >= 1) return null;

  return { sa, sb };
}

function segmentsIntersect(p1, p2, p3, p4) {
  const t = intersectLineSegmentLineSegment(p1, p2, p3, p4);
  return t >= 0 && t <= 1;
}

function intersectLineSegmentLineSegment(p1, p2, p3, p4) {
  // Reference:
  // https://github.com/evil-mad/EggBot/blob/master/inkscape_driver/eggbot_hatch.py
  const d21x = p2[0] - p1[0];
  const d21y = p2[1] - p1[1];
  const d43x = p4[0] - p3[0];
  const d43y = p4[1] - p3[1];

  // denominator
  const d = d21x * d43y - d21y * d43x;
  if (d === 0) return -1;

  const nb = (p1[1] - p3[1]) * d21x - (p1[0] - p3[0]) * d21y;
  const sb = nb / d;
  if (sb < 0 || sb > 1) return -1;

  const na = (p1[1] - p3[1]) * d43x - (p1[0] - p3[0]) * d43y;
  const sa = na / d;
  if (sa < 0 || sa > 1) return -1;
  return sa;
}

/**
 * Given an ImageData (RGBA), build a 2D mask array of 0/1:
 *   mask[y][x] === 1 if the pixel is “on” (black), else 0.
 */
function buildBinaryMask(imageData) {
  const { data, width, height } = imageData;
  const mask = Array.from({ length: height }, () => new Uint8Array(width));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // threshold on the red channel (all channels same in BW)
      mask[y][x] = data[i] < 128 ? 1 : 0;
    }
  }
  return mask;
}

/**
 * Compute a full‐image distance transform:
 *   dt[y][x] = distance in pixels from (x,y) to nearest mask[y][x] === 1.
 *
 * Uses the classic 2-pass algorithm (O(n)) for approximate Euclidean distances.
 */
function computeDistanceTransform(mask) {
  const height = mask.length;
  const width = mask[0].length;
  const INF = width + height; // “infinity”
  const dt = Array.from({ length: height }, () => new Float32Array(width));

  // Initialize: zero where mask=1, INF elsewhere
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      dt[y][x] = mask[y][x] ? 0 : INF;
    }
  }

  // Forward pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = dt[y][x];
      if (v === 0) continue;
      // examine neighbors: (x-1,y), (x,y-1), (x-1,y-1), (x+1,y-1)
      if (x > 0) dt[y][x] = Math.min(dt[y][x], dt[y][x - 1] + 1);
      if (y > 0) dt[y][x] = Math.min(dt[y][x], dt[y - 1][x] + 1);
      if (x > 0 && y > 0)
        dt[y][x] = Math.min(dt[y][x], dt[y - 1][x - 1] + Math.SQRT2);
      if (x < width - 1 && y > 0)
        dt[y][x] = Math.min(dt[y][x], dt[y - 1][x + 1] + Math.SQRT2);
    }
  }

  // Backward pass
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const v = dt[y][x];
      // examine neighbors: (x+1,y), (x,y+1), (x+1,y+1), (x-1,y+1)
      if (x < width - 1) dt[y][x] = Math.min(dt[y][x], dt[y][x + 1] + 1);
      if (y < height - 1) dt[y][x] = Math.min(dt[y][x], dt[y + 1][x] + 1);
      if (x < width - 1 && y < height - 1)
        dt[y][x] = Math.min(dt[y][x], dt[y + 1][x + 1] + Math.SQRT2);
      if (x > 0 && y < height - 1)
        dt[y][x] = Math.min(dt[y][x], dt[y + 1][x - 1] + Math.SQRT2);
    }
  }

  return dt;
}
