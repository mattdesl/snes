import * as Color from "@texel/color";
import { convertRGBAToOKLab, loadImage, sigmoid } from "../util.js";
// import srcUrl from "./frank-weichelt-jT6YdrhJwNM-unsplash.jpg";
// import srcUrl from "./sandra-bittmann-EUZLj78RsIk-unsplash.jpg";
import srcUrl from "./imani-bahati-PLplezn22eU-unsplash.jpg";
import targetUrl from "./gradient.png";

const activation = (x) => Math.tanh(x / 2);

export async function setup() {
  const targetWidth = 32;
  const targetHeight = targetWidth;
  const image0 = await loadImage(srcUrl);
  const image1 = await loadImage(targetUrl);

  // shift image0 to target image1

  const targetCanvas = document.createElement("canvas");
  targetCanvas.width = targetWidth;
  targetCanvas.height = targetHeight;
  const targetContext = targetCanvas.getContext("2d", {
    willReadFrequently: true,
  });
  targetContext.drawImage(image1, 0, 0, targetWidth, targetHeight);
  const targetImageData = targetContext.getImageData(
    0,
    0,
    targetWidth,
    targetHeight
  );
  const targetImageDataOKLab = convertRGBAToOKLab(targetImageData.data);
  const gridSizeX = 8;
  const gridSizeY = 16;

  const doOffset = (
    x,
    y,
    cellWidth,
    cellHeight,
    imageWidth,
    imageHeight,
    offset
  ) => {
    let px = x * cellWidth;
    let py = y * cellHeight;

    px += (offset[0] * imageWidth) / 4;
    py += (offset[1] * imageWidth) / 4;

    // px = Color.clamp(px, 0, imageWidth - cellWidth);
    // py = Color.clamp(py, 0, imageHeight - cellHeight);

    return [px, py];
  };

  return {
    targetWidth,
    targetHeight,
    targetImageDataOKLab,
    learningRate: 0.05,
    maxEpoch: 10000,
    stepsPerFrame: 1,
    numFeatures: gridSizeX * gridSizeY, // number of points
    paramsPerFeatures: 2, // x, y
    grayscale: true, // if fitness eval should consider only lightness
    decode(solution, opts) {
      const { numFeatures } = opts;
      const features = [];
      let idx = 0;
      for (let i = 0; i < numFeatures; i++) {
        const x = Math.tanh(solution[idx++]);
        const y = Math.tanh(solution[idx++]);
        features.push({
          offset: [x, y],
        });
      }
      return features;
    },
    draw(features, opts = {}) {
      const { context, width, height, gridSize = 16 } = opts;
      // by training with an off-image background color, the optimizer will
      // be encouraged to reduce its visibility by increasing feature size
      // but during rendering we can use something more pleasing
      const background = opts.fitness ? "magenta" : "black";
      context.save();
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);

      for (let y = 0, i = 0; y < gridSizeY; y++) {
        for (let x = 0; x < gridSizeX; x++, i++) {
          const dstCellWidth = width / gridSizeX;
          const dstCellHeight = height / gridSizeY;

          const srcWidth = image0.width;
          const srcHeight = image0.height;
          const srcCellWidth = srcWidth / gridSizeX;
          const srcCellHeight = srcHeight / gridSizeY;

          const { offset } = features[i];

          context.drawImage(
            image0,
            // srcWidth / 2 + (offset[0] * srcWidth) / 2,
            // srcHeight / 2 + (offset[1] * srcHeight) / 2,
            ...doOffset(
              x,
              y,
              srcCellWidth,
              srcCellHeight,
              image0.width,
              image0.height,
              offset
            ),
            srcCellWidth,
            srcCellHeight,
            x * dstCellWidth,
            y * dstCellHeight,
            dstCellWidth,
            dstCellHeight
          );
        }
      }
      context.restore();
    },
  };
}
