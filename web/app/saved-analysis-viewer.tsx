"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import type { CandidateEvent, WildScoreBundle } from "../../src/data/bundle-schema";
import { loadDemoBundle } from "../../src/data/load-demo";
import {
  buildFrameGeometryIndex,
  formatTime,
  frameAtTime,
  humanizeIdentifier,
  type VisibleGeometry,
} from "../../src/data/view-model";
import { buildEventCsv } from "../../src/export/event-csv";
import {
  bundleKey,
  createInitialReviewState,
  currentReviewedLabel,
  reviewReducer,
  reviewedEventCount,
  type ReviewState,
} from "../../src/review/review-state";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; bundle: WildScoreBundle };

function eventTitle(event: CandidateEvent): string {
  return event.event_kind === "appearance"
    ? "Appearance proposal"
    : "Disappearance proposal";
}

const EMPTY_REVIEW_STATE: ReviewState = {
  bundle_key: "",
  event_reviews: {},
  label_reviews: {},
};

export default function SavedAnalysisViewer() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [analysisVisible, setAnalysisVisible] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [replayEnd, setReplayEnd] = useState<number | null>(null);
  const [reviewState, dispatchReview] = useReducer(
    reviewReducer,
    EMPTY_REVIEW_STATE,
  );
  const videoRef = useRef<HTMLVideoElement>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadDemoBundle(controller.signal)
      .then((bundle) => {
        dispatchReview({ type: "load", bundle });
        setLoadState({ status: "ready", bundle });
        setSelectedEventId(bundle.events[0]?.event_id ?? null);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadState({
          status: "error",
          message:
            error instanceof Error ? error.message : "Saved analysis is unavailable",
        });
      });
    return () => controller.abort();
  }, []);

  const bundle = loadState.status === "ready" ? loadState.bundle : null;
  const activeReviewState = useMemo(
    () =>
      bundle && reviewState.bundle_key !== bundleKey(bundle)
        ? createInitialReviewState(bundle)
        : reviewState,
    [bundle, reviewState],
  );
  const geometryByFrame = useMemo<Map<number, VisibleGeometry[]>>(
    () => (bundle ? buildFrameGeometryIndex(bundle.segments) : new Map()),
    [bundle],
  );
  const currentFrame = bundle
    ? frameAtTime(
        currentTime,
        bundle.clip.processed_fps,
        bundle.clip.processed_frame_count,
      )
    : 0;
  const visibleGeometry = geometryByFrame.get(currentFrame) ?? [];
  const selectedEvent = bundle?.events.find(
    (event) => event.event_id === selectedEventId,
  );
  const selectedSegment = bundle?.segments.find(
    (segment) => segment.segment_id === selectedEvent?.segment_id,
  );
  const selectedLabel =
    bundle && selectedSegment
      ? currentReviewedLabel(
          bundle,
          activeReviewState,
          selectedSegment.segment_id,
        )
      : null;
  const selectedProposal = bundle?.label_proposals.find(
    (proposal) => proposal.segment_id === selectedSegment?.segment_id,
  );
  const selectedEventReview = selectedEvent
    ? activeReviewState.event_reviews[selectedEvent.event_id]
    : null;
  const selectedLabelReview = selectedSegment
    ? activeReviewState.label_reviews[selectedSegment.segment_id]
    : null;

  useEffect(() => {
    setDraftLabel(selectedLabel?.label ?? "");
  }, [selectedLabel?.label, selectedSegment?.segment_id]);

  function selectEvent(event: CandidateEvent) {
    setSelectedEventId(event.event_id);
    setAnalysisVisible(true);
    setReplayEnd(null);
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = Math.max(0, event.start_s - 0.35);
      setCurrentTime(video.currentTime);
    }
  }

  function replaySelectedEvent() {
    if (!selectedEvent || !bundle) return;
    const video = videoRef.current;
    if (!video) return;
    const start = Math.max(0, selectedEvent.start_s - 2);
    const end = Math.min(bundle.clip.processed_duration_s, selectedEvent.end_s + 2);
    video.currentTime = start;
    setCurrentTime(start);
    setReplayEnd(end);
    void video.play().catch(() => setReplayEnd(null));
  }

  function handleTimeUpdate(video: HTMLVideoElement) {
    setCurrentTime(video.currentTime);
    if (replayEnd !== null && video.currentTime >= replayEnd) {
      video.pause();
      setReplayEnd(null);
    }
  }

  function decideSelectedEvent(decision: "accepted" | "rejected") {
    if (!selectedEvent) return;
    dispatchReview({
      type: "decide_event",
      event_id: selectedEvent.event_id,
      decision,
      reviewer: "local_reviewer",
      reviewed_at: new Date().toISOString(),
    });
  }

  function saveLabel(value: string, correctionNote: string) {
    if (!selectedSegment || !selectedLabelReview) return;
    const normalized = value.trim().slice(0, 120);
    if (!normalized) return;
    dispatchReview({
      type: "review_label",
      segment_id: selectedSegment.segment_id,
      value: normalized,
      reviewer: "local_reviewer",
      reviewed_at: new Date().toISOString(),
      correction_note: correctionNote,
    });
  }

  function navigateEvent(direction: -1 | 1) {
    if (!bundle || bundle.events.length === 0) return;
    const currentIndex = bundle.events.findIndex(
      (event) => event.event_id === selectedEventId,
    );
    const nextIndex = Math.min(
      bundle.events.length - 1,
      Math.max(0, currentIndex + direction),
    );
    selectEvent(bundle.events[nextIndex]);
  }

  function downloadCsv() {
    if (!bundle) return;
    const blob = new Blob([buildEventCsv(bundle, activeReviewState)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${bundle.clip.clip_id}-wildscore-events.csv`;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function resetReviews() {
    if (!bundle) return;
    dispatchReview({ type: "reset", bundle });
  }

  useEffect(() => {
    if (!bundle) return;
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "j") navigateEvent(1);
      else if (key === "k") navigateEvent(-1);
      else if (key === "a") decideSelectedEvent("accepted");
      else if (key === "r") decideSelectedEvent("rejected");
      else if (key === "e") labelInputRef.current?.focus();
      else return;
      event.preventDefault();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  if (loadState.status !== "ready") {
    return (
      <section className="viewer-loading" aria-live="polite">
        <p className="eyebrow">Saved analysis viewer</p>
        <h2>
          {loadState.status === "loading"
            ? "Opening the field log…"
            : "Local demo unavailable"}
        </h2>
        <p>
          {loadState.status === "loading"
            ? "Validating the saved result before displaying it."
            : `${loadState.message}. No footage was uploaded.`}
        </p>
      </section>
    );
  }
  const readyBundle = loadState.bundle;

  return (
    <>
      <section className="workspace" aria-labelledby="workspace-heading">
        <div className="media-column">
          <div className="section-heading">
            <div>
              <p className="eyebrow">{readyBundle.clip.clip_id}</p>
              <h2 id="workspace-heading">Saved analysis viewer</h2>
            </div>
            <span className="saved-badge">Saved result</span>
          </div>

          <div className="photo-mount">
            <span className="tape tape-left" aria-hidden="true" />
            <span className="tape tape-right" aria-hidden="true" />
            <div
              className="video-stage"
              style={{
                aspectRatio: `${readyBundle.clip.width} / ${readyBundle.clip.height}`,
              }}
            >
              <video
                ref={videoRef}
                controls
                playsInline
                preload="metadata"
                src={`/demo/${encodeURIComponent(readyBundle.clip.display_media)}`}
                onLoadedMetadata={(event) =>
                  setCurrentTime(event.currentTarget.currentTime)
                }
                onSeeked={(event) => setCurrentTime(event.currentTarget.currentTime)}
                onTimeUpdate={(event) => handleTimeUpdate(event.currentTarget)}
                onEnded={() => setReplayEnd(null)}
              >
                Your browser does not support HTML video.
              </video>
              <svg
                className={`evidence-overlay ${analysisVisible ? "is-visible" : ""}`}
                viewBox={`0 0 ${readyBundle.clip.width} ${readyBundle.clip.height}`}
                preserveAspectRatio="xMidYMid meet"
                aria-hidden="true"
              >
                {visibleGeometry.map((geometry) => {
                  const isSelected =
                    geometry.segment_id === selectedEvent?.segment_id;
                  const label = currentReviewedLabel(
                    readyBundle,
                    activeReviewState,
                    geometry.segment_id,
                  );
                  const width = geometry.box.right - geometry.box.left;
                  const height = geometry.box.bottom - geometry.box.top;
                  return (
                    <g
                      className={isSelected ? "selected-geometry" : undefined}
                      key={`${geometry.segment_id}:${geometry.frame_index}`}
                    >
                      <rect
                        x={geometry.box.left}
                        y={geometry.box.top}
                        width={width}
                        height={height}
                        rx="5"
                      />
                      <text
                        x={Math.max(8, geometry.box.left)}
                        y={Math.max(24, geometry.box.top - 9)}
                      >
                        {label.source === "unlabelled"
                          ? geometry.segment_id
                          : humanizeIdentifier(label.label)}
                      </text>
                    </g>
                  );
                })}
              </svg>
              {analysisVisible && (
                <div className="frame-readout" aria-live="off">
                  Frame {currentFrame} · {visibleGeometry.length} visible segment
                  {visibleGeometry.length === 1 ? "" : "s"}
                </div>
              )}
            </div>
            <div className="photo-caption">
              <span>
                {formatTime(readyBundle.clip.processed_duration_s)} analysed at{" "}
                {readyBundle.clip.processed_fps} frames per second
              </span>
              <button
                className={analysisVisible ? "secondary-action" : "primary-action"}
                type="button"
                aria-pressed={analysisVisible}
                onClick={() => setAnalysisVisible((visible) => !visible)}
              >
                {analysisVisible ? "Hide saved analysis" : "View saved analysis"}
              </button>
            </div>
          </div>
        </div>

        <aside className="review-sheet" aria-labelledby="review-heading">
          <p className="eyebrow">Evidence selected</p>
          <h2 id="review-heading">
            {selectedEvent ? eventTitle(selectedEvent) : "No event selected"}
          </h2>
          {selectedEvent && selectedSegment && selectedLabel ? (
            <>
              <p className="event-time">
                {formatTime(selectedEvent.start_s)} · {selectedSegment.segment_id}
              </p>
              <p className={`review-status ${selectedEventReview?.decision ?? "proposed"}`}>
                Event {selectedEventReview?.decision ?? "proposed"}
              </p>
              <p className="review-copy">
                The saved detections {selectedEvent.event_kind === "appearance"
                  ? "begin"
                  : "end"} here. This is a review proposal, not proof that the
                animal entered or left the scene.
              </p>
              <dl className="event-facts">
                <div>
                  <dt>Current label</dt>
                  <dd>{humanizeIdentifier(selectedLabel.label)}</dd>
                </div>
                <div>
                  <dt>Label source</dt>
                  <dd>{selectedLabel.source}</dd>
                </div>
                <div>
                  <dt>Boundary evidence</dt>
                  <dd>{humanizeIdentifier(selectedEvent.boundary_evidence)}</dd>
                </div>
              </dl>
              {selectedProposal && (
                <div className="model-note">
                  <strong>Model proposal: {humanizeIdentifier(selectedProposal.label_id)}</strong>
                  <span>{selectedProposal.visible_evidence}</span>
                </div>
              )}
              {selectedEvent.uncertainty_flags.length > 0 && (
                <p className="uncertainty-note">
                  Check carefully: {selectedEvent.uncertainty_flags
                    .map(humanizeIdentifier)
                    .join(", ")}.
                </p>
              )}
              <button className="wide-button" type="button" onClick={replaySelectedEvent}>
                Replay 2 seconds either side
              </button>
              <div className="decision-row">
                <button
                  className={
                    selectedEventReview?.decision === "accepted"
                      ? "decision-active"
                      : undefined
                  }
                  type="button"
                  onClick={() => decideSelectedEvent("accepted")}
                >
                  Accept event <span aria-hidden="true">(A)</span>
                </button>
                <button
                  className={
                    selectedEventReview?.decision === "rejected"
                      ? "decision-active"
                      : undefined
                  }
                  type="button"
                  onClick={() => decideSelectedEvent("rejected")}
                >
                  Reject event <span aria-hidden="true">(R)</span>
                </button>
              </div>
              {selectedProposal && selectedLabelReview && (
                <form
                  className="label-review-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveLabel(draftLabel, "Corrected during local review.");
                  }}
                >
                  <label htmlFor="label-correction">Correct or confirm label</label>
                  <input
                    id="label-correction"
                    ref={labelInputRef}
                    value={draftLabel}
                    maxLength={120}
                    autoComplete="off"
                    onChange={(event) => setDraftLabel(event.target.value)}
                  />
                  <div className="label-actions">
                    <button type="submit">Save correction</button>
                    <button
                      type="button"
                      onClick={() =>
                        saveLabel(
                          selectedLabel.label,
                          "Confirmed during local review.",
                        )
                      }
                    >
                      Confirm current
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDraftLabel("unknown");
                        saveLabel(
                          "unknown",
                          "Reviewer selected can't tell.",
                        );
                      }}
                    >
                      Can’t tell
                    </button>
                  </div>
                  <p>
                    Label review: {selectedLabelReview.decision}. The original{" "}
                    {humanizeIdentifier(selectedProposal.label_id)} proposal is preserved.
                  </p>
                </form>
              )}
              <div className="review-navigation">
                <button type="button" onClick={() => navigateEvent(-1)}>
                  Previous <span aria-hidden="true">(K)</span>
                </button>
                <button type="button" onClick={() => navigateEvent(1)}>
                  Next <span aria-hidden="true">(J)</span>
                </button>
              </div>
              <p className="small-note">
                Event and label reviews are separate. Refresh resets this in-memory session.
              </p>
            </>
          ) : (
            <p className="review-copy">Choose an event marker from the log below.</p>
          )}
        </aside>
      </section>

      <section className="timeline-section" aria-labelledby="timeline-heading">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Temporal evidence</p>
            <h2 id="timeline-heading">Log of events</h2>
          </div>
          <span className="handwritten">
            {reviewedEventCount(activeReviewState)} of {readyBundle.events.length} events reviewed
          </span>
        </div>
        <div className="timeline-scale" aria-hidden="true">
          <span>0:00</span>
          <span>{formatTime(readyBundle.clip.processed_duration_s / 2)}</span>
          <span>{formatTime(readyBundle.clip.processed_duration_s)}</span>
        </div>
        <div className="timeline-list">
          {readyBundle.segments.map((segment) => {
            const label = currentReviewedLabel(
              readyBundle,
              activeReviewState,
              segment.segment_id,
            );
            const events = readyBundle.events.filter(
              (event) => event.segment_id === segment.segment_id,
            );
            const duration = readyBundle.clip.processed_duration_s;
            return (
              <div className="timeline-row" key={segment.segment_id}>
                <div className="timeline-label">
                  <strong>{humanizeIdentifier(label.label)}</strong>
                  <span>{segment.segment_id}</span>
                </div>
                <div className="timeline-track">
                  <span
                    className="presence-bar"
                    style={{
                      left: `${(segment.start_s / duration) * 100}%`,
                      width: `${Math.max(0.6, ((segment.end_s - segment.start_s) / duration) * 100)}%`,
                    }}
                  />
                  {events.map((event) => (
                    <button
                      className={`event-marker ${event.event_kind} ${
                        activeReviewState.event_reviews[event.event_id]?.decision ??
                        event.decision
                      } ${
                        event.event_id === selectedEventId ? "is-selected" : ""
                      }`}
                      key={event.event_id}
                      type="button"
                      style={{ left: `${(event.start_s / duration) * 100}%` }}
                      aria-label={`${eventTitle(event)} for ${segment.segment_id} at ${formatTime(event.start_s)}`}
                      aria-pressed={event.event_id === selectedEventId}
                      onClick={() => selectEvent(event)}
                    />
                  ))}
                  <span
                    className="timeline-playhead"
                    style={{ left: `${Math.min(100, (currentTime / duration) * 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <div className="timeline-legend">
          <span><i className="legend-presence" /> Saved presence</span>
          <span><i className="legend-appearance" /> Appearance proposal</span>
          <span><i className="legend-disappearance" /> Disappearance proposal</span>
        </div>
        <p className="timeline-note">
          Rows are gap-free segments, not persistent animal identities. Geometry remains visible
          regardless of later event decisions.
        </p>
      </section>

      <section className="event-table-section" aria-labelledby="event-table-heading">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Auditable export</p>
            <h2 id="event-table-heading">Event table</h2>
          </div>
          <div className="table-actions">
            <button type="button" onClick={resetReviews}>Reset reviews</button>
            <button className="primary-action" type="button" onClick={downloadCsv}>
              Download CSV
            </button>
          </div>
        </div>
        <div className="event-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Event</th>
                <th>Segment</th>
                <th>Current label</th>
                <th>Event status</th>
                <th>Label status</th>
              </tr>
            </thead>
            <tbody>
              {readyBundle.events.map((event) => {
                const label = currentReviewedLabel(
                  readyBundle,
                  activeReviewState,
                  event.segment_id,
                );
                return (
                  <tr key={event.event_id}>
                    <td>{formatTime(event.start_s)}</td>
                    <td>
                      <button
                        className="table-event-button"
                        type="button"
                        onClick={() => selectEvent(event)}
                      >
                        {humanizeIdentifier(event.event_kind)}
                      </button>
                    </td>
                    <td>{event.segment_id}</td>
                    <td>{humanizeIdentifier(label.label)}</td>
                    <td>
                      {activeReviewState.event_reviews[event.event_id]?.decision ??
                        event.decision}
                    </td>
                    <td>
                      {activeReviewState.label_reviews[event.segment_id]?.decision ??
                        "proposed"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="timeline-note">
          CSV includes every proposal, including rejected and unreviewed records. It is a
          WildScore event export, not a Camtrap DP package.
        </p>
      </section>
    </>
  );
}
