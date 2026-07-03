export type PaletteColor = {
  id: number;
  hex: string;
  rgb: [number, number, number];
};

export type ColourRegion = {
  id: number;
  colorId: number;
  cells: number[];
  center: {
    x: number;
    y: number;
  };
};

export type ColourPuzzle = {
  columns: number;
  rows: number;
  regionIds: number[];
  regions: ColourRegion[];
  palette: PaletteColor[];
};

export type SavedProject = {
  id: string;
  title: string;
  imageDataUrl: string;
  puzzle: ColourPuzzle;
  filledRegions: number[];
  previewDataUrl: string;
  palette: PaletteColor[];
  createdAt: string;
  updatedAt: string;
};
