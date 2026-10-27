"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { CandidateEvent, WildScoreBundle } from "../../src/data/bundle-schema";
import { loadDemoBundle } from "../../src/data/load-demo";
import {
  buildFrameGeometryIndex,
  currentSegmentLabel,
  formatTime,
  frameAtTime,
  humanizeIdentifier,
  type VisibleGeometry,
} from "../../src/data/view-model";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; bundle: WildScoreBundle };

function eventTitle(event: CandidateEvent): string {
  return event.event_kind === "appearance"
    ? "Appearance proposal"
    : "Disappearance proposal";
}

export default function SavedAnalysisViewer() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [analysisVisible, setAnalysisVisible] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadDemoBundle(controller.signal)
      .then((bundle) => {
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
      ? currentSegmentLabel(bundle, selectedSegment.segment_id)
      : null;
  const selectedProposal = bundle?.label_proposals.find(
    (proposal) => proposal.segment_id === selectedSegment?.segment_id,
  );

  function selectEvent(event: CandidateEvent) {
    setSelectedEventId(event.event_id);
    setAnalysisVisible(true);
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = Math.max(0, event.start_s - 0.35);
      setCurrentTime(video.currentTime);
    }
  }

  function jumpToSelectedEvent() {
    if (selectedEvent) selectEvent(selectedEvent);
  }

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
                onTimeUpdate={(event) =>
                  setCurrentTime(event.currentTarget.currentTime)
                }
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
                  const label = currentSegmentLabel(
                    readyBundle,
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
              <button className="wide-button" type="button" onClick={jumpToSelectedEvent}>
                Jump to evidence
              </button>
              <div className="decision-row">
                <button type="button" disabled>Accept event</button>
                <button type="button" disabled>Reject event</button>
              </div>
              <p className="small-note">
                Event decisions are intentionally disabled until the review-state milestone.
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
          <span className="handwritten">presence first, claims second</span>
        </div>
        <div className="timeline-scale" aria-hidden="true">
          <span>0:00</span>
          <span>{formatTime(readyBundle.clip.processed_duration_s / 2)}</span>
          <span>{formatTime(readyBundle.clip.processed_duration_s)}</span>
        </div>
        <div className="timeline-list">
          {readyBundle.segments.map((segment) => {
            const label = currentSegmentLabel(readyBundle, segment.segment_id);
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
    </>
  );
}
