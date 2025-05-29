import * as Color from "@texel/color";
import { convertRGBAToOKLab, loadImage, sigmoid } from "../util.js";
import imageUrl from "../monalisa.png";

const activation = (x) => Math.tanh(x / 2);

export async function setup() {
  const targetWidth = 64;
  const targetHeight = targetWidth;
  const image = await loadImage(imageUrl);
  const targetCanvas = document.createElement("canvas");
  targetCanvas.width = targetWidth;
  targetCanvas.height = targetHeight;
  const targetContext = targetCanvas.getContext("2d", {
    willReadFrequently: true,
  });
  targetContext.drawImage(image, 0, 0, targetWidth, targetHeight);
  const targetImageData = targetContext.getImageData(
    0,
    0,
    targetWidth,
    targetHeight
  );
  const targetImageDataOKLab = convertRGBAToOKLab(targetImageData.data);

  return {
    targetWidth,
    targetHeight,
    targetImageDataOKLab,
    learningRate: 0.1,
    maxEpoch: 10000,
    stepsPerFrame: 10,
    numFeatures: 32, // number of points
    paramsPerFeatures: 6, // x, y, r, L, a, b
    // grayscale: true, // if fitness eval should consider only lightness
    decode(solution, opts) {
      const { numFeatures } = opts;
      const features = [];
      let idx = 0;
      for (let i = 0; i < numFeatures; i++) {
        const x = activation(solution[idx++]);
        const y = activation(solution[idx++]);
        const r = 1 + 0.5 * activation(solution[idx++]);
        const L = sigmoid(solution[idx++]);
        const maxChroma = 0.4;
        const a = activation(solution[idx++]) * maxChroma;
        const b = activation(solution[idx++]) * maxChroma;
        features.push({
          point: [x, y],
          radius: r,
          color: Color.serialize([L, a, b], Color.OKLab, Color.sRGB),
          alpha: 1,
        });
      }
      return features;
    },
    draw(features, opts = {}) {
      const { context, width, height } = opts;
      // by training with an off-image background color, the optimizer will
      // be encouraged to reduce its visibility by increasing feature size
      // but during rendering we can use something more pleasing
      const background = opts.fitness ? "magenta" : "darkgreen";
      context.save();
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
      for (let { point, radius = 1, alpha = 1, color = "black" } of features) {
        const x = width / 2 + (point[0] * width) / 2;
        const y = height / 2 + (point[1] * height) / 2;
        context.beginPath();
        context.fillStyle = color;
        context.globalAlpha = alpha;
        const dim = Math.min(width, height);
        const r = dim * 0.1 * radius;
        context.arc(x, y, r, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = 1;
      }
      context.restore();
    },
  };
}
