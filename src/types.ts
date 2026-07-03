export type PaletteColor = {
  id: number;
  hex: string;
  rgb: [number, number, number];
};

export type SavedProject = {
  id: string;
  title: string;
  imageDataUrl: string;
  posterizedDataUrl: string;
  palette: PaletteColor[];
  createdAt: string;
  updatedAt: string;
};

