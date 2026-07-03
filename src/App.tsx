import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { fileToDataUrl, posterizeImage } from "./imageProcessing";
import { listProjects, saveProject } from "./db";
import type { PaletteColor, SavedProject } from "./types";

const DIFFICULTIES = [
  { label: "Easy", colors: 8 },
  { label: "Bright", colors: 12 },
  { label: "Detailed", colors: 18 },
];

export function App() {
  const [sourceImage, setSourceImage] = useState<string>("");
  const [posterizedImage, setPosterizedImage] = useState<string>("");
  const [palette, setPalette] = useState<PaletteColor[]>([]);
  const [difficulty, setDifficulty] = useState(DIFFICULTIES[0]);
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState("Choose a photo to begin.");

  useEffect(() => {
    listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  const canSave = useMemo(() => Boolean(sourceImage && posterizedImage), [posterizedImage, sourceImage]);

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
      await processImage(dataUrl, difficulty.colors);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Something went wrong with that photo.");
    } finally {
      setIsProcessing(false);
      event.target.value = "";
    }
  }

  async function processImage(dataUrl: string, colorCount: number) {
    const processed = await posterizeImage(dataUrl, colorCount);
    setPosterizedImage(processed.dataUrl);
    setPalette(processed.palette);
    setStatus(`Canvas ready with ${processed.palette.length} colours.`);
  }

  async function handleDifficultyChange(nextDifficulty: (typeof DIFFICULTIES)[number]) {
    setDifficulty(nextDifficulty);

    if (!sourceImage) {
      return;
    }

    setIsProcessing(true);
    setStatus("Rebuilding the canvas...");
    try {
      await processImage(sourceImage, nextDifficulty.colors);
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleSave() {
    if (!canSave) {
      return;
    }

    const now = new Date().toISOString();
    const project: SavedProject = {
      id: crypto.randomUUID(),
      title: `Drawing ${projects.length + 1}`,
      imageDataUrl: sourceImage,
      posterizedDataUrl: posterizedImage,
      palette,
      createdAt: now,
      updatedAt: now,
    };

    await saveProject(project);
    const nextProjects = await listProjects();
    setProjects(nextProjects);
    setStatus("Saved on this device.");
  }

  function loadProject(project: SavedProject) {
    setSourceImage(project.imageDataUrl);
    setPosterizedImage(project.posterizedDataUrl);
    setPalette(project.palette);
    setStatus(`${project.title} loaded.`);
  }

  function exportImage() {
    if (!posterizedImage) {
      return;
    }

    const link = document.createElement("a");
    link.href = posterizedImage;
    link.download = "colour-snap-canvas.png";
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
          {posterizedImage ? (
            <img className="canvas-image" src={posterizedImage} alt="Generated colour canvas" />
          ) : (
            <div className="empty-state">
              <strong>Start with a picture</strong>
              <span>Pick a photo and this first version will turn it into a simplified colour canvas.</span>
            </div>
          )}
          {isProcessing && <div className="processing">Processing...</div>}
        </div>

        <div className="control-strip">
          <div className="segmented" aria-label="Difficulty">
            {DIFFICULTIES.map((item) => (
              <button
                className={item.colors === difficulty.colors ? "active" : ""}
                key={item.label}
                type="button"
                onClick={() => handleDifficultyChange(item)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button type="button" disabled={!canSave} onClick={handleSave}>
            Save
          </button>
          <button type="button" disabled={!posterizedImage} onClick={exportImage}>
            Export PNG
          </button>
        </div>
      </section>

      <aside className="side-panel">
        <section>
          <h2>Palette</h2>
          <div className="palette-grid">
            {palette.length > 0 ? (
              palette.map((color) => (
                <div className="swatch" key={color.id}>
                  <span style={{ background: color.hex }} />
                  <strong>{color.id}</strong>
                </div>
              ))
            ) : (
              <p className="muted">Colours will appear after choosing a photo.</p>
            )}
          </div>
        </section>

        <section>
          <h2>Saved</h2>
          <div className="saved-list">
            {projects.length > 0 ? (
              projects.map((project) => (
                <button key={project.id} type="button" onClick={() => loadProject(project)}>
                  <img src={project.posterizedDataUrl} alt="" />
                  <span>{project.title}</span>
                </button>
              ))
            ) : (
              <p className="muted">Saved drawings stay on this device.</p>
            )}
          </div>
        </section>

        <p className="status">{status}</p>
      </aside>
    </main>
  );
}

