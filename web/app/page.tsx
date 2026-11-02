import SavedAnalysisViewer from "./saved-analysis-viewer";

export default function Home() {
  return (
    <main className="notebook-shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">Pre-saved demo</p>
          <h1>WildScore</h1>
          <p className="handwritten">a field log you can listen to</p>
        </div>
      </header>

      <SavedAnalysisViewer />

      <aside className="disclosure" aria-label="Saved analysis disclosure">
        <strong>Pre-saved demo.</strong>
        <span>No browser upload or live inference. Every proposal still needs human review.</span>
      </aside>
    </main>
  );
}
