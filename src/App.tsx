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
  { label: "Easy", columns: 56, colors: 7 },
  { label: "Normal", columns: 96, colors: 12 },
  { label: "Detailed", columns: 124, colors: 18 },
];

const AI_STYLES = [
  { id: "storybook", label: "Storybook" },
  { id: "cartoon", label: "Cartoon" },
  { id: "fairytale", label: "Fairytale" },
  { id: "simple", label: "Simple" },
];

export function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [originalPhoto, setOriginalPhoto] = useState<{ dataUrl: string; name: string; type: string } | null>(null);
  const [sourceImage, setSourceImage] = useState<string>("");
  const [puzzle, setPuzzle] = useState<ColourPuzzle | null>(null);
  const [filledRegions, setFilledRegions] = useState<Set<number>>(() => new Set());
  const [selectedColorId, setSelectedColorId] = useState<number | null>(null);
  const [difficulty, setDifficulty] = useState(DIFFICULTIES[1]);
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [aiStyle, setAiStyle] = useState(AI_STYLES[0]);
  const [aiPreview, setAiPreview] = useState<string>("");
  const [aiError, setAiError] = useState<string>("");
  const [showCelebration, setShowCelebration] = useState(false);
  const [showBeforeAfter, setShowBeforeAfter] = useState(false);
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

    const playableRegions = puzzle.regions.filter((region) => region.isPlayable);
    const filledPlayableRegions = playableRegions.filter((region) => filledRegions.has(region.id));

    return Math.round((filledPlayableRegions.length / Math.max(1, playableRegions.length)) * 100);
  }, [filledRegions.size, puzzle]);

  const canSave = Boolean(sourceImage && puzzle);
  const isComplete = Boolean(puzzle && progress === 100);
  const playablePalette = useMemo(() => {
    if (!puzzle) {
      return [];
    }

    const playableColorIds = new Set(puzzle.regions.filter((region) => region.isPlayable).map((region) => region.colorId));
    return puzzle.palette.filter((color) => playableColorIds.has(color.id));
  }, [puzzle]);
  const selectedColor = playablePalette.find((color) => color.id === selectedColorId) ?? null;
  const completedImage = useMemo(() => {
    if (!puzzle || !isComplete) {
      return "";
    }

    return renderPuzzleToDataUrl(puzzle, filledRegions, false);
  }, [filledRegions, isComplete, puzzle]);

  useEffect(() => {
    if (!isComplete) {
      return;
    }

    setShowCelebration(true);
  }, [isComplete]);

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setStatus("Preparing the photo...");
    setIsProcessing(true);

    try {
      const dataUrl = await fileToDataUrl(file);
      setOriginalPhoto({ dataUrl, name: file.name || "photo.jpg", type: file.type || "image/jpeg" });
      setAiError("");
      setAiPreview("");

      const preview = await cartoonizePhoto(file);
      setAiPreview(preview);
      setSourceImage("");
      setPuzzle(null);
      setStatus("Review the AI drawing, then use it or update the style.");
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
    setShowCelebration(false);
    setShowBeforeAfter(false);
    const firstPlayableColorId = nextPuzzle.regions.find((region) => region.isPlayable)?.colorId ?? nextPuzzle.palette[0]?.id ?? null;
    setSelectedColorId(firstPlayableColorId);
    setStatus(`Puzzle ready: ${nextPuzzle.regions.filter((region) => region.isPlayable).length} numbered regions.`);
  }

  async function cartoonizePhoto(file: File) {
    setStatus("Creating an AI drawing...");
    setAiError("");
    const form = new FormData();
    form.append("image", file);
    form.append("style", aiStyle.id);

    const response = await fetch("/api/cartoonize", {
      method: "POST",
      body: form,
    });
    const payload = (await response.json()) as { imageDataUrl?: string; error?: string; model?: string; requestId?: string };

    if (!response.ok || !payload.imageDataUrl) {
      const details = [payload.error || "AI drawing mode failed.", payload.model && `Model: ${payload.model}`, payload.requestId && `Request: ${payload.requestId}`]
        .filter(Boolean)
        .join(" ");
      throw new Error(details);
    }

    setStatus("AI drawing ready. Building puzzle...");
    return payload.imageDataUrl;
  }

  async function retryAiPreview() {
    if (!originalPhoto) {
      return;
    }

    setIsProcessing(true);
    try {
      const nextPreview = await cartoonizePhoto(dataUrlToFile(originalPhoto.dataUrl, originalPhoto.name, originalPhoto.type));
      setAiPreview(nextPreview);
      setPuzzle(null);
      setSourceImage("");
      setStatus("Review the updated AI drawing.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI drawing mode failed.";
      setAiError(message);
      setStatus(message);
    } finally {
      setIsProcessing(false);
    }
  }

  async function useAiPreview() {
    if (!aiPreview) {
      return;
    }

    setIsProcessing(true);
    setSourceImage(aiPreview);
    setAiError("");
    setAiPreview("");
    try {
      await processImage(aiPreview, difficulty);
      setStatus("AI drawing turned into a puzzle.");
    } finally {
      setIsProcessing(false);
    }
  }

  async function useOriginalPhoto() {
    if (!originalPhoto) {
      return;
    }

    setAiPreview("");
    setIsProcessing(true);
    setSourceImage(originalPhoto.dataUrl);
    try {
      await processImage(originalPhoto.dataUrl, difficulty);
    } finally {
      setIsProcessing(false);
    }
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

    if (!region.isPlayable) {
      setStatus("That tiny detail does not count toward the puzzle.");
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
    setOriginalPhoto(null);
    setPuzzle(project.puzzle);
    setFilledRegions(new Set(project.filledRegions ?? []));
    setSelectedColorId(project.puzzle.regions.find((region) => region.isPlayable)?.colorId ?? project.puzzle.palette[0]?.id ?? null);
    setStatus(`${project.title} loaded.`);
  }

  function clearAll() {
    setFilledRegions(new Set());
    setShowCelebration(false);
    setShowBeforeAfter(false);
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
          {aiPreview ? (
            <div className="preview-panel">
              <img src={aiPreview} alt="AI drawing preview" />
              <div className="style-strip" aria-label="AI drawing style">
                {AI_STYLES.map((style) => (
                  <button
                    className={style.id === aiStyle.id ? "active" : ""}
                    key={style.id}
                    type="button"
                    onClick={() => setAiStyle(style)}
                  >
                    {style.label}
                  </button>
                ))}
              </div>
              <div className="preview-actions">
                <button type="button" onClick={useAiPreview}>
                  Use this
                </button>
                <button className="secondary" type="button" onClick={retryAiPreview}>
                  Update style
                </button>
                <button className="secondary" type="button" onClick={useOriginalPhoto}>
                  Use original
                </button>
              </div>
            </div>
          ) : puzzle ? (
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
        </div>
        {aiError && <p className="error-banner">{aiError}</p>}
        {showCelebration && (
          <div className="complete-banner">
            <div className="confetti" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <strong>Finished!</strong>
            <span>The picture is complete.</span>
            <button type="button" onClick={() => setShowBeforeAfter(true)}>
              Before / after
            </button>
          </div>
        )}
        {showBeforeAfter && sourceImage && completedImage && (
          <div className="compare-panel">
            <div>
              <h2>Original drawing</h2>
              <img src={sourceImage} alt="Original AI drawing" />
            </div>
            <div>
              <h2>Finished puzzle</h2>
              <img src={completedImage} alt="Completed colour-by-number puzzle" />
            </div>
            <button type="button" onClick={() => setShowBeforeAfter(false)}>
              Close
            </button>
          </div>
        )}
      </section>

      <aside className="side-panel">
        <section>
          <h2>Palette</h2>
          <div className="palette-grid">
            {puzzle ? (
              playablePalette.map((color: PaletteColor) => (
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
          {puzzle && (
            <button className="palette-clear" type="button" disabled={filledRegions.size === 0} onClick={clearAll}>
              Clear all
            </button>
          )}
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

function dataUrlToFile(dataUrl: string, name: string, type: string) {
  const [header, base64] = dataUrl.split(",");
  const mimeType = header.match(/data:(.*?);/)?.[1] || type;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new File([bytes], name, { type: mimeType });
}
