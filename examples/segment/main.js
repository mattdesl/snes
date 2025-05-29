import canvasSketch from "canvas-sketch";
import * as Color from "@texel/color";
import Random from "canvas-sketch-util/random.js";
import sNES from "../../index.js";
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
  const targetSize = 64;
  // const glyphs = "G".toUpperCase().split("");
  const glyphs = "ABCDE".split("");

  const columns = 5; // Math.ceil(Math.sqrt(glyphs.length));
  const rows = Math.ceil(glyphs.length / columns);
  const cellWidth = props.width / columns;
  const cellHeight = cellWidth; // square
  props.update({ dimensions: [cellWidth * columns, cellHeight * rows] });

  const populationCount = 16;
  const fitnesses = new Float32Array(populationCount);
  const blurRadius = 0;
  // const gridCount = 16;

  const lineStyle = "segments"; // segments, polyline, crosshairs
  const backgroundColor = lineStyle == "crosshairs" ? "black" : "white";
  const foregroundColor = lineStyle == "crosshairs" ? "white" : "black";
  const globalAlpha = lineStyle == "crosshairs" ? 0.25 : 1;
  const targetLineScale = lineStyle == "crosshairs" ? 1 : 1;

  const numFeatures = 32;
  const paramsPerFeature = {
    segments: 4,
    polylines: 2,
    crosshairs: 4,
  }[lineStyle];

  const convergenceThreshold = 1e-3; // how small ∆fitness must be to count as “converged”
  const patienceCount = 20; // how many consecutive small ∆’s before a restart
  const restartAfterTicks = lineStyle == "crosshairs" ? 10000 : 1000; // how many ticks before a restart

  const stepsPerFrame = 2;

  const alpha = 0.25; // learning rate

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
    tmpCtx.fillStyle = backgroundColor;
    tmpCtx.fillRect(0, 0, targetSize, targetSize);
    tmpCtx.font = `${targetSize * fontScale}px "Andale Mono", monospace`;
    tmpCtx.textAlign = "center";
    tmpCtx.textBaseline = "top";

    const metrics = tmpCtx.measureText(glyph);
    const yoff = metrics.fontBoundingBoxAscent
      ? (0.5 / fontScale) * metrics.fontBoundingBoxAscent
      : 0;
    tmpCtx.fillStyle = foregroundColor;
    tmpCtx.fillText(glyph, targetSize / 2, 0 + yoff);

    const targetData = tmpCtx.getImageData(0, 0, targetSize, targetSize);
    if (blurRadius > 0)
      stackblur(targetData.data, targetSize, targetSize, blurRadius);

    const options = {
      numFeatures,
      // gridCount,
      solutionLength: numFeatures * paramsPerFeature,
    };

    const cell = {
      ticks: 0,
      options,
      character: glyph,
      canvas: tmpCanvas,
      context: tmpCtx,
      imageData: targetData,
      bestFitness: -Infinity,
      bestSolution: {
        center: new Float32Array(options.solutionLength),
        options: { ...options },
      },
      prevScore: -Infinity,
      consecLowDeltas: 0, // reset our low‐delta counter
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
      context.fillStyle = backgroundColor;
      context.fillRect(0, 0, width, height);

      // layout into square
      // const columns = Math.ceil(Math.sqrt(cells.length));
      // const rows = Math.ceil(cells.length / columns);
      // const cellWidth = width / columns;
      // const cellHeight = cellWidth; //height / rows;

      // drawGridPoints(context, {
      //   width: width,
      //   height: height,
      //   count: gridCount * columns,
      //   radius: Math.min(cellWidth, cellHeight) * 0.02,
      //   alpha: 0.5,
      // });

      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const x = (i % columns) * cellWidth;
        const y = Math.floor(i / columns) * cellHeight;
        context.save();
        context.translate(x, y);

        if (!exporting) {
          context.globalAlpha = 0.25;
          tmpCtx.putImageData(cell.imageData, 0, 0);
          context.drawImage(tmpCtx.canvas, 0, 0, cellWidth, cellHeight);
          context.globalAlpha = 1;
          context.strokeRect(0, 0, cellWidth, cellHeight);
        }

        // drawGridPoints(context, {
        //   width: cellWidth,
        //   height: cellHeight,
        //   count: gridCount,
        //   radius: Math.min(cellWidth, cellHeight) * 0.02,
        //   alpha: 0.1,
        // });
        const modes = [
          // {
          //   alpha: 0.1,
          //   solution: cell.optimizer.center,
          //   options: cell.options,
          //   lineScale: targetLineScale,
          // },
          {
            lineScale: 1,
            alpha: 1,
            solution: cell.bestOptimizer.center,
            options: cell.bestOptimizerOptions,
            // solution: cell.bestSolution.center,
            // options: cell.bestSolution.options,
          },
        ];
        for (let { alpha, solution, options, lineScale = 1 } of modes) {
          // context.globalCompositeOperation = "lighter";
          drawSolution(
            decodeSolution(solution, {
              ...options,
            }),
            {
              context,
              alpha: lineStyle == "crosshairs" ? globalAlpha : alpha,
              x: 0,
              y: 0,
              color: foregroundColor,
              width: cellWidth,
              height: cellHeight,
              lineScale,
            }
          );
          // context.globalCompositeOperation = "source-over";
        }

        context.restore();
      }
    },
  };

  function restart(cell) {
    cell.ticks = 0;

    cell.prevScore = -Infinity;
    cell.consecLowDeltas = 0; // reset our low‐delta counter
    // re‑initialize the convergence trackers
    // cell.prevScore = -Infinity;
    // cell.stagnation = 0;
    // cell.deltaShort.length = 0;
    // cell.deltaLong.length = 0;

    // re-initialize the optimizer features
    cell.optimizer = sNES({
      populationCount,
      solutionLength: cell.options.solutionLength,
      alpha,
      random: Random.value,
    });
    cell.bestOptimizer = cell.bestOptimizer || cell.optimizer;
    cell.bestOptimizerOptions = cell.bestOptimizerOptions || {
      ...cell.options,
    };
    for (let i = 0; i < cell.optimizer.center.length; i++) {
      // randomize
      // cell.optimizer.center[i] = cell.optimizer.prng.nextGaussian() * 1;
    }
  }

  function param(x) {
    return Math.tanh(x / 2);
  }

  function decodeSolution(solution, options = {}) {
    const { numFeatures, snapping = false, gridCount = 4 } = options;
    let idx = 0;

    const segments = [];

    if (lineStyle === "segments") {
      for (let i = 0; i < numFeatures; i++) {
        const segment = [];
        for (let k = 0; k < 2; k++) {
          const x = param(solution[idx++]);
          const y = param(solution[idx++]);
          segment.push([x, y]);
        }
        const weight = 1;
        segments.push({ line: segment, weight });
      }
    } else if (lineStyle === "crosshairs") {
      const features = [];
      for (let i = 0; i < numFeatures; i++) {
        const x = param(solution[idx++]);
        const y = param(solution[idx++]);
        const alpha = sigmoid(solution[idx++]);
        const theta = param(solution[idx++]) * Math.PI; // -π..π
        features.push({ point: [x, y], alpha, theta });
      }
      return features;
    } else {
      const points = [];
      for (let i = 0; i < numFeatures; i++) {
        const x = param(solution[idx++]);
        const y = param(solution[idx++]);
        points.push([x, y]);
      }

      let lastPoint = points[0];
      for (let i = 1; i < points.length; i++) {
        const point = points[i];
        const segment = [lastPoint.slice(), point.slice()];
        lastPoint = point;
        segments.push({ line: segment, weight: 1 });
      }
    }

    if (snapping) {
      return segments.map(({ line, weight }) => {
        line = line.map((point) => snapUVToGrid(point, gridCount));
        return { line, weight };
      });
    } else {
      return segments;
    }
  }

  function fitness(solution, targetImageData, options = {}) {
    const { snapStrength = 1 } = options;
    let error = 0;

    let features = decodeSolution(solution, options);
    error += getImageError(
      features,
      drawSolution,
      targetImageData,
      targetSize,
      targetSize,
      tmpCtx,
      targetLineScale,
      blurRadius,
      {
        backgroundColor,
        foregroundColor,
        alpha: globalAlpha,
      }
    );

    if (lineStyle !== "crosshairs") {
      const segments = features;
      // penalize solutions with tiny segments
      const minSegLen = 0.1; // normalized -1..1
      let lenPenaltySum = 0;
      for (let { line } of segments) {
        const [[x0, y0], [x1, y1]] = line;
        const length = Math.hypot(x1 - x0, y1 - y0);
        if (length < minSegLen) {
          const d = minSegLen - length;
          lenPenaltySum += d * d;
        }
      }
      // divide by number of segments → penalty per segment
      error += (lenPenaltySum / segments.length) * 100;

      // penalize solutions where points are appearing outside the center circle
      const centerRad = 0.75; // radius inside which there's no penalty
      const centerWeight = 100; // strength of the pull
      let centerPenaltySum = 0;
      for (let { line } of segments) {
        for (let pt of line) {
          const [x, y] = pt;
          // dist from center
          const dist = Math.hypot(x, y);
          if (dist > centerRad) {
            const d = dist - centerRad;
            centerPenaltySum += d * d;
          }
        }
      }
      const avgCenterPenalty = centerPenaltySum / (segments.length * 2);
      error += avgCenterPenalty * centerWeight;

      // const snapPenalty = getSnapPenalty(segments, options.gridCount);
      // error += snapPenalty * 1;

      // error += getAnglePenalty(segments, {
      //   snapDegrees: 45 / 1,
      //   weight: 1,
      // });
    }

    return -error;
  }

  function update(cell) {
    for (let i = 0; i < stepsPerFrame; i++) {
      const { optimizer, imageData: targetImageData } = cell;
      // evolve the searcher
      const solutions = optimizer.ask();
      let localMax = -Infinity,
        bestLocalIdx = 0;
      for (let i = 0; i < optimizer.populationCount; i++) {
        const solution = optimizer.getSolutionAt(solutions, i);
        const f = fitness(solution, targetImageData, {
          ...cell.options,
          snapping: false,
          // gridCount,
          snapStrength: isFinite(restartAfterTicks)
            ? cell.ticks / restartAfterTicks
            : 0,
        });
        fitnesses[i] = f;
        if (f > localMax) {
          localMax = f;
          bestLocalIdx = i;
        }
      }
      optimizer.tell(fitnesses);

      if (localMax > cell.bestFitness) {
        cell.bestOptimizer = optimizer; // keep a reference to the best optimizer
        cell.bestOptimizerOptions = { ...cell.options }; // keep a reference to the best options

        // Important: remember to slice() this for a deep copy
        const center = optimizer.getSolutionAt(solutions, bestLocalIdx).slice();
        cell.bestFitness = localMax;
        cell.bestSolution = {
          center,
          options: { ...cell.options },
        };
      }

      // measure ∆fitness and decide whether to restart
      let delta;
      if (!isFinite(cell.prevScore)) {
        delta = Infinity; // first tick, don’t count as “small”
      } else {
        delta = Math.abs(localMax - cell.prevScore);
      }
      cell.prevScore = localMax;

      // bump or reset our consecutive‐low‐delta counter
      if (delta < convergenceThreshold) {
        cell.consecLowDeltas++;
      } else {
        cell.consecLowDeltas = 0;
      }

      // if it's been plateaued for too long, reset just this cell
      if (
        cell.consecLowDeltas >= patienceCount ||
        cell.ticks >= restartAfterTicks
      ) {
        restart(cell);
      }
      cell.ticks++;
    }
  }

  function drawSolution(features, opts = {}) {
    if (lineStyle == "crosshairs") {
      drawCrosshairs({ ...opts, features });
    } else {
      drawSegments({ ...opts, segments: features });
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

function drawCrosshairs({
  context,
  color = "white",
  compositeOperation = "lighter",
  width,
  height,
  features,
  alpha = 1,
  lineScale = 1,
}) {
  context.globalCompositeOperation = compositeOperation;
  const lineWidth = Math.min(width, height) * 0.005 * lineScale;
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  for (let { point, alpha: fAlpha, theta = 0 } of features) {
    const a = alpha * fAlpha;
    if (a <= 1e-5) continue;

    const cx = width / 2,
      cy = height / 2;
    const x = cx + point[0] * cx;
    const y = cy + point[1] * cy;

    for (let off of [0, Math.PI / 2]) {
      const dist = Math.hypot(width, height) * 1;
      const [px, py] = [x, y];
      const t = theta + off;
      const dir = [Math.cos(t), Math.sin(t)];
      const p3 = [px + dir[0] * dist, py + dir[1] * dist];
      const p4 = [px - dir[0] * dist, py - dir[1] * dist];
      const line = [p3, p4];
      context.globalAlpha = a;

      // const line = clipLineToBounds([x, y], theta, width, height);
      if (line) {
        context.globalAlpha = a;
        context.beginPath();
        line.forEach((p) => context.lineTo(...p));
        context.stroke();
      }
    }

    // context.beginPath();
    // context.moveTo(x, 0);
    // context.lineTo(x, height);
    // context.moveTo(0, y);
    // context.lineTo(width, y);
    // context.stroke();
  }

  // for (let { point, alpha: fAlpha } of features) {
  //   const a = alpha;
  //   if (a <= 1e-5) continue;
  //   context.globalAlpha = alpha;
  //   context.beginPath();

  //   const cx = width / 2,
  //     cy = height / 2;
  //   const x = cx + point[0] * cx;
  //   const y = cy + point[1] * cy;

  //   const units = Math.min(width, height) * 0.025;

  //   context.moveTo(x - units, y);
  //   context.lineTo(x + units, y);

  //   context.moveTo(x, y - units);
  //   context.lineTo(x, y + units);

  //   context.stroke();
  // }

  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1;
}

function drawSegments({
  context,
  color = "black",
  width,
  height,
  segments,
  alpha = 1,
  lineScale = 1,
}) {
  const lineWidth = Math.min(width, height) * 0.01 * lineScale;
  for (let { line, weight } of segments) {
    if (weight <= 1e-5) continue;
    context.globalAlpha = alpha;
    context.beginPath();
    context.lineWidth = lineWidth;
    context.lineCap = "round";
    context.strokeStyle = color;
    const cx = width / 2,
      cy = height / 2;
    line.forEach((p) => context.lineTo(cx + p[0] * cx, cy + p[1] * cy));
    context.stroke();
  }
  context.globalAlpha = 1;
}

function getImageError(
  features,
  draw,
  targetImageData,
  targetWidth,
  targetHeight,
  tmpCtx,
  targetLineScale = 1,
  blurRadius = 0,
  drawOpts = {}
) {
  const { foregroundColor = "black", backgroundColor = "white" } = drawOpts;
  let error = 0;
  tmpCtx.clearRect(0, 0, targetWidth, targetHeight);
  tmpCtx.fillStyle = backgroundColor;
  tmpCtx.fillRect(0, 0, targetWidth, targetHeight);
  draw(features, {
    color: foregroundColor,
    context: tmpCtx,
    width: targetWidth,
    height: targetHeight,
    lineScale: targetLineScale,
    ...drawOpts,
  });
  const curImageData = tmpCtx.getImageData(0, 0, targetWidth, targetHeight);
  if (blurRadius > 0)
    stackblur(curImageData.data, targetWidth, targetHeight, blurRadius);

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

// function createSevenSegmentDisplay() {
//   return {
//     draw({ context, x = 0, y = 0, width, height, patch }) {
//       const thicknessRatio = 0.1; // Controls segment thickness relative to size
//       const thickness = Math.min(width, height) * thicknessRatio;
//       const w = width;
//       const h = height;
//       const t = thickness;
//       const cx = x;
//       const cy = y;

//       // context.fillStyle = "gray";
//       // context.fillRect(0, 0, width, height);

//       // Precomputed segment positions (A to G)
//       const segments = [
//         // A (top horizontal)
//         [cx + t, cy, cx + w - t, cy],
//         // B (top-right vertical)
//         [cx + w, cy + t, cx + w, cy + h / 2 - t / 2],
//         // C (bottom-right vertical)
//         [cx + w, cy + h / 2 + t / 2, cx + w, cy + h - t],
//         // D (bottom horizontal)
//         [cx + t, cy + h, cx + w - t, cy + h],
//         // E (bottom-left vertical)
//         [cx, cy + h / 2 + t / 2, cx, cy + h - t],
//         // F (top-left vertical)
//         [cx, cy + t, cx, cy + h / 2 - t / 2],
//         // G (middle horizontal)
//         [cx + t, cy + h / 2, cx + w - t, cy + h / 2],
//       ];

//       context.strokeStyle = "black";
//       context.lineCap = "square";
//       context.lineWidth = thickness;
//       const alphas = [0.5, 1];
//       for (let alpha of alphas) {
//         context.globalAlpha = 0.5;
//         for (let i = 0; i < 7; i++) {
//           if (alpha == 0.5 || patch[i]) {
//             const [x1, y1, x2, y2] = segments[i];
//             context.beginPath();
//             context.moveTo(x1, y1);
//             context.lineTo(x2, y2);
//             context.stroke();
//           }
//         }
//         context.globalAlpha = 1;
//       }
//     },
//   };
// }

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

function getSnapPenalty(segments, gridCount = 4) {
  let snapPenaltySum = 0;
  let endpointCount = 0;
  for (let { line } of segments) {
    for (let pt of line) {
      const [u, v] = pt;
      const [uGrid, vGrid] = snapUVToGrid(pt, gridCount);
      const du = u - uGrid;
      const dv = v - vGrid;
      snapPenaltySum += du * du + dv * dv;
      endpointCount++;
    }
  }
  const avgSnapPenalty = snapPenaltySum / endpointCount;
  return avgSnapPenalty;

  // let penalty = 0;

  // if (count > 1) {
  //   for (const [u, v] of nodes) {
  //     // UV‐step between adjacent grid lines in [-1..1] space
  //     const step = 2 / (count - 1); // e.g. count=5 → step=0.5

  //     // find the nearest grid‐index for u and v
  //     const ix = Math.round((u + 1) / step);
  //     const iy = Math.round((v + 1) / step);

  //     // turn that index back into a grid‐aligned coordinate
  //     const uGrid = ix * step - 1;
  //     const vGrid = iy * step - 1;

  //     // distance in UV‐space
  //     const du = u - uGrid;
  //     const dv = v - vGrid;

  //     // accumulate a soft‐penalty
  //     penalty += du * du + dv * dv;
  //   }
  // } else {
  //   // Single‐point grid at center [0,0]: penalize distance from center
  //   for (const [u, v] of nodes) {
  //     penalty += u * u + v * v;
  //   }
  // }
  // // normalize to node count
  // penalty /= nodes.length;
  // return penalty;
}

function getAnglePenalty(segments, options = {}) {
  const { snapDegrees = 45, weight = 1, weightByLength = false } = options;

  const snapRadians = (snapDegrees * Math.PI) / 180;
  let penalty = 0;

  for (const { line } of segments) {
    const [a, b] = line;
    const [x1, y1] = a;
    const [x2, y2] = b;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length === 0) continue;

    const angle = Math.atan2(dy, dx);
    const snappedAngle = Math.round(angle / snapRadians) * snapRadians;
    const angleDelta = Color.degToRad(
      Color.deltaAngle(Color.radToDeg(angle), Color.radToDeg(snappedAngle))
    );

    penalty += angleDelta * angleDelta * weight;
  }

  return penalty / segments.length;
}

function clipLineToBounds(point, theta, width, height) {
  const bVerts = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];
  const bEdges = [
    [bVerts[0], bVerts[1]],
    [bVerts[1], bVerts[2]],
    [bVerts[2], bVerts[3]],
    [bVerts[3], bVerts[0]],
  ];
  if (point[0] < 0 || point[0] > width || point[1] < 0 || point[1] > height) {
    return null;
  }
  const hits = [];
  for (let edge of bEdges) {
    const p1 = edge[0];
    const p2 = edge[1];

    const dist = Math.hypot(width, height) * 4;
    const [px, py] = point;
    const dir = [Math.cos(theta), Math.sin(theta)];
    const p3 = [px + dir[0] * dist, py + dir[1] * dist];
    const p4 = [px - dir[0] * dist, py - dir[1] * dist];

    const sa = intersectLineSegmentLineSegment(p1, p2, p3, p4);
    if (sa >= 0 && sa <= 1) {
      const hit = [px + dir[0] * sa * dist, py + dir[1] * sa * dist];
      hits.push(hit);
    } else {
      // no intersection
    }
  }
  if (hits.length == 2) {
    // return the two intersection points
    return hits;
  }
  return null;
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
