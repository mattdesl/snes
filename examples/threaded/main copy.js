import canvasSketch from "canvas-sketch";
import Random from "canvas-sketch-util/random.js";
import SNES from "../../index.js";

Random.setSeed("" || Random.getRandomSeed());
console.log(`seed: ${Random.getSeed()}`);

const colorRandom = Random.createRandom("1234");

const settings = {
  dimensions: [2048, 2048],
  suffix: Random.getSeed(),
  animate: true,
};

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

canvasSketch(async ({ width, height }) => {
  const pointCount = 8;
  const pointCountRange = [pointCount, pointCount];
  const paramsPerPoint = 4;
  const popultionCount = 32;
  const targetSize = 64;
  const alpha = 0.5;
  const sigma = 0.5;
  const continuous = true;
  const steps = 5;
  let epoch = 0;
  const improvementThreshold = 10000; // tweak to how much fitness must improve
  const patience = 10; // number of ticks you’ll wait before reset

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const totalCells = alphabet.length;
  const columns = Math.ceil(Math.sqrt(totalCells));
  const rows = Math.ceil(totalCells / columns);
  const cellWidth = width / columns;
  const cellHeight = height / rows;

  const tmpCanvas = document.createElement("canvas");
  tmpCanvas.width = targetSize;
  tmpCanvas.height = targetSize;
  const tmpContext = tmpCanvas.getContext("2d", {
    willReadFrequently: true,
  });

  const cells = alphabet.split("").map((char, i) => {
    const targetCanvas = document.createElement("canvas");
    targetCanvas.width = targetSize;
    targetCanvas.height = targetSize;
    const targetContext = targetCanvas.getContext("2d");
    targetContext.fillStyle = "white";
    targetContext.fillRect(0, 0, targetSize, targetSize);
    targetContext.fillStyle = "black";
    const fontSize = targetSize * 1;
    targetContext.font = `${fontSize}px monospace`;
    targetContext.textAlign = "center";
    targetContext.textBaseline = "middle";
    // targetContext.filter = `blur(${targetSize * 0.015}px)`;
    targetContext.globalAlpha = alpha;
    targetContext.fillText(
      char,
      targetSize / 2,
      targetSize / 2 + fontSize * 0.05
    );
    const targetImageData = targetContext.getImageData(
      0,
      0,
      targetSize,
      targetSize
    );

    let optimizer = SNES({
      alpha: sigma,
      solutionLength: Random.rangeFloor(...pointCountRange) * paramsPerPoint,
      popsize: popultionCount,
      random: Random.value,
    });

    const best = optimizer.center.slice();

    return {
      bestScore: -Infinity,
      prevScore: -Infinity,
      stagnation: 0,
      deltaShort: [], //
      deltaLong: [], //
      best,
      optimizer,
      char,
      index: i,
      target: targetImageData,
    };
  });

  const render = ({ context, width, height }) => {
    context.fillStyle = "white";
    context.fillRect(0, 0, width, height);

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        const index = y * columns + x;
        if (index >= totalCells) break;

        const cellX = x * cellWidth;
        const cellY = y * cellHeight;

        const { optimizer, target, best } = cells[index];

        context.save();
        context.translate(cellX, cellY);

        // tmpContext.putImageData(target, 0, 0);
        // context.drawImage(tmpCanvas, 0, 0, cellWidth, cellHeight);
        context.translate(cellWidth / 2, cellHeight / 2);
        const scale = 0.8;
        context.scale(scale, scale);
        context.translate(-cellWidth / 2, -cellHeight / 2);

        const lineScale = 8;
        const params = [
          [best, 1],
          [optimizer.center, 0.25],
        ];
        for (let [p, alpha] of params) {
          const lines = paramsToLines(p);
          linesToCanvas({
            context,
            width: cellWidth,
            height: cellHeight,
            lines,
            continuous,
            lineScale,
            alpha,
          });
        }
        context.restore();

        context.strokeStyle = "black";
        context.fillStyle = "black";
        // context.strokeRect(cellX, cellY, cellWidth, cellHeight);
      }
    }
  };

  // const tick = () => {
  //   epoch++;
  //   const needsReset = epoch >= epochsBeforeRestart;
  //   if (needsReset) {
  //     epoch = 0;
  //   }

  //   for (let i = 0; i < cells.length; i++) {
  //     for (let j = 0; j < steps; j++) {
  //       const { optimizer, target, bestScore } = cells[i];
  //       const solutionsFlat = optimizer.ask();
  //       const fitnesses = new Float32Array(optimizer.populationCount);
  //       let maxScore = -Infinity;
  //       let bestSolutionIndex = -1;
  //       for (let i = 0; i < optimizer.populationCount; i++) {
  //         const sol = optimizer.getSolutionAt(solutionsFlat, i);
  //         const f = fitness(sol, target);
  //         fitnesses[i] = f;
  //         if (f > maxScore) {
  //           maxScore = f;
  //           bestSolutionIndex = i;
  //         }
  //       }
  //       optimizer.tell(fitnesses);

  //       if (maxScore > bestScore) {
  //         cells[i].bestScore = maxScore;
  //         cells[i].best = optimizer
  //           .getSolutionAt(solutionsFlat, bestSolutionIndex)
  //           .slice();
  //       }
  //     }
  //     if (needsReset) {
  //       reset(cells[i]);
  //     }
  //   }
  // };

  function tick() {
    epoch++;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const { optimizer, target } = cell;

      // do multiple SNES steps per tick if you like
      let localMax = -Infinity,
        bestIdx = 0;
      for (let s = 0; s < steps; s++) {
        const pop = optimizer.ask();
        const fits = new Float32Array(optimizer.populationCount);

        for (let j = 0; j < fits.length; j++) {
          const sol = optimizer.getSolutionAt(pop, j);
          const f = fitness(sol, target);
          fits[j] = f;
          if (f > localMax) {
            localMax = f;
            bestIdx = j;
          }
        }
        optimizer.tell(fits);

        // record any new all‑time best
        if (localMax > cell.bestScore) {
          cell.bestScore = localMax;
          cell.best = optimizer.getSolutionAt(pop, bestIdx).slice();
        }
      }

      // measure “convergence” by how much bestScore moved since last tick
      let delta;
      if (!isFinite(cell.prevScore)) {
        cell.prevScore = localMax;
        delta = 0;
      } else {
        delta = Math.abs(localMax - cell.prevScore);
        cell.prevScore = localMax;
      }

      // const delta = Math.abs(localMax - cell.prevScore);
      // if (delta < improvementThreshold) {
      //   cell.stagnation++;
      // } else {
      //   cell.stagnation = 0;
      // }

      // 2) push into the window, drop oldest if needed
      const shortWindow = 5;
      const longWindow = 40;

      // 2) push into short & long windows
      cell.deltaShort.push(delta);
      if (cell.deltaShort.length > shortWindow) cell.deltaShort.shift();

      cell.deltaLong.push(delta);
      if (cell.deltaLong.length > longWindow) cell.deltaLong.shift();

      if (cell.deltaLong.length === longWindow) {
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
      // if it’s been plateaued for too long, reset just this cell
      if (cell.stagnation >= patience) {
        reset(cell);
        // re‑initialize the convergence trackers
        cell.prevScore = -Infinity;
        cell.stagnation = 0;
        cell.deltaShort.length = 0;
        cell.deltaLong.length = 0;
      }
    }
  }

  return { render, tick };

  function reset(cell) {
    cell.optimizer = SNES({
      alpha: sigma,
      solutionLength: Random.rangeFloor(...pointCountRange) * paramsPerPoint,
      popsize: popultionCount,
      random: Random.value,
    });
    // cell.optimizer.center.fill(0);
    // cell.optimizer.sigma.fill(sigma);
  }

  function fitness(params, target) {
    const lines = paramsToLines(params);
    tmpContext.fillStyle = "white";
    tmpContext.fillRect(0, 0, target.width, target.height);
    linesToCanvas({
      context: tmpContext,
      width: target.width,
      height: target.height,
      lines,
      lineScale: 16,
      vertices: false,
      continuous,
      labels: false,
      alpha,
      // fill: true,
    });

    let err = 0;

    const imgData = tmpContext.getImageData(0, 0, targetSize, targetSize);
    for (let i = 0; i < imgData.data.length; i += 4) {
      const r = imgData.data[i];
      const tr = target.data[i];
      const dr = r - tr;
      err += dr * dr;
    }

    // const blackWeight = 5; // how many times more you care about black–pixel errors
    // const blackThreshold = 200; // anything darker than this in the target counts as “black” (0–255)

    // for (let i = 0; i < imgData.data.length; i += 4) {
    //   const r = imgData.data[i]; // rendered pixel (0 = black … 255 = white)
    //   const tr = target.data[i]; // target pixel

    //   const dr = r - tr;
    //   // const isBlack = tr < blackThreshold;
    //   // const w = isBlack ? blackWeight : 1;

    //   err += dr * dr * 1;
    // }

    // 2) continuity penalty: encourage end of line[i] to meet start of line[i+1]
    const continuityCoef = 1e4; // tweak up/down to control how “snaky” the polyline is
    for (let i = 0; i < lines.length - 1; i++) {
      const [[x0, y0], [x1, y1]] = lines[i].line;
      const [[nx0, ny0], [nx1, ny1]] = lines[i + 1].line;
      const dx = x1 - nx0,
        dy = y1 - ny0;
      err += (dx * dx + dy * dy) * continuityCoef;
    }

    // 3) continuous length‑consistency penalty (no `if`)
    // const lengths = lines.map(({ line: [[x0, y0], [x1, y1]] }) =>
    //   Math.hypot(x1 - x0, y1 - y0)
    // );
    // const meanLen = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    // const tolFrac = 0.9; // +- %
    // const penaltyCoef = 1e8; // tweak to taste

    // for (let L of lengths) {
    //   const fracDiff = Math.abs(L - meanLen) / meanLen;
    //   // branchless “excess over tolFrac”: (x + |x|)/2  == max(x,0)
    //   const excess = 0.5 * (fracDiff - tolFrac + Math.abs(fracDiff - tolFrac));
    //   err += excess * penaltyCoef;
    // }

    // **PENALTIES**:
    // const minLen = 0.02; // in normalized [0,1] units
    // const collapsePenalty = 1e10; // big penalty for each collapsed line

    // // 2) collapse penalty:
    // for (let i = 0; i < lines.length; i++) {
    //   const [[x0, y0], [x1, y1]] = lines[i].line;
    //   const len = Math.hypot(x1 - x0, y1 - y0);
    //   if (len < minLen) {
    //     // err += (minLen - len) * collapsePenalty;
    //   }
    // }

    // 4) bounding‐box penalty (smooth, squared)
    const bboxCoef = 1e4;
    for (let { line } of lines) {
      for (let [x, y] of line) {
        // how far past each edge?
        const dxNeg = Math.max(0, -x);
        const dxPos = Math.max(0, x - 1);
        const dyNeg = Math.max(0, -y);
        const dyPos = Math.max(0, y - 1);
        err +=
          (dxNeg * dxNeg + dxPos * dxPos + dyNeg * dyNeg + dyPos * dyPos) *
          bboxCoef;
      }
    }

    // 4) continuous “drift to black” penalty
    //    each segment midpoint samples the target’s brightness [0=black…255=white]
    //    and pays more error the whiter it is
    // const attractCoef = 1e3;
    // for (let { line } of lines) {
    //   const [[x0, y0], [x1, y1]] = line;
    //   // normalized midpoint:
    //   const mx = (x0 + x1) / 2;
    //   const my = (y0 + y1) / 2;
    //   // pixel coords (clamp to edge):
    //   const ix = Math.min(
    //     target.width - 1,
    //     Math.max(0, Math.floor(mx * target.width))
    //   );
    //   const iy = Math.min(
    //     target.height - 1,
    //     Math.max(0, Math.floor(my * target.height))
    //   );
    //   const tIndex = (iy * target.width + ix) * 4;
    //   const brightness = target.data[tIndex]; // 0 = black … 255 = white
    //   err += (brightness / 255) * attractCoef;
    // }

    return -err;
  }

  function linesToCanvas({
    context,
    width,
    height,
    lines,
    lineScale = 1,
    alpha = 1,
    continuous = false,
  }) {
    context.save();
    // context.filter = `blur(${width * 0.025}px)`;
    context.fillStyle = context.strokeStyle = "black";
    const lineWidth = width * 0.005 * lineScale;
    context.lineWidth = lineWidth;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.globalAlpha = alpha;

    if (continuous) {
      context.globalAlpha = alpha * 1;
      context.beginPath();
      for (let i = 0; i < lines.length; i++) {
        const { line, alpha: curAlpha } = lines[i];
        const a = line[0];
        const b = line[1];
        context.lineTo(a[0] * width, a[1] * height);
        context.lineTo(b[0] * width, b[1] * height);
      }
      context.stroke();
    } else {
      for (let i = 0; i < lines.length; i++) {
        const { line, alpha: curAlpha } = lines[i];
        const a = line[0];
        const b = line[1];
        context.globalAlpha = alpha * curAlpha;
        context.beginPath();
        context.lineTo(a[0] * width, a[1] * height);
        context.lineTo(b[0] * width, b[1] * height);
        context.stroke();
      }
    }

    context.restore();
  }

  function paramsToLines(params) {
    const points = [];
    const pointCount = params.length / paramsPerPoint;
    for (let i = 0; i < pointCount; i++) {
      let x0 = sigmoid(params[i * paramsPerPoint]);
      let y0 = sigmoid(params[i * paramsPerPoint + 1]);
      let x1 = sigmoid(params[i * paramsPerPoint + 2]);
      let y1 = sigmoid(params[i * paramsPerPoint + 3]);

      x0 = Math.max(0, Math.min(1, x0));
      y0 = Math.max(0, Math.min(1, y0));
      x1 = Math.max(0, Math.min(1, x1));
      y1 = Math.max(0, Math.min(1, y1));

      const alpha = 1; //sigmoid(params[i * paramsPerPoint + 4]);

      // const angleStep = 45 / 2;
      // const lineMid = [(x0 + x1) / 2, (y0 + y1) / 2];
      // const lineLength = Math.hypot(x1 - x0, y1 - y0);
      // const lineAngle = Math.atan2(y1 - y0, x1 - x0);
      // const lineAngleDeg = (lineAngle * 180) / Math.PI;
      // const snappedAngleDeg = Math.round(lineAngleDeg / angleStep) * angleStep;
      // const snappedAngle = (snappedAngleDeg * Math.PI) / 180;
      // const dx = Math.cos(snappedAngle) * lineLength;
      // const dy = Math.sin(snappedAngle) * lineLength;
      // x0 = lineMid[0] - dx / 2;
      // y0 = lineMid[1] - dy / 2;
      // x1 = lineMid[0] + dx / 2;
      // y1 = lineMid[1] + dy / 2;

      points.push({
        line: [
          [x0, y0],
          [x1, y1],
        ],
        alpha,
      });
    }
    return reorderLines(points);
    // return quantizeSegments(points, 45);
  }
}, settings);

/**
 * Given an array of { line: [[x0,y0],[x1,y1]], alpha },
 * return a new array in a single “snake” order, flipping segments
 * so each one starts where the last one ended.
 */
function reorderLines(lines) {
  const remaining = lines.slice();
  const ordered = [];

  // seed with the first segment
  let current = remaining.shift();
  ordered.push(current);
  let [px, py] = current.line[1];

  while (remaining.length) {
    let bestIdx = 0;
    let bestDist = Infinity;
    let bestOriented = null;

    for (let i = 0; i < remaining.length; i++) {
      const {
        line: [[ax, ay], [bx, by]],
        alpha,
      } = remaining[i];

      // distance from px,py to each end
      const da = (ax - px) ** 2 + (ay - py) ** 2;
      const db = (bx - px) ** 2 + (by - py) ** 2;

      if (da < bestDist) {
        bestDist = da;
        bestIdx = i;
        // keep as [a→b]
        bestOriented = {
          line: [
            [ax, ay],
            [bx, by],
          ],
          alpha,
        };
      }
      if (db < bestDist) {
        bestDist = db;
        bestIdx = i;
        // flip to [b→a]
        bestOriented = {
          line: [
            [bx, by],
            [ax, ay],
          ],
          alpha,
        };
      }
    }

    ordered.push(bestOriented);
    // advance the “tail” to this segment’s end
    [px, py] = bestOriented.line[1];
    remaining.splice(bestIdx, 1);
  }

  return ordered;
}
