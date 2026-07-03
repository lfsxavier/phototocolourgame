import type { ColourPuzzle, ColourRegion, PaletteColor } from "./types";

type PuzzleOptions = {
  columns: number;
  paletteSize: number;
};

const MAX_CANVAS_SIZE = 720;
const RENDER_CANVAS_WIDTH = 760;
const EXPORT_CANVAS_WIDTH = 1400;

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
  const colorIds = smoothColorIds(
    Array.from({ length: columns * rows }, (_, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const average = averageCellColor(imageData.data, width, height, col, row, columns, rows);
      return nearestPaletteColor(average[0], average[1], average[2], palette).id;
    }),
    columns,
    rows,
  );
  const cleanedColorIds = mergeTinyRegions(colorIds, columns, rows);
  const { regionIds, regions } = buildRegions(cleanedColorIds, columns, rows);
  markPlayableRegions(regions, columns);
  const playablePalette = renumberPlayablePalette(regions, palette);

  return {
    columns,
    rows,
    regionIds,
    regions,
    palette: playablePalette,
  };
}

export function renderPuzzleToCanvas(
  canvas: HTMLCanvasElement,
  puzzle: ColourPuzzle,
  filledRegions: Set<number>,
  includeNumbers: boolean,
) {
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas is not available in this browser.");
  }

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cellSize = RENDER_CANVAS_WIDTH / puzzle.columns;
  const cssWidth = RENDER_CANVAS_WIDTH;
  const cssHeight = puzzle.rows * cellSize;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawPuzzle(context, puzzle, filledRegions, includeNumbers, cellSize, 16);
}

export function renderPuzzleToDataUrl(
  puzzle: ColourPuzzle,
  filledRegions: Set<number>,
  includeNumbers: boolean,
): string {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas is not available in this browser.");
  }

  const exportCellSize = EXPORT_CANVAS_WIDTH / puzzle.columns;
  canvas.width = puzzle.columns * exportCellSize;
  canvas.height = puzzle.rows * exportCellSize;
  drawPuzzle(context, puzzle, filledRegions, includeNumbers, exportCellSize, 28);
  return canvas.toDataURL("image/png");
}

export async function renderCompletedArtworkToDataUrl(
  source: string,
  puzzle: ColourPuzzle,
  filledRegions: Set<number>,
): Promise<string> {
  const image = await loadImage(source);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas is not available in this browser.");
  }

  const exportCellSize = EXPORT_CANVAS_WIDTH / puzzle.columns;
  const width = puzzle.columns * exportCellSize;
  const height = puzzle.rows * exportCellSize;
  canvas.width = width;
  canvas.height = height;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  drawImageCover(context, image, width, height);

  context.globalAlpha = 0.7;
  drawFilledRegions(context, puzzle, filledRegions, exportCellSize);
  context.globalAlpha = 1;

  context.globalAlpha = 0.38;
  drawBoundaries(context, puzzle, exportCellSize, "#25282e", 0.1);
  context.globalAlpha = 1;

  return canvas.toDataURL("image/png");
}

export function regionAtPoint(
  puzzle: ColourPuzzle,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): number | null {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor(((clientX - rect.left) / rect.width) * puzzle.columns);
  const y = Math.floor(((clientY - rect.top) / rect.height) * puzzle.rows);

  if (x < 0 || y < 0 || x >= puzzle.columns || y >= puzzle.rows) {
    return null;
  }

  return puzzle.regionIds[y * puzzle.columns + x] ?? null;
}

function drawPuzzle(
  context: CanvasRenderingContext2D,
  puzzle: ColourPuzzle,
  filledRegions: Set<number>,
  includeNumbers: boolean,
  cellSize: number,
  labelSize: number,
) {
  const width = puzzle.columns * cellSize;
  const height = puzzle.rows * cellSize;
  const regionById = new Map(puzzle.regions.map((region) => [region.id, region]));

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  drawFilledRegions(context, puzzle, filledRegions, cellSize);
  drawBoundaries(context, puzzle, cellSize);

  if (!includeNumbers) {
    return;
  }

  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#34373f";
  context.font = `700 ${labelSize}px sans-serif`;

  for (const region of [...regionById.values()].sort((a, b) => b.cells.length - a.cells.length)) {
    if (filledRegions.has(region.id) || !region.isPlayable) {
      continue;
    }

    const labelX = (region.center.x + 0.5) * cellSize;
    const labelY = (region.center.y + 0.5) * cellSize;

    context.fillText(String(region.colorId), labelX, labelY);
  }
}

function drawFilledRegions(
  context: CanvasRenderingContext2D,
  puzzle: ColourPuzzle,
  filledRegions: Set<number>,
  cellSize: number,
) {
  for (const region of puzzle.regions) {
    if (!filledRegions.has(region.id)) {
      continue;
    }

    const color = puzzle.palette.find((item) => item.id === region.colorId);
    if (!color) {
      continue;
    }

    context.fillStyle = color.hex;
    for (const cellIndex of region.cells) {
      const col = cellIndex % puzzle.columns;
      const row = Math.floor(cellIndex / puzzle.columns);
      context.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
    }
  }
}

function drawBoundaries(
  context: CanvasRenderingContext2D,
  puzzle: ColourPuzzle,
  cellSize: number,
  strokeStyle = "#3f4248",
  lineScale = 0.16,
) {
  context.strokeStyle = strokeStyle;
  context.lineWidth = Math.max(1, cellSize * lineScale);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();

  for (let row = 0; row < puzzle.rows; row += 1) {
    for (let col = 0; col < puzzle.columns; col += 1) {
      const index = row * puzzle.columns + col;
      const regionId = puzzle.regionIds[index];
      const x = col * cellSize;
      const y = row * cellSize;

      if (row === 0 || puzzle.regionIds[index - puzzle.columns] !== regionId) {
        context.moveTo(x, y);
        context.lineTo(x + cellSize, y);
      }
      if (col === puzzle.columns - 1 || puzzle.regionIds[index + 1] !== regionId) {
        context.moveTo(x + cellSize, y);
        context.lineTo(x + cellSize, y + cellSize);
      }
      if (row === puzzle.rows - 1 || puzzle.regionIds[index + puzzle.columns] !== regionId) {
        context.moveTo(x + cellSize, y + cellSize);
        context.lineTo(x, y + cellSize);
      }
      if (col === 0 || puzzle.regionIds[index - 1] !== regionId) {
        context.moveTo(x, y + cellSize);
        context.lineTo(x, y);
      }
    }
  }

  context.stroke();
}

function drawImageCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
) {
  const scale = Math.max(width / image.width, height / image.height);
  const scaledWidth = image.width * scale;
  const scaledHeight = image.height * scale;
  const x = (width - scaledWidth) / 2;
  const y = (height - scaledHeight) / 2;

  context.drawImage(image, x, y, scaledWidth, scaledHeight);
}

function buildRegions(colorIds: number[], columns: number, rows: number) {
  const regionIds = new Array<number>(colorIds.length).fill(-1);
  const regions: ColourRegion[] = [];
  let nextRegionId = 1;

  for (let index = 0; index < colorIds.length; index += 1) {
    if (regionIds[index] !== -1) {
      continue;
    }

    const colorId = colorIds[index];
    const queue = [index];
    const cells: number[] = [];
    let cursor = 0;
    regionIds[index] = nextRegionId;

    while (cursor < queue.length) {
      const current = queue[cursor];
      cursor += 1;
      cells.push(current);

      for (const neighbor of neighbors(current, columns, rows)) {
        if (regionIds[neighbor] !== -1 || colorIds[neighbor] !== colorId) {
          continue;
        }

        regionIds[neighbor] = nextRegionId;
        queue.push(neighbor);
      }
    }

    const center = regionLabelCell(cells, colorIds, colorId, columns, rows);
    regions.push({
      id: nextRegionId,
      colorId,
      cells,
      isPlayable: false,
      center,
    });
    nextRegionId += 1;
  }

  return { regionIds, regions };
}

function markPlayableRegions(regions: ColourRegion[], columns: number) {
  const placedLabels: Array<{ x: number; y: number }> = [];
  const minLabelDistance = 3.2;
  const minimumLabelRegion = Math.max(18, Math.round(columns * 0.28));

  for (const region of [...regions].sort((a, b) => b.cells.length - a.cells.length)) {
    if (region.cells.length < minimumLabelRegion) {
      region.isPlayable = false;
      continue;
    }

    const overlapsLabel = placedLabels.some((label) => {
      const dx = label.x - region.center.x;
      const dy = label.y - region.center.y;
      return Math.sqrt(dx * dx + dy * dy) < minLabelDistance;
    });

    region.isPlayable = !overlapsLabel;

    if (region.isPlayable) {
      placedLabels.push({ x: region.center.x, y: region.center.y });
    }
  }
}

function renumberPlayablePalette(regions: ColourRegion[], palette: PaletteColor[]) {
  const playableColorIds = new Set(regions.filter((region) => region.isPlayable).map((region) => region.colorId));
  const orderedPlayableColors = palette.filter((color) => playableColorIds.has(color.id));

  if (orderedPlayableColors.length === 0) {
    return palette;
  }

  const nextColorIds = new Map(orderedPlayableColors.map((color, index) => [color.id, index + 1]));

  for (const region of regions) {
    const nextColorId = nextColorIds.get(region.colorId);
    if (nextColorId) {
      region.colorId = nextColorId;
    }
  }

  return orderedPlayableColors.map((color, index) => ({
    ...color,
    id: index + 1,
  }));
}

function mergeTinyRegions(colorIds: number[], columns: number, rows: number) {
  let current = [...colorIds];
  const minimumRegionSize = Math.max(20, Math.round(columns * rows * 0.0016));

  for (let pass = 0; pass < 3; pass += 1) {
    const { regions } = buildRegions(current, columns, rows);
    const next = [...current];
    let changed = false;

    for (const region of regions) {
      if (region.cells.length >= minimumRegionSize) {
        continue;
      }

      const neighborCounts = new Map<number, number>();
      for (const cell of region.cells) {
        for (const neighbor of neighbors(cell, columns, rows)) {
          const neighborColor = current[neighbor];
          if (neighborColor !== region.colorId) {
            neighborCounts.set(neighborColor, (neighborCounts.get(neighborColor) ?? 0) + 1);
          }
        }
      }

      const replacement = [...neighborCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (!replacement) {
        continue;
      }

      for (const cell of region.cells) {
        next[cell] = replacement;
      }
      changed = true;
    }

    current = next;

    if (!changed) {
      break;
    }
  }

  return current;
}

function regionLabelCell(
  cells: number[],
  colorIds: number[],
  colorId: number,
  columns: number,
  rows: number,
) {
  const cellSet = new Set(cells);
  let bestCell = cells[0];
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const cell of cells) {
    const col = cell % columns;
    const row = Math.floor(cell / columns);
    const distance = distanceToBoundary(cell, cellSet, columns, rows);
    const sameColorNeighbors = neighbors(cell, columns, rows).filter((neighbor) => colorIds[neighbor] === colorId).length;
    const score = distance * 10 + sameColorNeighbors;

    if (score > bestScore) {
      bestScore = score;
      bestCell = cell;
    }

    if (col > 0 && col < columns - 1 && row > 0 && row < rows - 1 && distance >= 3) {
      bestScore = score;
      bestCell = cell;
    }
  }

  return {
    x: bestCell % columns,
    y: Math.floor(bestCell / columns),
  };
}

function distanceToBoundary(cell: number, cellSet: Set<number>, columns: number, rows: number) {
  const col = cell % columns;
  const row = Math.floor(cell / columns);
  let distance = 0;

  while (distance < 8) {
    distance += 1;
    for (let y = row - distance; y <= row + distance; y += 1) {
      for (let x = col - distance; x <= col + distance; x += 1) {
        if (x < 0 || y < 0 || x >= columns || y >= rows) {
          return distance - 1;
        }
        if (!cellSet.has(y * columns + x)) {
          return distance - 1;
        }
      }
    }
  }

  return distance;
}

function neighbors(index: number, columns: number, rows: number) {
  const col = index % columns;
  const row = Math.floor(index / columns);
  const result: number[] = [];

  if (col > 0) result.push(index - 1);
  if (col < columns - 1) result.push(index + 1);
  if (row > 0) result.push(index - columns);
  if (row < rows - 1) result.push(index + columns);

  return result;
}

function smoothColorIds(colorIds: number[], columns: number, rows: number) {
  let current = colorIds;

  for (let pass = 0; pass < 2; pass += 1) {
    current = current.map((colorId, index) => {
      const counts = new Map<number, number>();
      counts.set(colorId, 1);

      for (const neighbor of neighbors(index, columns, rows)) {
        counts.set(current[neighbor], (counts.get(current[neighbor]) ?? 0) + 1);
      }

      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    });
  }

  return current;
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
  const step = stride - (stride % 4);

  for (let i = 0; i < data.length; i += step) {
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
