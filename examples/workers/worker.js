// import xorshift128 from "../../xorshift128.js";
import {
  clear,
  fitness as computeFitness,
  drawSolution,
  fitnessFromImageData,
} from "./util.js";

let scales;
let id;
let solutionLength;
let batchCount;

let canvas, context;

self.onmessage = (ev) => {
  const { data } = ev;
  if (data.type == "init") {
    id = data.id;
    solutionLength = data.solutionLength;
    // targetOKLab = data.targetOKLab;
    // width = data.width;
    // height = data.height;
    batchCount = data.batchCount;
    scales = data.scales;

    const { width, height } = scales[0]; // initial scale
    canvas = new OffscreenCanvas(width, height * batchCount);
    context = canvas.getContext("2d", {
      willReadFrequently: true,
      alpha: false,
    });

    self.postMessage({ id, type: "ready" });
  } else if (data.type === "ask") {
    const solutions = data.solutions; // batch of batchCount
    const fitness = new Float32Array(batchCount);
    const scaleValue = data.scaleIndex || 0;
    const { width, height, data: targetOKLab } = scales[scaleValue];

    // new size
    if (canvas.width !== width || canvas.height !== height * batchCount) {
      canvas.width = width;
      canvas.height = height * batchCount;
    }

    clear(context, width, height * batchCount);

    for (let i = 0; i < batchCount; i++) {
      const off = i * solutionLength;
      const solution = solutions.subarray(off, off + solutionLength);
      context.save();
      context.translate(0, i * height);
      context.beginPath();
      context.rect(0, 0, width, height);
      context.clip();
      drawSolution(context, solution, width, height, false);
      context.restore();
    }

    const fullData = context.getImageData(0, 0, width, height * batchCount);

    for (let i = 0; i < batchCount; i++) {
      const size = width * height * 4;
      const curData = fullData.data.subarray(i * size, (i + 1) * size);
      const f = fitnessFromImageData(curData, targetOKLab);
      fitness[i] = f;
    }

    self.postMessage({ id, type: "tell", fitness });
  }
};
