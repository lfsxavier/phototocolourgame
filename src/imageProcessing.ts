import type { PaletteColor } from "./types";

type ProcessedImage = {
  dataUrl: string;
  palette: PaletteColor[];
};

const MAX_CANVAS_SIZE = 920;

export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function posterizeImage(source: string, paletteSize: number): Promise<ProcessedImage> {
  const image = await loadImage(source);
  const { width, height } = fitSize(image.width, image.height);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    throw new Error("Canvas is not available in this browser.");
  }

  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);

  const imageData = context.getImageData(0, 0, width, height);
  const palette = buildPalette(imageData.data, paletteSize);

  for (let i = 0; i < imageData.data.length; i += 4) {
    const nearest = nearestPaletteColor(
      imageData.data[i],
      imageData.data[i + 1],
      imageData.data[i + 2],
      palette,
    );
    imageData.data[i] = nearest.rgb[0];
    imageData.data[i + 1] = nearest.rgb[1];
    imageData.data[i + 2] = nearest.rgb[2];
  }

  context.putImageData(imageData, 0, 0);
  drawCellGrid(context, width, height);

  return {
    dataUrl: canvas.toDataURL("image/png"),
    palette,
  };
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The selected image could not be loaded."));
    image.src = source;
  });
}

function fitSize(width: number, height: number) {
  const scale = Math.min(1, MAX_CANVAS_SIZE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function buildPalette(data: Uint8ClampedArray, paletteSize: number): PaletteColor[] {
  const buckets = new Map<string, { rgb: [number, number, number]; count: number }>();
  const stride = Math.max(4, Math.floor(data.length / 12000));

  for (let i = 0; i < data.length; i += stride - (stride % 4)) {
    const alpha = data[i + 3];
    if (alpha < 16) {
      continue;
    }

    const r = quantize(data[i]);
    const g = quantize(data[i + 1]);
    const b = quantize(data[i + 2]);
    const key = `${r}-${g}-${b}`;
    const existing = buckets.get(key);

    if (existing) {
      existing.count += 1;
    } else {
      buckets.set(key, { rgb: [r, g, b], count: 1 });
    }
  }

  const colors = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, paletteSize)
    .map((color, index) => ({
      id: index + 1,
      hex: rgbToHex(color.rgb),
      rgb: color.rgb,
    }));

  return colors.length > 0 ? colors : [{ id: 1, hex: "#cccccc", rgb: [204, 204, 204] }];
}

function quantize(value: number): number {
  return Math.round(value / 48) * 48;
}

function nearestPaletteColor(r: number, g: number, b: number, palette: PaletteColor[]): PaletteColor {
  let nearest = palette[0];
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const color of palette) {
    const distance =
      (r - color.rgb[0]) * (r - color.rgb[0]) +
      (g - color.rgb[1]) * (g - color.rgb[1]) +
      (b - color.rgb[2]) * (b - color.rgb[2]);

    if (distance < nearestDistance) {
      nearest = color;
      nearestDistance = distance;
    }
  }

  return nearest;
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function drawCellGrid(context: CanvasRenderingContext2D, width: number, height: number) {
  const cellSize = Math.max(22, Math.round(Math.min(width, height) / 24));
  context.strokeStyle = "rgba(47, 49, 54, 0.22)";
  context.lineWidth = 1;

  for (let x = 0; x < width; x += cellSize) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }

  for (let y = 0; y < height; y += cellSize) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
}

