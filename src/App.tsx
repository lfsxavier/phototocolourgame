import { ChangeEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  createPuzzle,
  fileToDataUrl,
  regionAtPoint,
  renderPuzzleToCanvas,
  renderPuzzleToDataUrl,
} from "./imageProcessing";
import { listProjects, saveProject } from "./db";
import type { ColourPuzzle, PaletteColor, SavedProject } from "./types";

const DIFFICULTIES = [
  { label: "Easy", columns: 72, colors: 8 },
  { label: "Bright", columns: 96, colors: 12 },
  { label: "Detailed", columns: 124, colors: 18 },
];

export function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [sourceImage, setSourceImage] = useState<string>("");
  const [puzzle, setPuzzle] = useState<ColourPuzzle | null>(null);
  const [filledRegions, setFilledRegions] = useState<Set<number>>(() => new Set());
  const [selectedColorId, setSelectedColorId] = useState<number | null>(null);
  const [difficulty, setDifficulty] = useState(DIFFICULTIES[0]);
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState("Choose a photo to begin.");

  useEffect(() => {
    listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    if (!puzzle || !canvasRef.current) {
      return;
    }

    renderPuzzleToCanvas(canvasRef.current, puzzle, filledRegions, true);
  }, [filledRegions, puzzle]);

  const progress = useMemo(() => {
    if (!puzzle) {
      return 0;
    }

    return Math.round((filledRegions.size / puzzle.regions.length) * 100);
  }, [filledRegions.size, puzzle]);

  const canSave = Boolean(sourceImage && puzzle);
  const selectedColor = puzzle?.palette.find((color) => color.id === selectedColorId) ?? null;

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setStatus("Preparing the photo...");
    setIsProcessing(true);

    try {
      const dataUrl = await fileToDataUrl(file);
      setSourceImage(dataUrl);
      await processImage(dataUrl, difficulty);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Something went wrong with that photo.");
    } finally {
      setIsProcessing(false);
      event.target.value = "";
    }
  }

  async function processImage(dataUrl: string, nextDifficulty: (typeof DIFFICULTIES)[number]) {
    const nextPuzzle = await createPuzzle(dataUrl, {
      columns: nextDifficulty.columns,
      paletteSize: nextDifficulty.colors,
    });

    setPuzzle(nextPuzzle);
    setFilledRegions(new Set());
    setSelectedColorId(nextPuzzle.palette[0]?.id ?? null);
    setStatus(`Puzzle ready: ${nextPuzzle.regions.length} numbered regions.`);
  }

  async function handleDifficultyChange(nextDifficulty: (typeof DIFFICULTIES)[number]) {
    setDifficulty(nextDifficulty);

    if (!sourceImage) {
      return;
    }

    setIsProcessing(true);
    setStatus("Rebuilding the puzzle...");
    try {
      await processImage(sourceImage, nextDifficulty);
    } finally {
      setIsProcessing(false);
    }
  }

  function handleCanvasClick(event: MouseEvent<HTMLCanvasElement>) {
    if (!puzzle || !canvasRef.current || selectedColorId === null) {
      return;
    }

    const regionId = regionAtPoint(puzzle, canvasRef.current, event.clientX, event.clientY);
    const region = puzzle.regions.find((item) => item.id === regionId);

    if (!region) {
      return;
    }

    if (region.colorId !== selectedColorId) {
      setStatus(`That region is number ${region.colorId}. Choose colour ${region.colorId} to fill it.`);
      return;
    }

    setFilledRegions((current) => {
      const next = new Set(current);
      next.add(region.id);
      return next;
    });
    setStatus(`Filled number ${selectedColorId}.`);
  }

  async function handleSave() {
    if (!sourceImage || !puzzle) {
      return;
    }

    const now = new Date().toISOString();
    const filled = Array.from(filledRegions);
    const project: SavedProject = {
      id: crypto.randomUUID(),
      title: `Drawing ${projects.length + 1}`,
      imageDataUrl: sourceImage,
      puzzle,
      filledRegions: filled,
      previewDataUrl: renderPuzzleToDataUrl(puzzle, new Set(filled), false),
      palette: puzzle.palette,
      createdAt: now,
      updatedAt: now,
    };

    await saveProject(project);
    const nextProjects = await listProjects();
    setProjects(nextProjects);
    setStatus("Progress saved on this device.");
  }

  function loadProject(project: SavedProject) {
    if (!project.puzzle?.regions) {
      setStatus("That saved drawing uses an older format. Please recreate it from the photo.");
      return;
    }

    setSourceImage(project.imageDataUrl);
    setPuzzle(project.puzzle);
    setFilledRegions(new Set(project.filledRegions ?? []));
    setSelectedColorId(project.puzzle.palette[0]?.id ?? null);
    setStatus(`${project.title} loaded.`);
  }

  function clearAll() {
    setFilledRegions(new Set());
    setStatus("Cleared the current puzzle.");
  }

  function exportImage() {
    if (!puzzle) {
      return;
    }

    const link = document.createElement("a");
    link.href = renderPuzzleToDataUrl(puzzle, filledRegions, false);
    link.download = "colour-snap-finished.png";
    link.click();
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="top-bar">
          <div>
            <p className="eyebrow">Photo to colour-by-number</p>
            <h1>Colour Snap</h1>
          </div>
          <label className="photo-button">
            <input accept="image/*" capture="environment" type="file" onChange={handlePhotoChange} />
            <span>Choose photo</span>
          </label>
        </header>

        <div className="canvas-panel">
          {puzzle ? (
            <canvas
              aria-label="Playable colour-by-number puzzle"
              className="puzzle-canvas"
              ref={canvasRef}
              role="img"
              onClick={handleCanvasClick}
            />
          ) : (
            <div className="empty-state">
              <strong>Start with a picture</strong>
              <span>Pick a photo and this will turn it into a playable numbered puzzle.</span>
            </div>
          )}
          {isProcessing && <div className="processing">Processing...</div>}
        </div>

        <div className="control-strip">
          <div className="segmented" aria-label="Difficulty">
            {DIFFICULTIES.map((item) => (
              <button
                className={item.columns === difficulty.columns ? "active" : ""}
                key={item.label}
                type="button"
                onClick={() => handleDifficultyChange(item)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button type="button" disabled={!canSave} onClick={handleSave}>
            Save progress
          </button>
          <button type="button" disabled={!puzzle} onClick={exportImage}>
            Export picture
          </button>
          <button className="secondary" type="button" disabled={!puzzle || filledRegions.size === 0} onClick={clearAll}>
            Clear all
          </button>
        </div>
      </section>

      <aside className="side-panel">
        <section>
          <h2>Palette</h2>
          <div className="palette-grid">
            {puzzle ? (
              puzzle.palette.map((color: PaletteColor) => (
                <button
                  className={color.id === selectedColorId ? "swatch selected" : "swatch"}
                  key={color.id}
                  type="button"
                  onClick={() => {
                    setSelectedColorId(color.id);
                    setStatus(`Selected colour ${color.id}.`);
                  }}
                >
                  <span style={{ background: color.hex }} />
                  <strong>{color.id}</strong>
                </button>
              ))
            ) : (
              <p className="muted">Colours will appear after choosing a photo.</p>
            )}
          </div>
          {selectedColor && <p className="hint">Selected: number {selectedColor.id}</p>}
        </section>

        <section>
          <h2>Saved</h2>
          <div className="saved-list">
            {projects.length > 0 ? (
              projects.map((project) => (
                <button key={project.id} type="button" onClick={() => loadProject(project)}>
                  <img src={project.previewDataUrl || project.imageDataUrl} alt="" />
                  <span>{project.title}</span>
                </button>
              ))
            ) : (
              <p className="muted">Saved progress stays on this device.</p>
            )}
          </div>
        </section>

        <p className="status">{puzzle ? `${progress}% complete. ${status}` : status}</p>
      </aside>
    </main>
  );
}
