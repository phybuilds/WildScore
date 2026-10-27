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

      <section className="workspace" aria-labelledby="workspace-heading">
        <div className="media-column">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Clip 01</p>
              <h2 id="workspace-heading">Saved analysis viewer</h2>
            </div>
            <span className="saved-badge">Saved result</span>
          </div>

          <div className="photo-mount">
            <span className="tape tape-left" aria-hidden="true" />
            <span className="tape tape-right" aria-hidden="true" />
            <div className="video-placeholder">
              <p>Reviewed local demo assets have not been prepared.</p>
              <span>The interactive video and evidence overlay come next.</span>
            </div>
            <div className="photo-caption">
              <span>20.5 seconds analysed at 10 frames per second</span>
              <button type="button" disabled>
                View saved analysis
              </button>
            </div>
          </div>
        </div>

        <aside className="review-sheet" aria-labelledby="review-heading">
          <p className="eyebrow">Human review</p>
          <h2 id="review-heading">No event selected</h2>
          <p className="review-copy">
            Select a proposed appearance or disappearance from the timeline to
            inspect its video evidence. Event and species decisions stay
            separate.
          </p>
          <div className="evidence-placeholder" aria-hidden="true">
            evidence crop
          </div>
          <button className="wide-button" type="button" disabled>
            Replay this event
          </button>
          <div className="decision-row">
            <button type="button" disabled>
              Accept event
            </button>
            <button type="button" disabled>
              Reject event
            </button>
          </div>
          <p className="small-note">
            Controls remain unavailable until a validated local bundle is
            loaded.
          </p>
        </aside>
      </section>

      <section className="timeline-section" aria-labelledby="timeline-heading">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Temporal evidence</p>
            <h2 id="timeline-heading">Log of events</h2>
          </div>
          <span className="handwritten">presence first, claims second</span>
        </div>
        <div className="empty-timeline">
          <span>0:00</span>
          <div className="timeline-rule" />
          <span>0:20.5</span>
        </div>
        <p className="timeline-note">
          Presence segments and candidate events will appear here from the
          validated saved bundle—never from placeholder data.
        </p>
      </section>

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
