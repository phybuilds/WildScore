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
        <div className="sound-status" aria-label="Sound is not available yet">
          <span className="status-dot" aria-hidden="true" />
          Sound off
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

      <section className="evidence-strip" aria-labelledby="evidence-heading">
        <div>
          <p className="eyebrow">Evidence boundary</p>
          <h2 id="evidence-heading">Single-clip feasibility</h2>
        </div>
        <dl>
          <div>
            <dt>Models</dt>
            <dd>Meta SAM 3.1 + Muse Spark 1.3</dd>
          </div>
          <div>
            <dt>Evaluation</dt>
            <dd>No held-out estimate yet</dd>
          </div>
          <div>
            <dt>Known limits</dt>
            <dd>Camera motion, crowding and fragmented tracks</dd>
          </div>
        </dl>
      </section>

      <footer>
        Saved geometry and proposals remain inspectable after review. No API
        key, upload route or live inference is present in this static viewer.
      </footer>
    </main>
  );
}
