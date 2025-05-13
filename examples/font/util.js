import * as Color from "@texel/color";

export const paramCount = 128;
export const colorCount = paramCount;
export const paramDimensions = 3; // x,y,rad
export const channels = 3;

const tmp3 = [0, 0, 0];

export function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

export function decodeSolution(solution) {
  let idx = 0;
  const params = solution.slice(idx, idx + paramCount * paramDimensions);

  idx += paramCount * paramDimensions;

  const colors = [];
  for (let i = 0; i < colorCount; i++) {
    const color = solution.slice(idx, idx + channels);
    idx += channels;
    colors.push(color);
  }
  return {
    params,
    colors,
  };
}

export function clear(context, width, height) {
  context.clearRect(0, 0, width, height);
  context.fillStyle = "white";
  context.fillRect(0, 0, width, height);
}

export function drawSolution(
  context,
  solution,
  width,
  height,
  clearing = true
) {
  if (clearing) {
    clear(context, width, height);
  }

  const shapes = createShapes(solution, width, height);
  for (let shape of shapes) {
    const { scale, color, point } = shape;
    const radius = scale * Math.min(width, height);
    context.beginPath();
    context.arc(...point, radius, 0, Math.PI * 2);
    context.fillStyle = color;
    context.fill();
  }
}

export function createShapes(solution, width, height) {
  const { params, colors } = decodeSolution(solution);
  const labs = colors.map((raw) => {
    const L = sigmoid(raw[0]);
    const maxChroma = 0.4;
    // const a = maxChroma * (sigmoid(raw[1]) * 2 - 1);
    // const b = maxChroma * (sigmoid(raw[2]) * 2 - 1);
    const a = Color.clamp(raw[1], -maxChroma, maxChroma);
    const b = Color.clamp(raw[2], -maxChroma, maxChroma);
    return [L, a, b];
  });
  const rgbs = labs.map((lab) => {
    const srgb = Color.gamutMapOKLCH(
      Color.convert(lab, Color.OKLab, Color.OKLCH),
      Color.sRGBGamut,
      Color.sRGB,
      undefined,
      Color.MapToCuspL
    );
    return srgb;
  });

  const hexes = rgbs.map((c) => Color.serialize(c, Color.sRGB));
  const shapes = [];
  for (let i = 0; i < paramCount; i++) {
    const rMin = 0.01;
    const rMax = 0.15;
    const point = [
      // width / 2 + (params[i * paramDimensions + 0] * width) / 2,
      // height / 2 + (params[i * paramDimensions + 1] * height) / 2,

      width / 2 + Math.tanh(params[i * paramDimensions + 0]) * (width / 2),
      height / 2 + Math.tanh(params[i * paramDimensions + 1]) * (height / 2),

      // sigmoid(params[i * paramDimensions + 0]) * width,
      // sigmoid(params[i * paramDimensions + 1]) * height,
    ];
    const t = Math.tanh(params[i * paramDimensions + 2]);
    shapes.push({
      // scale: rMin + (rMax - rMin) * sigmoid(params[i * paramDimensions + 2]),
      scale: rMin + ((t + 1) / 2) * (rMax - rMin),
      // scale: clamp(0.1 * sigmoid(params[i * paramDimensions + 2]), 0.01, 0.5),
      // scale: clamp(
      //   0.1 * softplus(params[i * paramDimensions + 2]),
      //   0.01,
      //   0.5
      // ),
      t: paramCount <= 1 ? 1 : i / (paramCount - 1),
      point,
      color: hexes[i],
      srgb: rgbs[i],
      oklab: labs[i],
    });
  }
  return shapes;
}

export function fitness(solution, tmpCanvas, tmpCtx, imageLab, W, H) {
  tmpCanvas.width = W;
  tmpCanvas.height = H;
  drawSolution(tmpCtx, solution, W, H);

  const { data } = tmpCtx.getImageData(0, 0, W, H);

  return fitnessFromImageData(data, imageLab);
}

export function fitnessFromImageData(rgbaData, imageLab) {
  let error = 0;

  const pixelCount = rgbaData.length / 4;
  for (let i = 0; i < pixelCount; i++) {
    const rgbaIdx = i * 4;
    const labIdx = i * 3;
    tmp3[0] = rgbaData[rgbaIdx] / 0xff;
    tmp3[1] = rgbaData[rgbaIdx + 1] / 0xff;
    tmp3[2] = rgbaData[rgbaIdx + 2] / 0xff;
    Color.convert(tmp3, Color.sRGB, Color.OKLab, tmp3);

    const L0 = tmp3[0];
    const A0 = tmp3[1];
    const B0 = tmp3[2];

    const L1 = imageLab[labIdx];
    const A1 = imageLab[labIdx + 1];
    const B1 = imageLab[labIdx + 2];

    const dL = L1 - L0;
    const dA = A1 - A0;
    const dB = B1 - B0;
    error += dL * dL + dA * dA + dB * dB;
  }

  return -error;
}
