import type { ColourPuzzle, PaletteColor } from "./types";

type PuzzleOptions = {
  columns: number;
  paletteSize: number;
};

const MAX_CANVAS_SIZE = 720;

export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function createPuzzle(source: string, options: PuzzleOptions): Promise<ColourPuzzle> {
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
  const palette = buildPalette(imageData.data, options.paletteSize);
  const columns = options.columns;
  const rows = Math.max(1, Math.round((height / width) * columns));
  const cells = Array.from({ length: columns * rows }, (_, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const average = averageCellColor(imageData.data, width, height, col, row, columns, rows);
    const nearest = nearestPaletteColor(average[0], average[1], average[2], palette);

    return {
      colorId: nearest.id,
    };
  });

  return {
    columns,
    rows,
    cells,
    palette,
  };
}

export function renderPuzzleToDataUrl(
  puzzle: ColourPuzzle,
  filledCells: Set<number>,
  includeNumbers: boolean,
): string {
  const cellSize = 42;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas is not available in this browser.");
  }

  canvas.width = puzzle.columns * cellSize;
  canvas.height = puzzle.rows * cellSize;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "700 16px sans-serif";

  puzzle.cells.forEach((cell, index) => {
    const col = index % puzzle.columns;
    const row = Math.floor(index / puzzle.columns);
    const x = col * cellSize;
    const y = row * cellSize;
    const color = puzzle.palette.find((item) => item.id === cell.colorId);

    context.fillStyle = filledCells.has(index) && color ? color.hex : "#ffffff";
    context.fillRect(x, y, cellSize, cellSize);
    context.strokeStyle = "rgba(36, 38, 43, 0.22)";
    context.lineWidth = 1;
    context.strokeRect(x + 0.5, y + 0.5, cellSize, cellSize);

    if (includeNumbers && !filledCells.has(index)) {
      context.fillStyle = "#34373f";
      context.fillText(String(cell.colorId), x + cellSize / 2, y + cellSize / 2);
    }
  });

  return canvas.toDataURL("image/png");
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

function averageCellColor(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  col: number,
  row: number,
  columns: number,
  rows: number,
): [number, number, number] {
  const xStart = Math.floor((col / columns) * width);
  const xEnd = Math.max(xStart + 1, Math.floor(((col + 1) / columns) * width));
  const yStart = Math.floor((row / rows) * height);
  const yEnd = Math.max(yStart + 1, Math.floor(((row + 1) / rows) * height));
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = xStart; x < xEnd; x += 1) {
      const index = (y * width + x) * 4;
      r += data[index];
      g += data[index + 1];
      b += data[index + 2];
      count += 1;
    }
  }

  return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
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

