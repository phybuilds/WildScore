"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import { buildEventCues } from "../../src/audio/cue-builder";
import { planCueWindow } from "../../src/audio/scheduler";
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
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [showAllSegments, setShowAllSegments] = useState(false);
  const [draftLabel, setDraftLabel] = useState("");
  const [replayEnd, setReplayEnd] = useState<number | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [scoreVolume, setScoreVolume] = useState(0.7);
  const [audioUnavailable, setAudioUnavailable] = useState(false);
  const [suppressedCueCount, setSuppressedCueCount] = useState(0);
  const [reviewState, dispatchReview] = useReducer(
    reviewReducer,
    EMPTY_REVIEW_STATE,
  );
  const videoRef = useRef<HTMLVideoElement>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const scheduledNodesRef = useRef(new Set<OscillatorNode>());
  const scheduleTimerRef = useRef<number | null>(null);
  const scheduledThroughRef = useRef(0);
  const suppressedEventIdsRef = useRef(new Set<string>());

  useEffect(() => {
    const controller = new AbortController();
    loadDemoBundle(controller.signal)
      .then((bundle) => {
        dispatchReview({ type: "load", bundle });
        setLoadState({ status: "ready", bundle });
        setSelectedEventId(bundle.events[0]?.event_id ?? null);
        setSelectedSegmentId(
          bundle.events[0]?.segment_id ?? bundle.segments[0]?.segment_id ?? null,
        );
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
  const selectedGeometry = visibleGeometry.filter(
    (geometry) => geometry.segment_id === selectedSegmentId,
  );
  const displayedGeometry = showAllSegments ? visibleGeometry : selectedGeometry;
  const selectedEvent = bundle?.events.find(
    (event) => event.event_id === selectedEventId,
  );
  const selectedSegment = bundle?.segments.find(
    (segment) => segment.segment_id === selectedSegmentId,
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
  const audioCues = useMemo(
    () => (bundle ? buildEventCues(bundle, activeReviewState) : []),
    [bundle, activeReviewState],
  );

  function cancelAudioSchedule() {
    if (scheduleTimerRef.current !== null) {
      window.clearInterval(scheduleTimerRef.current);
      scheduleTimerRef.current = null;
    }
    for (const oscillator of scheduledNodesRef.current) {
      try {
        oscillator.stop();
      } catch {
        // The node may already have ended between the event and cancellation.
      }
    }
    scheduledNodesRef.current.clear();
    scheduledThroughRef.current = videoRef.current?.currentTime ?? 0;
  }

  function resetSuppressedCues() {
    suppressedEventIdsRef.current.clear();
    setSuppressedCueCount(0);
  }

  function scheduleAudioWindow(video: HTMLVideoElement) {
    const context = audioContextRef.current;
    if (
      !soundEnabled ||
      !context ||
      context.state !== "running" ||
      video.paused ||
      video.ended ||
      video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA
    ) {
      return;
    }

    const playbackRate = video.playbackRate;
    const videoStart = Math.max(video.currentTime, scheduledThroughRef.current);
    const videoEnd = Math.min(
      video.duration,
      video.currentTime + 0.45 * playbackRate,
    );
    if (!Number.isFinite(videoEnd) || videoEnd <= videoStart) return;

    const plan = planCueWindow({
      cues: audioCues,
      videoStartS: videoStart,
      videoEndS: videoEnd,
      audioNowS:
        context.currentTime +
        0.025 +
        Math.max(0, videoStart - video.currentTime) / playbackRate,
      playbackRate,
    });

    for (const eventId of plan.suppressed_event_ids) {
      suppressedEventIdsRef.current.add(eventId);
    }
    setSuppressedCueCount(suppressedEventIdsRef.current.size);

    for (const note of plan.notes) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = Math.max(context.currentTime + 0.005, note.audio_start_s);
      const end = start + note.duration_s;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(note.frequency_hz, start);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(note.gain, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      oscillator.connect(gain);
      const masterGain = masterGainRef.current;
      if (!masterGain) continue;
      gain.connect(masterGain);
      oscillator.addEventListener(
        "ended",
        () => scheduledNodesRef.current.delete(oscillator),
        { once: true },
      );
      scheduledNodesRef.current.add(oscillator);
      oscillator.start(start);
      oscillator.stop(end + 0.01);
    }
    scheduledThroughRef.current = videoEnd;
  }

  function startAudioSchedule(video: HTMLVideoElement) {
    cancelAudioSchedule();
    scheduledThroughRef.current = video.currentTime;
    scheduleAudioWindow(video);
    scheduleTimerRef.current = window.setInterval(
      () => scheduleAudioWindow(video),
      120,
    );
  }

  async function toggleSound() {
    if (soundEnabled) {
      setSoundEnabled(false);
      cancelAudioSchedule();
      await audioContextRef.current?.suspend();
      return;
    }

    try {
      const context = audioContextRef.current ?? new AudioContext();
      audioContextRef.current = context;
      if (!masterGainRef.current) {
        const masterGain = context.createGain();
        masterGain.gain.setValueAtTime(scoreVolume, context.currentTime);
        masterGain.connect(context.destination);
        masterGainRef.current = masterGain;
      }
      await context.resume();
      setAudioUnavailable(false);
      setSoundEnabled(true);
    } catch {
      setAudioUnavailable(true);
      setSoundEnabled(false);
    }
  }

  function changeScoreVolume(value: number) {
    const volume = Math.min(1, Math.max(0, value));
    setScoreVolume(volume);
    const context = audioContextRef.current;
    const masterGain = masterGainRef.current;
    if (context && masterGain) {
      masterGain.gain.setTargetAtTime(volume, context.currentTime, 0.015);
    }
  }

  useEffect(() => {
    setDraftLabel(selectedLabel?.label ?? "");
  }, [selectedLabel?.label, selectedSegment?.segment_id]);

  useEffect(() => {
    const video = videoRef.current;
    cancelAudioSchedule();
    if (soundEnabled && video && !video.paused) startAudioSchedule(video);
  }, [audioCues, soundEnabled]);

  useEffect(
    () => () => {
      cancelAudioSchedule();
      void audioContextRef.current?.close();
    },
    [],
  );

  function selectEvent(event: CandidateEvent) {
    setSelectedEventId(event.event_id);
    setSelectedSegmentId(event.segment_id);
    setShowAllSegments(false);
    setAnalysisVisible(true);
    setReplayEnd(null);
    const video = videoRef.current;
    if (video) {
      cancelAudioSchedule();
      resetSuppressedCues();
      video.pause();
      video.currentTime = event.start_s;
      setCurrentTime(video.currentTime);
    }
  }

  function selectSegment(segmentId: string) {
    if (!bundle) return;
    const segment = bundle.segments.find(
      (candidate) => candidate.segment_id === segmentId,
    );
    if (!segment) return;
    const firstEvent = bundle.events
      .filter((event) => event.segment_id === segmentId)
      .sort((left, right) => left.start_s - right.start_s)[0];
    setSelectedSegmentId(segmentId);
    setShowAllSegments(false);
    setSelectedEventId(firstEvent?.event_id ?? null);
    setAnalysisVisible(true);
    setReplayEnd(null);
    const video = videoRef.current;
    if (video) {
      cancelAudioSchedule();
      resetSuppressedCues();
      video.pause();
      video.currentTime = Math.max(
        0,
        firstEvent?.start_s ?? segment.start_s,
      );
      setCurrentTime(video.currentTime);
    }
  }

  function replaySelectedEvent() {
    if (!selectedEvent || !bundle) return;
    const video = videoRef.current;
    if (!video) return;
    const start = Math.max(0, selectedEvent.start_s - 2);
    const end = Math.min(bundle.clip.processed_duration_s, selectedEvent.end_s + 2);
    cancelAudioSchedule();
    resetSuppressedCues();
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
                onPlay={(event) => {
                  resetSuppressedCues();
                  startAudioSchedule(event.currentTarget);
                }}
                onPause={cancelAudioSchedule}
                onSeeking={cancelAudioSchedule}
                onSeeked={(event) => {
                  setCurrentTime(event.currentTarget.currentTime);
                  resetSuppressedCues();
                  if (!event.currentTarget.paused) {
                    startAudioSchedule(event.currentTarget);
                  }
                }}
                onWaiting={cancelAudioSchedule}
                onPlaying={(event) => startAudioSchedule(event.currentTarget)}
                onRateChange={(event) => {
                  cancelAudioSchedule();
                  if (!event.currentTarget.paused) {
                    startAudioSchedule(event.currentTarget);
                  }
                }}
                onTimeUpdate={(event) => handleTimeUpdate(event.currentTarget)}
                onEnded={() => {
                  cancelAudioSchedule();
                  setReplayEnd(null);
                }}
              >
                Your browser does not support HTML video.
              </video>
              <svg
                className={`evidence-overlay ${analysisVisible ? "is-visible" : ""}`}
                viewBox={`0 0 ${readyBundle.clip.width} ${readyBundle.clip.height}`}
                preserveAspectRatio="xMidYMid meet"
                aria-hidden="true"
              >
                {displayedGeometry.map((geometry) => {
                  const label = currentReviewedLabel(
                    readyBundle,
                    activeReviewState,
                    geometry.segment_id,
                  );
                  const width = geometry.box.right - geometry.box.left;
                  const height = geometry.box.bottom - geometry.box.top;
                  return (
                    <g
                      className={
                        geometry.segment_id === selectedSegmentId
                          ? "selected-geometry"
                          : undefined
                      }
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
                  Frame {currentFrame} · {selectedGeometry.length > 0
                    ? showAllSegments
                      ? `${visibleGeometry.length} visible · ${selectedSegmentId} selected`
                      : `following ${selectedSegmentId}`
                    : showAllSegments
                      ? `${visibleGeometry.length} visible · selected segment not visible`
                      : "selected segment not visible at this frame"}
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
            <div className="segment-focus-bar">
              <label htmlFor="segment-focus">Follow segment</label>
              <select
                id="segment-focus"
                value={showAllSegments ? "__all__" : selectedSegmentId ?? ""}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  if (value === "__all__") {
                    setShowAllSegments(true);
                    setAnalysisVisible(true);
                  } else {
                    selectSegment(value);
                  }
                }}
              >
                <option value="__all__">View all segments</option>
                {[...readyBundle.segments]
                  .sort(
                    (left, right) =>
                      left.start_s - right.start_s ||
                      left.segment_id.localeCompare(right.segment_id),
                  )
                  .map((segment) => {
                    const label = currentReviewedLabel(
                      readyBundle,
                      activeReviewState,
                      segment.segment_id,
                    );
                    return (
                      <option value={segment.segment_id} key={segment.segment_id}>
                        {segment.segment_id} · {humanizeIdentifier(label.label)} · {formatTime(segment.start_s)}–{formatTime(segment.end_s)}
                      </option>
                    );
                  })}
              </select>
              <span>
                {showAllSegments
                  ? "All boxes are shown; the selected segment is yellow."
                  : "Only this segment’s saved box is shown."}
              </span>
            </div>
            <div className="sound-strip" aria-live="polite">
              <div className="sound-controls">
                <button
                  className={soundEnabled ? "sound-toggle is-on" : "sound-toggle"}
                  type="button"
                  aria-pressed={soundEnabled}
                  onClick={() => void toggleSound()}
                >
                  <span className="status-dot" aria-hidden="true" />
                  Sound {soundEnabled ? "on" : "off"}
                </button>
                <label className="score-volume">
                  <span>Score level {Math.round(scoreVolume * 100)}%</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={scoreVolume}
                    aria-label="Score volume"
                    onChange={(event) =>
                      changeScoreVolume(event.currentTarget.valueAsNumber)
                    }
                  />
                </label>
              </div>
              <p>
                <strong>Audio key:</strong> rising notes mark appearance proposals;
                falling notes mark disappearances. Accepted events sound stronger.
              </p>
              {suppressedCueCount > 0 && (
                <span className="sound-omission">
                  {suppressedCueCount} crowded cue
                  {suppressedCueCount === 1 ? "" : "s"} omitted
                </span>
              )}
              {audioUnavailable && (
                <span className="sound-omission">Audio is unavailable in this browser.</span>
              )}
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
              <p className="review-instruction">
                Review this event proposal—not the segment itself. If tracking
                starts after an animal was already visible, reject the appearance.
                If no box is visible at the boundary, replay the surrounding clip;
                choose can’t tell only when the evidence remains unclear.
              </p>
              <p className="occlusion-guidance">
                Reject a boundary caused only by brief occlusion, crowding or a
                tracker restart. Hiding behind another animal is not, by itself,
                an appearance or disappearance.
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
