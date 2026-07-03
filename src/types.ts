export type PaletteColor = {
  id: number;
  hex: string;
  rgb: [number, number, number];
};

export type ColourCell = {
  colorId: number;
};

export type ColourPuzzle = {
  columns: number;
  rows: number;
  cells: ColourCell[];
  palette: PaletteColor[];
};

export type SavedProject = {
  id: string;
  title: string;
  imageDataUrl: string;
  puzzle: ColourPuzzle;
  filledCells: number[];
  previewDataUrl: string;
  palette: PaletteColor[];
  createdAt: string;
  updatedAt: string;
};
