import SavedAnalysisViewer from "./saved-analysis-viewer";

export default function Home() {
  return (
    <main className="notebook-shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">Saved wildlife analysis</p>
          <h1>WildScore</h1>
          <p className="handwritten">a field log you can listen to</p>
        </div>
      </header>

      <aside className="disclosure" aria-label="Saved analysis disclosure">
        <strong>This viewer replays results prepared ahead of time.</strong>
        <span>
          It does not upload footage or call a model from the browser. Every
          proposal still needs human review.
        </span>
      </aside>

      <SavedAnalysisViewer />

      <footer>
        Saved geometry and proposals remain inspectable after review. No API
        key, upload route or live inference is present in this static viewer.
      </footer>
    </main>
  );
}
