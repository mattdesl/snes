import canvasSketch from "canvas-sketch";
import * as Color from "@texel/color";
import Random from "canvas-sketch-util/random.js";
import sNES from "../../index.js";
import { sigmoid, loadImage, convertRGBAToOKLab } from "../util.js";
import { lerp, clamp } from "canvas-sketch-util/math.js";
import { getMinimumSpanningTree } from "./mst.js";
Random.setSeed("" || Random.getRandomSeed());
console.log(`seed: ${Random.getSeed()}`);

const settings = {
  dimensions: [2048, 2048],
  suffix: Random.getSeed(),
};

canvasSketch(async (props) => {
  const targetSize = 64;
  const glyph = "b";

  const tmpCanvas = document.createElement("canvas");
  const tmpCtx = tmpCanvas.getContext("2d", {
    willReadFrequently: true,
  });

  tmpCanvas.width = targetSize;
  tmpCanvas.height = targetSize;

  const fontScale = targetSize * 1.0;
  tmpCtx.fillStyle = "white";
  tmpCtx.fillRect(0, 0, targetSize, targetSize);
  tmpCtx.font = `${fontScale}px monospace`;
  tmpCtx.textAlign = "center";
  tmpCtx.textBaseline = "middle";
  tmpCtx.fillStyle = "black";
  tmpCtx.fillText(glyph, targetSize / 2, targetSize / 2 + fontScale / 9);

  const targetData = tmpCtx.getImageData(0, 0, targetSize, targetSize);
  // const targetLab = convertRGBAToOKLab(targetData.data);

  const gridSize = 8;
  const outputSize = 1;

  const nPoints = 16;
  const solutionLength = nPoints * 2;
  const populationCount = 32;
  const stepsPerFrame = 10;

  const optimizer = sNES({
    mirrored: true,
    populationCount,
    solutionLength,
    alpha: 0.1,
    random: Random.value,
  });
  const fitnesses = new Float32Array(optimizer.populationCount);

  for (let i = 0; i < optimizer.center.length; i++) {
    // optimizer.center[i] = Random.gaussian(0, 1);
  }

  const snapping = false;
  requestAnimationFrame(updateLoop);

  return {
    render({ exporting, context, width, height }) {
      const dim = Math.min(width, height);
      const padding = dim * 0.2;
      const innerWidth = width - padding * 2;
      const innerHeight = height - padding * 2;
      const scl = 1 / 8;
      const gridDotRadius =
        (Math.min(innerWidth, innerHeight) / (gridSize - 1) / 2) * scl;

      context.clearRect(0, 0, width, height);
      context.fillStyle = "white";
      context.fillRect(0, 0, width, height);

      const tree = getTree(optimizer.center, snapping);

      for (let y = 0; y < gridSize; y++) {
        for (let x = 0; x < gridSize; x++) {
          const px = lerp(padding, width - padding, x / (gridSize - 1));
          const py = lerp(padding, height - padding, y / (gridSize - 1));

          context.beginPath();
          context.arc(px, py, gridDotRadius, 0, Math.PI * 2);
          context.fillStyle = "black";
          context.fill();
        }
      }

      drawTree(context, tree, width, height, padding);

      for (let k = 0; k < tree.points.length; k++) {
        const [i, j] = tree.points[k];
        const u = i / (gridSize - 1);
        const v = j / (gridSize - 1);
        const px = lerp(padding, width - padding, u);
        const py = lerp(padding, height - padding, v);
        context.beginPath();
        context.arc(px, py, gridDotRadius * 2, 0, Math.PI * 2);
        context.fillStyle = "tomato";
        context.fill();
      }

      // fitness(optimizer.center);
      // tmpCtx.putImageData(targetData, 0, 0);
      // context.drawImage(tmpCanvas, 0, 0, width, height);
    },
  };

  function updateLoop() {
    for (let i = 0; i < stepsPerFrame; i++) {
      // evolve the searcher
      const solutions = optimizer.ask();
      for (let i = 0; i < optimizer.populationCount; i++) {
        const solution = optimizer.getSolutionAt(solutions, i);
        fitnesses[i] = fitness(solution);
      }
      const ranks = optimizer.tell(fitnesses);
      // console.log(fitnesses[ranks[0]]);
    }
    props.render();
    requestAnimationFrame(updateLoop);
  }

  // a custom distance that favours true diagonals
  function diagonalDistance(a, b) {
    const dx = Math.abs(a[0] - b[0]);
    const dy = Math.abs(a[1] - b[1]);
    const eu = Math.hypot(dx, dy);
    const miss = Math.abs(dx - dy); // 0 when |dx|==|dy|
    return eu + 1.0 * miss;
  }

  function getTree(solution, snap = false) {
    const points = decodeSolution(solution, snap);
    const connections = getMinimumSpanningTree(
      points,
      // (a, b) => {
      //   return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
      // },
      undefined,
      {
        maxSteps: 100,
      }
    );
    return {
      points,
      edges: connections.map((c) => c.indices),
    };
  }

  function drawTree(
    context,
    { points, edges },
    width,
    height,
    padding = 0,
    lineWidthScale = 1
  ) {
    for (let c of edges) {
      const pt = c.map((i) => points[i]);
      context.beginPath();
      pt.forEach((p) => {
        const [i, j] = p;
        const u = i / (gridSize - 1);
        const v = j / (gridSize - 1);
        const px = lerp(padding, width - padding, u);
        const py = lerp(padding, height - padding, v);
        context.lineTo(px, py);
      });

      context.lineWidth = Math.min(width, height) * 0.01 * lineWidthScale;
      context.lineJoin = "round";
      context.lineCap = "round";
      context.strokeStyle = "black";
      context.stroke();
    }
  }

  function decodeSolution(solution, snap = false) {
    const points = [];
    for (let i = 0; i < nPoints; i++) {
      let u, v;
      if (snap) {
        u = clamp(
          Math.round(sigmoid(solution[i * 2 + 0]) * (gridSize - 1)),
          0,
          gridSize - 1
        );
        v = clamp(
          Math.round(sigmoid(solution[i * 2 + 1]) * (gridSize - 1)),
          0,
          gridSize - 1
        );
      } else {
        u = sigmoid(solution[i * 2 + 0]) * (gridSize - 1);
        v = sigmoid(solution[i * 2 + 1]) * (gridSize - 1);
        // u = (Math.tanh(solution[i * 2 + 0]) * 0.5 + 0.5) * (gridSize - 1);
        // v = (Math.tanh(solution[i * 2 + 1]) * 0.5 + 0.5) * (gridSize - 1);
      }
      points.push([u, v]);
    }
    return points;
  }

  function fitness(solution) {
    const tree = getTree(solution, snapping);

    tmpCanvas.width = targetSize;
    tmpCanvas.height = targetSize;
    tmpCtx.clearRect(0, 0, targetSize, targetSize);
    tmpCtx.fillStyle = "white";
    tmpCtx.fillRect(0, 0, targetSize, targetSize);
    drawTree(tmpCtx, tree, targetSize, targetSize, 0, 10);
    const rgba = tmpCtx.getImageData(0, 0, targetSize, targetSize).data;

    let pixelError = 0;

    const pixelCount = rgba.length / 4;
    for (let i = 0; i < pixelCount; i++) {
      const base = i * 4;
      const dCur = rgba[base];
      const dTarget = targetData.data[base];
      const d = dCur - dTarget;
      pixelError += d * d;
    }

    let error = 0;
    error += pixelError / (targetSize * targetSize);

    const { points, edges } = tree;

    // 3) grid‐penalty: avg distance from nearest grid node [0…1]
    let totalGridLeak = 0;
    for (let [u, v] of points) {
      totalGridLeak +=
        Math.abs(u - Math.round(u)) + Math.abs(v - Math.round(v));
    }
    // max leak per point is √2, so max total is nPoints*√2
    error += (totalGridLeak / (nPoints * Math.SQRT2)) * 1000;

    // 4) jag‐penalty: avg |dx−dy| per edge, normalized by max edge length
    let totalJag = 0;
    for (let [i0, i1] of edges) {
      const [u0, v0] = points[i0];
      const [u1, v1] = points[i1];
      totalJag += Math.abs(Math.abs(u1 - u0) - Math.abs(v1 - v0));
    }
    // max |dx−dy| per edge is (gridSize−1)
    error += (totalJag / (edges.length * (gridSize - 1))) * 100;

    let clumpPenalty = 0;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const dx = points[i][0] - points[j][0];
        const dy = points[i][1] - points[j][1];
        const d = Math.hypot(dx, dy);
        const MIN_DIST = 1;
        if (d < MIN_DIST) {
          // linear penalty for “intrusion”
          clumpPenalty += MIN_DIST - d;
        }
      }
    }

    // ③    add it into your error:
    error += 10000.0 * clumpPenalty;

    return -error;
  }
}, settings);
