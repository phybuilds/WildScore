"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import { buildEventCues } from "../../src/audio/cue-builder";
import { planCueWindow } from "../../src/audio/scheduler";
import type { CandidateEvent, WildScoreBundle } from "../../src/data/bundle-schema";
import {
  loadDemoBundle,
  loadRecoveryCandidateBundle,
} from "../../src/data/load-demo";
import type {
  RecoveryCandidate,
  RecoveryCandidateBundle,
} from "../../src/data/recovery-schema";
import {
  buildFrameGeometryIndex,
  eventAnchorTime,
  formatTime,
  frameAtTime,
  geometryAnchorTime,
  humanizeIdentifier,
  type VisibleGeometry,
} from "../../src/data/view-model";
import { buildEventCsv } from "../../src/export/event-csv";
import { buildRecoveryCsv } from "../../src/export/recovery-csv";
import { buildDevelopmentEvidenceSummary } from "../../src/evaluation/evidence-summary";
import {
  bundleKey,
  createInitialReviewState,
  currentReviewedLabel,
  reviewReducer,
  reviewedEventCount,
  type ReviewState,
} from "../../src/review/review-state";
import {
  createInitialRecoveryReviewState,
  recoveryBundleKey,
  recoveryReviewReducer,
  reviewedRecoveryCount,
  type RecoveryReviewState,
} from "../../src/review/recovery-state";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      bundle: WildScoreBundle;
      recovery: RecoveryCandidateBundle;
    };

type AudioScope =
  | { kind: "all" }
  | { kind: "segment"; segmentId: string }
  | { kind: "event"; eventId: string }
  | { kind: "silent" };

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

const EMPTY_RECOVERY_REVIEW_STATE: RecoveryReviewState = {
  bundle_key: "",
  decisions: {},
  label_decisions: {},
};

function reviewChangeCount(
  exported: ReviewState | null,
  current: ReviewState,
): number {
  if (!exported || exported.bundle_key !== current.bundle_key) return 0;
  const eventIds = new Set([
    ...Object.keys(exported.event_reviews),
    ...Object.keys(current.event_reviews),
  ]);
  const segmentIds = new Set([
    ...Object.keys(exported.label_reviews),
    ...Object.keys(current.label_reviews),
  ]);
  let changed = 0;
  for (const eventId of eventIds) {
    if (
      JSON.stringify(exported.event_reviews[eventId]) !==
      JSON.stringify(current.event_reviews[eventId])
    ) {
      changed += 1;
    }
  }
  for (const segmentId of segmentIds) {
    if (
      JSON.stringify(exported.label_reviews[segmentId]) !==
      JSON.stringify(current.label_reviews[segmentId])
    ) {
      changed += 1;
    }
  }
  return changed;
}

function recoveryStorageKey(bundle: RecoveryCandidateBundle): string {
  return `wildscore:recovery:${recoveryBundleKey(bundle)}`;
}

function recoveryLabelStorageKey(bundle: RecoveryCandidateBundle): string {
  return `wildscore:recovery-labels:${recoveryBundleKey(bundle)}`;
}

export default function SavedAnalysisViewer() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [analysisVisible, setAnalysisVisible] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [selectedRecoveryId, setSelectedRecoveryId] = useState<string | null>(null);
  const [showAllSegments, setShowAllSegments] = useState(false);
  const [draftLabel, setDraftLabel] = useState("");
  const [bulkLabel, setBulkLabel] = useState("baboon");
  const [selectedEventIds, setSelectedEventIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [recoveryDraftLabel, setRecoveryDraftLabel] = useState("unknown");
  const [replayEnd, setReplayEnd] = useState<number | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [scoreVolume, setScoreVolume] = useState(0.7);
  const [appearanceSoundEnabled, setAppearanceSoundEnabled] = useState(true);
  const [disappearanceSoundEnabled, setDisappearanceSoundEnabled] = useState(true);
  const [audioUnavailable, setAudioUnavailable] = useState(false);
  const [suppressedCueCount, setSuppressedCueCount] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const [reviewState, dispatchReview] = useReducer(
    reviewReducer,
    EMPTY_REVIEW_STATE,
  );
  const [exportedReviewState, setExportedReviewState] =
    useState<ReviewState | null>(null);
  const [recoveryReviewState, dispatchRecoveryReview] = useReducer(
    recoveryReviewReducer,
    EMPTY_RECOVERY_REVIEW_STATE,
  );
  const videoRef = useRef<HTMLVideoElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const recoveryMenuRef = useRef<HTMLDetailsElement>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const scheduledNodesRef = useRef(new Set<OscillatorNode>());
  const scheduleTimerRef = useRef<number | null>(null);
  const videoFrameCallbackRef = useRef<number | null>(null);
  const scheduledThroughRef = useRef(0);
  const suppressedEventIdsRef = useRef(new Set<string>());
  const audioScopeRef = useRef<AudioScope>({ kind: "all" });

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      loadDemoBundle(controller.signal),
      loadRecoveryCandidateBundle(controller.signal),
    ])
      .then(([bundle, recovery]) => {
        dispatchReview({ type: "load", bundle });
        setExportedReviewState(createInitialReviewState(bundle));
        let storedRecoveryDecisions: unknown = null;
        try {
          const stored = window.localStorage.getItem(recoveryStorageKey(recovery));
          storedRecoveryDecisions = stored ? JSON.parse(stored) : null;
        } catch {
          storedRecoveryDecisions = null;
        }
        dispatchRecoveryReview({
          type: "restore",
          bundle: recovery,
          decisions: storedRecoveryDecisions,
        });
        try {
          const stored = window.localStorage.getItem(recoveryLabelStorageKey(recovery));
          dispatchRecoveryReview({
            type: "restore_labels",
            bundle: recovery,
            labels: stored ? JSON.parse(stored) : null,
          });
        } catch {
          dispatchRecoveryReview({ type: "restore_labels", bundle: recovery, labels: null });
        }
        setLoadState({ status: "ready", bundle, recovery });
        setSelectedEventId(bundle.events[0]?.event_id ?? null);
        setSelectedSegmentId(
          bundle.events[0]?.segment_id ?? bundle.segments[0]?.segment_id ?? null,
        );
        const initialSegmentId =
          bundle.events[0]?.segment_id ?? bundle.segments[0]?.segment_id;
        audioScopeRef.current = initialSegmentId
          ? { kind: "segment", segmentId: initialSegmentId }
          : { kind: "all" };
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
  const recovery = loadState.status === "ready" ? loadState.recovery : null;
  const activeReviewState = useMemo(
    () =>
      bundle && reviewState.bundle_key !== bundleKey(bundle)
        ? createInitialReviewState(bundle)
        : reviewState,
    [bundle, reviewState],
  );
  const unexportedChangeCount = useMemo(
    () => reviewChangeCount(exportedReviewState, activeReviewState),
    [exportedReviewState, activeReviewState],
  );
  const geometryByFrame = useMemo<Map<number, VisibleGeometry[]>>(
    () => (bundle ? buildFrameGeometryIndex(bundle.segments) : new Map()),
    [bundle],
  );
  const recoveryGeometryByFrame = useMemo<Map<number, VisibleGeometry[]>>(() => {
    const index = new Map<number, VisibleGeometry[]>();
    if (!recovery) return index;
    for (const candidate of recovery.candidates) {
      for (const geometry of candidate.geometry) {
        const records = index.get(geometry.frame_index) ?? [];
        records.push({
          ...geometry,
          segment_id: candidate.candidate_id,
          sam_object_id: `${candidate.source_prompt}:${candidate.source_object_id}`,
        });
        index.set(geometry.frame_index, records);
      }
    }
    return index;
  }, [recovery]);
  const activeRecoveryReviewState = useMemo(
    () =>
      recovery && recoveryReviewState.bundle_key !== recoveryBundleKey(recovery)
        ? createInitialRecoveryReviewState(recovery)
        : recoveryReviewState,
    [recovery, recoveryReviewState],
  );
  const selectedRecovery = recovery?.candidates.find(
    (candidate) => candidate.candidate_id === selectedRecoveryId,
  );
  const selectedRecoveryProposal = recovery?.label_proposals.find(
    (proposal) => proposal.candidate_id === selectedRecoveryId,
  );
  const baseFrame = bundle
    ? frameAtTime(
        currentTime,
        bundle.clip.processed_fps,
        bundle.clip.processed_frame_count,
      )
    : 0;
  const recoveryFrame = recovery
    ? frameAtTime(
        currentTime,
        recovery.processed_fps,
        recovery.processed_frame_count,
      )
    : 0;
  const currentFrame = selectedRecovery ? recoveryFrame : baseFrame;
  const visibleGeometry = selectedRecovery
    ? recoveryGeometryByFrame.get(recoveryFrame) ?? []
    : geometryByFrame.get(baseFrame) ?? [];
  const selectedGeometry = visibleGeometry.filter(
    (geometry) =>
      geometry.segment_id ===
      (selectedRecovery?.candidate_id ?? selectedSegmentId),
  );
  const displayedGeometry = selectedRecovery
    ? selectedGeometry
    : showAllSegments
      ? visibleGeometry
      : selectedGeometry;
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
  const baseAudioCues = useMemo(
    () =>
      bundle
        ? buildEventCues(bundle, activeReviewState).filter(
            (cue) =>
              (cue.event_kind === "appearance" && appearanceSoundEnabled) ||
              (cue.event_kind === "disappearance" && disappearanceSoundEnabled),
          )
        : [],
    [
      bundle,
      activeReviewState,
      appearanceSoundEnabled,
      disappearanceSoundEnabled,
    ],
  );

  function scopedAudioCues() {
    const scope = audioScopeRef.current;
    if (scope.kind === "silent") return [];
    if (scope.kind === "event") {
      return baseAudioCues.filter((cue) => cue.event_id === scope.eventId);
    }
    if (scope.kind === "segment") {
      return baseAudioCues.filter((cue) => cue.segment_id === scope.segmentId);
    }
    return baseAudioCues;
  }

  useEffect(() => {
    if (
      !recovery ||
      recoveryReviewState.bundle_key !== recoveryBundleKey(recovery)
    ) {
      return;
    }
    try {
      window.localStorage.setItem(
        recoveryStorageKey(recovery),
        JSON.stringify(recoveryReviewState.decisions),
      );
    } catch {
      // Review remains usable in memory when browser storage is unavailable.
    }
  }, [recovery, recoveryReviewState]);

  useEffect(() => {
    if (!recovery || recoveryReviewState.bundle_key !== recoveryBundleKey(recovery)) return;
    try {
      window.localStorage.setItem(
        recoveryLabelStorageKey(recovery),
        JSON.stringify(recoveryReviewState.label_decisions),
      );
    } catch {}
  }, [recovery, recoveryReviewState]);

  useEffect(() => {
    setRecoveryDraftLabel(selectedRecoveryProposal?.label_id ?? "unknown");
  }, [selectedRecoveryProposal]);

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

  function stopVideoFrameSync(video: HTMLVideoElement | null) {
    if (
      video &&
      videoFrameCallbackRef.current !== null &&
      typeof video.cancelVideoFrameCallback === "function"
    ) {
      video.cancelVideoFrameCallback(videoFrameCallbackRef.current);
    }
    videoFrameCallbackRef.current = null;
  }

  function startVideoFrameSync(video: HTMLVideoElement) {
    stopVideoFrameSync(video);
    setCurrentTime(video.currentTime);
    if (typeof video.requestVideoFrameCallback !== "function") return;

    const updateFromDisplayedFrame: VideoFrameRequestCallback = (
      _now,
      metadata,
    ) => {
      setCurrentTime(metadata.mediaTime);
      if (!video.paused && !video.ended) {
        videoFrameCallbackRef.current = video.requestVideoFrameCallback(
          updateFromDisplayedFrame,
        );
      } else {
        videoFrameCallbackRef.current = null;
      }
    };
    videoFrameCallbackRef.current = video.requestVideoFrameCallback(
      updateFromDisplayedFrame,
    );
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
      cues: scopedAudioCues(),
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
      const panner = context.createStereoPanner();
      const start = Math.max(context.currentTime + 0.005, note.audio_start_s);
      const end = start + note.duration_s;
      oscillator.type = note.oscillator_type;
      oscillator.frequency.setValueAtTime(note.frequency_hz, start);
      panner.pan.setValueAtTime(note.pan, start);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(note.gain, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      oscillator.connect(gain);
      const masterGain = masterGainRef.current;
      if (!masterGain) continue;
      gain.connect(panner);
      panner.connect(masterGain);
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
  }, [baseAudioCues, soundEnabled]);

  useEffect(
    () => () => {
      cancelAudioSchedule();
      stopVideoFrameSync(videoRef.current);
      void audioContextRef.current?.close();
    },
    [],
  );

  function focusWorkbench() {
    window.requestAnimationFrame(() => {
      workspaceRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  function selectEvent(event: CandidateEvent) {
    setSelectedRecoveryId(null);
    setSelectedEventId(event.event_id);
    setSelectedSegmentId(event.segment_id);
    setShowAllSegments(false);
    setAnalysisVisible(true);
    setReplayEnd(null);
    audioScopeRef.current = { kind: "segment", segmentId: event.segment_id };
    setAnnouncement(
      `Selected ${humanizeIdentifier(event.event_kind)} proposal for ${event.segment_id} at ${formatTime(event.start_s)}.`,
    );
    const video = videoRef.current;
    if (video) {
      cancelAudioSchedule();
      resetSuppressedCues();
      video.pause();
      const segment = bundle?.segments.find(
        (candidate) => candidate.segment_id === event.segment_id,
      );
      const anchor =
        bundle && segment
          ? eventAnchorTime(event, segment, bundle.clip.processed_fps)
          : event.start_s;
      video.currentTime = anchor;
      setCurrentTime(video.currentTime);
    }
    focusWorkbench();
  }

  function selectSegment(segmentId: string) {
    if (!bundle) return;
    const segment = bundle.segments.find(
      (candidate) => candidate.segment_id === segmentId,
    );
    if (!segment) return;
    setSelectedRecoveryId(null);
    const firstEvent = bundle.events
      .filter((event) => event.segment_id === segmentId)
      .sort((left, right) => left.start_s - right.start_s)[0];
    setSelectedSegmentId(segmentId);
    setShowAllSegments(false);
    setSelectedEventId(firstEvent?.event_id ?? null);
    setAnalysisVisible(true);
    setReplayEnd(null);
    audioScopeRef.current = { kind: "segment", segmentId };
    setAnnouncement(`Following ${segmentId}.`);
    const video = videoRef.current;
    if (video) {
      cancelAudioSchedule();
      resetSuppressedCues();
      video.pause();
      video.currentTime = Math.max(
        0,
        firstEvent
          ? eventAnchorTime(firstEvent, segment, bundle.clip.processed_fps)
          : segment.first_frame / bundle.clip.processed_fps,
      );
      setCurrentTime(video.currentTime);
    }
  }

  function selectRecoveryCandidate(candidate: RecoveryCandidate) {
    setSelectedRecoveryId(candidate.candidate_id);
    setSelectedEventId(null);
    setShowAllSegments(false);
    setAnalysisVisible(true);
    setReplayEnd(null);
    audioScopeRef.current = { kind: "silent" };
    setAnnouncement(`Selected recovery track ${candidate.candidate_id}.`);
    const video = videoRef.current;
    if (video) {
      cancelAudioSchedule();
      resetSuppressedCues();
      video.pause();
      video.currentTime = recovery
        ? geometryAnchorTime(
            candidate.geometry,
            recovery.processed_fps,
            candidate.start_s,
          )
        : candidate.start_s;
      setCurrentTime(video.currentTime);
    }
    if (recoveryMenuRef.current) recoveryMenuRef.current.open = false;
    focusWorkbench();
  }

  function replaySelectedEvent() {
    if (!selectedEvent || !selectedSegment || !bundle) return;
    const video = videoRef.current;
    if (!video) return;
    const anchor = eventAnchorTime(
      selectedEvent,
      selectedSegment,
      bundle.clip.processed_fps,
    );
    const start = Math.max(0, anchor - 2);
    const end = Math.min(bundle.clip.processed_duration_s, anchor + 2);
    audioScopeRef.current = { kind: "event", eventId: selectedEvent.event_id };
    cancelAudioSchedule();
    resetSuppressedCues();
    video.currentTime = start;
    setCurrentTime(start);
    setReplayEnd(end);
    void video.play().catch(() => setReplayEnd(null));
  }

  function replaySelectedRecovery() {
    if (!selectedRecovery || !bundle) return;
    const video = videoRef.current;
    if (!video) return;
    const start = Math.max(0, selectedRecovery.start_s - 1);
    const end = Math.min(bundle.clip.processed_duration_s, selectedRecovery.end_s + 1);
    audioScopeRef.current = { kind: "silent" };
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
      audioScopeRef.current = selectedRecovery
        ? { kind: "silent" }
        : selectedSegmentId
          ? { kind: "segment", segmentId: selectedSegmentId }
          : { kind: "all" };
    }
  }

  function decideSelectedEvent(
    decision: "accepted" | "rejected" | "uncertain",
  ) {
    if (!selectedEvent) return;
    dispatchReview({
      type: "decide_event",
      event_id: selectedEvent.event_id,
      decision,
      reviewer: "local_reviewer",
      reviewed_at: new Date().toISOString(),
    });
    setAnnouncement(
      `${humanizeIdentifier(selectedEvent.event_kind)} proposal ${decision}.`,
    );
  }

  function decideBulkEvents(
    decision: "accepted" | "rejected" | "uncertain",
  ) {
    if (selectedEventIds.size === 0) return;
    dispatchReview({
      type: "decide_events",
      event_ids: [...selectedEventIds],
      decision,
      reviewer: "local_reviewer",
      reviewed_at: new Date().toISOString(),
    });
    setAnnouncement(
      `${selectedEventIds.size} selected event${selectedEventIds.size === 1 ? "" : "s"} marked ${decision}.`,
    );
  }

  function applyBulkLabel() {
    if (!bundle || selectedEventIds.size === 0) return;
    const normalized = bulkLabel.trim().slice(0, 120);
    if (!normalized) return;
    const segmentIds = new Set(
      bundle.events
        .filter((event) => selectedEventIds.has(event.event_id))
        .map((event) => event.segment_id),
    );
    dispatchReview({
      type: "review_labels",
      segment_ids: [...segmentIds],
      value: normalized,
      reviewer: "local_reviewer",
      reviewed_at: new Date().toISOString(),
      correction_note: "Applied to selected event segments during local review.",
    });
    setAnnouncement(
      `${humanizeIdentifier(normalized)} applied to ${segmentIds.size} selected segment${segmentIds.size === 1 ? "" : "s"}.`,
    );
  }

  function toggleEventSelection(eventId: string, selected: boolean) {
    setSelectedEventIds((current) => {
      const next = new Set(current);
      if (selected) next.add(eventId);
      else next.delete(eventId);
      return next;
    });
  }

  function decideSelectedRecovery(
    decision: "accepted" | "rejected" | "uncertain",
  ) {
    if (!selectedRecovery) return;
    dispatchRecoveryReview({
      type: "decide",
      candidate_id: selectedRecovery.candidate_id,
      decision,
    });
    setAnnouncement(`Recovery track ${decision}.`);
  }

  function navigateRecovery(direction: -1 | 1) {
    if (!recovery || recovery.candidates.length === 0) return;
    const currentIndex = recovery.candidates.findIndex(
      (candidate) => candidate.candidate_id === selectedRecoveryId,
    );
    const nextIndex = Math.min(
      recovery.candidates.length - 1,
      Math.max(0, currentIndex + direction),
    );
    selectRecoveryCandidate(recovery.candidates[nextIndex]);
  }

  function decideRecoveryLabel(decision: "accepted" | "corrected" | "uncertain") {
    if (!selectedRecovery || !selectedRecoveryProposal) return;
    dispatchRecoveryReview({
      type: "decide_label",
      candidate_id: selectedRecovery.candidate_id,
      decision,
      value: decision === "accepted"
        ? selectedRecoveryProposal.label_id
        : decision === "corrected" ? recoveryDraftLabel : null,
    });
    setAnnouncement(`Recovery label ${decision}.`);
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
    setAnnouncement(`Label saved as ${humanizeIdentifier(normalized)}.`);
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
    setExportedReviewState(activeReviewState);
    setAnnouncement("CSV downloaded. Current event and label changes are exported.");
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function downloadRecoveryCsv() {
    if (!recovery) return;
    const blob = new Blob([buildRecoveryCsv(recovery, activeRecoveryReviewState)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${recovery.clip_id}-wildscore-recovery.csv`;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function resetReviews() {
    if (!bundle) return;
    dispatchReview({ type: "reset", bundle });
    setAnnouncement("Event and label reviews restored to the saved analysis.");
  }

  function resetRecoveryReviews() {
    if (!recovery) return;
    dispatchRecoveryReview({ type: "reset", bundle: recovery });
    setAnnouncement("Recovery reviews restored to the saved analysis.");
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
      if (key === "j") {
        if (selectedRecovery) navigateRecovery(1);
        else navigateEvent(1);
      } else if (key === "k") {
        if (selectedRecovery) navigateRecovery(-1);
        else navigateEvent(-1);
      } else if (event.shiftKey && key === "a" && selectedEventIds.size > 0) {
        decideBulkEvents("accepted");
      } else if (key === "a") {
        if (selectedRecovery) decideSelectedRecovery("accepted");
        else decideSelectedEvent("accepted");
      } else if (key === "r") {
        if (selectedRecovery) decideSelectedRecovery("rejected");
        else decideSelectedEvent("rejected");
      } else if (key === "u") {
        if (selectedRecovery) decideSelectedRecovery("uncertain");
        else decideSelectedEvent("uncertain");
      }
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
  const evidence = buildDevelopmentEvidenceSummary(
    readyBundle,
    loadState.recovery,
  );
  const runDetail = [
    evidence.models.map(humanizeIdentifier).join(" + "),
    evidence.samFramesProcessed === null
      ? null
      : `${evidence.samFramesProcessed} frames`,
    evidence.samRuntimeMs === null
      ? null
      : `${(evidence.samRuntimeMs / 1000).toFixed(1)} s`,
  ].filter((value): value is string => Boolean(value));

  const timelinePanel = (
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
          const isActive = segment.segment_id === selectedSegmentId;
          const isDimmed = !showAllSegments && Boolean(selectedSegmentId) && !isActive;
          return (
            <div
              className={`timeline-row ${isActive ? "is-active" : ""} ${
                isDimmed ? "is-dimmed" : ""
              }`}
              key={segment.segment_id}
            >
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
                    } ${event.event_id === selectedEventId ? "is-selected" : ""}`}
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
        Rows are observed segments, not persistent animal identities. Focused review dims
        other tracks without removing them; View all restores full contrast.
      </p>
    </section>
  );

  const recoveryAuditMenu = (
    <details className="recovery-menu" ref={recoveryMenuRef}>
      <summary>
        <span>
          <strong>Targeted recovery audit</strong>
          <small>Review supplemental SAM tracks</small>
        </span>
        <span className="handwritten">
          {reviewedRecoveryCount(activeRecoveryReviewState)}/
          {loadState.recovery.candidates.length}
        </span>
      </summary>
      <div className="recovery-menu-panel">
        <p>
          These prompt-specific tracks remain separate from the saved event log.
          Keeping one records useful evidence; it does not merge animal identities.
        </p>
        <div className="recovery-grid">
          {loadState.recovery.candidates.map((candidate) => {
            const decision =
              activeRecoveryReviewState.decisions[candidate.candidate_id];
            return (
              <button
                className={`recovery-card ${decision} ${
                  candidate.candidate_id === selectedRecoveryId
                    ? "is-selected"
                    : ""
                }`}
                key={candidate.candidate_id}
                type="button"
                aria-pressed={candidate.candidate_id === selectedRecoveryId}
                onClick={() => selectRecoveryCandidate(candidate)}
              >
                <span>{humanizeIdentifier(candidate.suggested_label)}</span>
                <strong>{candidate.candidate_id}</strong>
                <small>
                  {formatTime(candidate.start_s)}–{formatTime(candidate.end_s)} · {decision}
                </small>
              </button>
            );
          })}
        </div>
        <div className="recovery-menu-actions">
          <button type="button" onClick={resetRecoveryReviews}>
            Reset reviews
          </button>
          <button type="button" onClick={downloadRecoveryCsv}>
            Download recovery CSV
          </button>
        </div>
      </div>
    </details>
  );

  return (
    <>
      <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      <section
        className="workspace"
        aria-labelledby="workspace-heading"
        ref={workspaceRef}
      >
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
                  startVideoFrameSync(event.currentTarget);
                }}
                onPause={(event) => {
                  cancelAudioSchedule();
                  stopVideoFrameSync(event.currentTarget);
                  setCurrentTime(event.currentTarget.currentTime);
                }}
                onSeeking={(event) => {
                  cancelAudioSchedule();
                  stopVideoFrameSync(event.currentTarget);
                }}
                onSeeked={(event) => {
                  setCurrentTime(event.currentTarget.currentTime);
                  resetSuppressedCues();
                  if (!event.currentTarget.paused) {
                    startAudioSchedule(event.currentTarget);
                    startVideoFrameSync(event.currentTarget);
                  }
                }}
                onWaiting={(event) => {
                  cancelAudioSchedule();
                  stopVideoFrameSync(event.currentTarget);
                }}
                onPlaying={(event) => {
                  startAudioSchedule(event.currentTarget);
                  startVideoFrameSync(event.currentTarget);
                }}
                onRateChange={(event) => {
                  cancelAudioSchedule();
                  if (!event.currentTarget.paused) {
                    startAudioSchedule(event.currentTarget);
                  }
                }}
                onTimeUpdate={(event) => handleTimeUpdate(event.currentTarget)}
                onEnded={() => {
                  cancelAudioSchedule();
                  stopVideoFrameSync(videoRef.current);
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
                  const label = selectedRecovery
                    ? {
                        label: `${selectedRecovery.suggested_label} candidate`,
                        source: "model" as const,
                      }
                    : currentReviewedLabel(
                        readyBundle,
                        activeReviewState,
                        geometry.segment_id,
                      );
                  const width = geometry.box.right - geometry.box.left;
                  const height = geometry.box.bottom - geometry.box.top;
                  return (
                    <g
                      className={
                        geometry.segment_id ===
                        (selectedRecovery?.candidate_id ?? selectedSegmentId)
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
                    ? selectedRecovery
                      ? `following ${selectedRecovery.candidate_id}`
                      : showAllSegments
                      ? `${visibleGeometry.length} visible · ${selectedSegmentId} selected`
                      : `following ${selectedSegmentId}`
                    : selectedRecovery
                      ? "candidate not visible at this frame"
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
                value={
                  selectedRecovery
                    ? "__recovery__"
                    : showAllSegments
                      ? "__all__"
                      : selectedSegmentId ?? ""
                }
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  if (value === "__all__") {
                    setSelectedRecoveryId(null);
                    setShowAllSegments(true);
                    setAnalysisVisible(true);
                    audioScopeRef.current = { kind: "all" };
                  } else if (value !== "__recovery__") {
                    selectSegment(value);
                  }
                }}
              >
                {selectedRecovery && (
                  <option value="__recovery__">
                    Recovery candidate · {selectedRecovery.candidate_id}
                  </option>
                )}
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
                  : selectedRecovery
                    ? "Only this unmerged recovery candidate is shown."
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
                  <span>Sound volume {Math.round(scoreVolume * 100)}%</span>
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
                <fieldset className="cue-filters">
                  <legend>Audible events</legend>
                  <label>
                    <input
                      type="checkbox"
                      checked={appearanceSoundEnabled}
                      onChange={(event) =>
                        setAppearanceSoundEnabled(event.currentTarget.checked)
                      }
                    />
                    Appearance
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={disappearanceSoundEnabled}
                      onChange={(event) =>
                        setDisappearanceSoundEnabled(event.currentTarget.checked)
                      }
                    />
                    Disappearance
                  </label>
                </fieldset>
              </div>
              <details className="help-disclosure">
                <summary title="Audio cue guide">
                  <span aria-hidden="true">i</span>
                  Audio cue guide
                </summary>
                <p>
                  Bright rising notes mark appearances; lower fading notes mark
                  disappearances. Stereo position follows the saved box location.
                  Accepted events sound stronger; rejected and can’t-tell events are
                  silent.
                </p>
              </details>
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

        <div className="workbench-side">
        <aside className="review-sheet" aria-labelledby="review-heading">
          {recoveryAuditMenu}
          <p className="eyebrow">
            {selectedRecovery ? "Recovery candidate" : "Evidence selected"}
          </p>
          <h2 id="review-heading">
            {selectedRecovery
              ? humanizeIdentifier(selectedRecovery.suggested_label)
              : selectedEvent
                ? eventTitle(selectedEvent)
                : "No event selected"}
          </h2>
          {selectedRecovery ? (
            <>
              <p className="event-time">
                {formatTime(selectedRecovery.start_s)}–{formatTime(selectedRecovery.end_s)} · {selectedRecovery.candidate_id}
              </p>
              <p className={`review-status ${activeRecoveryReviewState.decisions[selectedRecovery.candidate_id]}`}>
                Candidate {activeRecoveryReviewState.decisions[selectedRecovery.candidate_id]}
              </p>
              <details className="help-disclosure review-help">
                <summary title="Recovery review guidance">
                  <span aria-hidden="true">i</span>
                  Review guidance
                </summary>
                <div>
                  <p className="review-copy">
                    A targeted Meta SAM pass recovered this track after the generic
                    pass missed it. It has not been merged into the saved analysis.
                  </p>
                  <p className="review-instruction">
                    Keep it only if the box follows one visible animal. This decision
                    does not confirm an entry, exit, individual identity, or species
                    label.
                  </p>
                </div>
              </details>
              <dl className="event-facts">
                <div>
                  <dt>Prompt</dt>
                  <dd>{humanizeIdentifier(selectedRecovery.source_prompt)}</dd>
                </div>
                <div>
                  <dt>Audit</dt>
                  <dd>Additive candidate</dd>
                </div>
                <div>
                  <dt>Timebase</dt>
                  <dd>{loadState.recovery.processed_fps} fps</dd>
                </div>
              </dl>
              <p className="uncertainty-note">
                Check carefully: {selectedRecovery.uncertainty_flags
                  .map(humanizeIdentifier)
                  .join(", ")}.
              </p>
              {selectedRecoveryProposal && (
                <div className="label-editor">
                  <p className="eyebrow">Separate label review</p>
                  <p className={`review-status ${activeRecoveryReviewState.label_decisions[selectedRecovery.candidate_id]?.decision ?? "pending"}`}>
                    Label {activeRecoveryReviewState.label_decisions[selectedRecovery.candidate_id]?.decision ?? "pending"}
                  </p>
                  <p>
                    <strong>Muse Spark proposal:</strong>{" "}
                    {humanizeIdentifier(selectedRecoveryProposal.label_id)}
                  </p>
                  <p className="small-note">{selectedRecoveryProposal.visible_evidence}</p>
                  <label>
                    Correct broad label
                    <select
                      value={recoveryDraftLabel}
                      onChange={(event) => setRecoveryDraftLabel(event.currentTarget.value)}
                    >
                      {["baboon", "warthog", "hippopotamus", "antelope", "unknown"].map((label) => (
                        <option value={label} key={label}>{humanizeIdentifier(label)}</option>
                      ))}
                    </select>
                  </label>
                  <div className="decision-row">
                    <button type="button" onClick={() => decideRecoveryLabel("accepted")}>Accept proposal</button>
                    <button type="button" onClick={() => decideRecoveryLabel("corrected")}>Save correction</button>
                    <button type="button" onClick={() => decideRecoveryLabel("uncertain")}>Can’t tell</button>
                  </div>
                  <p className="small-note">
                    Accepting this label does not confirm an individual identity or an entry/exit event.
                  </p>
                </div>
              )}
              <button className="wide-button" type="button" onClick={replaySelectedRecovery}>
                Replay candidate with 1-second context
              </button>
              <div className="decision-row">
                <button
                  className={
                    activeRecoveryReviewState.decisions[selectedRecovery.candidate_id] === "accepted"
                      ? "decision-active"
                      : undefined
                  }
                  type="button"
                  onClick={() => decideSelectedRecovery("accepted")}
                >
                  Keep candidate <span aria-hidden="true">(A)</span>
                </button>
                <button
                  className={
                    activeRecoveryReviewState.decisions[selectedRecovery.candidate_id] === "rejected"
                      ? "decision-active"
                      : undefined
                  }
                  type="button"
                  onClick={() => decideSelectedRecovery("rejected")}
                >
                  Dismiss <span aria-hidden="true">(R)</span>
                </button>
                <button
                  className={
                    activeRecoveryReviewState.decisions[selectedRecovery.candidate_id] === "uncertain"
                      ? "decision-active uncertain"
                      : undefined
                  }
                  type="button"
                  onClick={() => decideSelectedRecovery("uncertain")}
                >
                  Can’t tell <span aria-hidden="true">(U)</span>
                </button>
              </div>
              <div className="review-navigation">
                <button type="button" onClick={() => navigateRecovery(-1)}>
                  Previous <span aria-hidden="true">(K)</span>
                </button>
                <button type="button" onClick={() => navigateRecovery(1)}>
                  Next <span aria-hidden="true">(J)</span>
                </button>
              </div>
              <p className="small-note">
                Recovery decisions are isolated from the completed event review and
                stored in this reviewed demo; new changes also stay in this browser.
              </p>
            </>
          ) : selectedEvent && selectedSegment && selectedLabel ? (
            <>
              <p className="event-time">
                {formatTime(selectedEvent.start_s)} · {selectedSegment.segment_id}
              </p>
              <p className={`review-status ${selectedEventReview?.decision ?? "proposed"}`}>
                Event {selectedEventReview?.decision ?? "proposed"}
              </p>
              <details className="help-disclosure review-help">
                <summary title="Event review guidance">
                  <span aria-hidden="true">i</span>
                  Review guidance
                </summary>
                <div>
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
                </div>
              </details>
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
                <button
                  className={
                    selectedEventReview?.decision === "uncertain"
                      ? "decision-active uncertain"
                      : undefined
                  }
                  type="button"
                  onClick={() => decideSelectedEvent("uncertain")}
                >
                  Can’t tell <span aria-hidden="true">(U)</span>
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
                Event and label reviews are separate. Refresh restores the saved
                51-event review and discards only unsaved event changes.
              </p>
            </>
          ) : (
            <p className="review-copy">Choose an event marker from the log below.</p>
          )}
        </aside>
        {timelinePanel}
        </div>
      </section>

      <section className="event-table-section" aria-labelledby="event-table-heading">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Auditable export</p>
            <h2 id="event-table-heading">Event table</h2>
          </div>
          <div className="table-actions">
            <button type="button" onClick={resetReviews}>Reset reviews</button>
            <div className="export-status">
              <span className={unexportedChangeCount > 0 ? "has-changes" : "is-current"}>
                {unexportedChangeCount > 0
                  ? `${unexportedChangeCount} change${unexportedChangeCount === 1 ? "" : "s"} not exported`
                  : "CSV up to date"}
              </span>
              <button className="primary-action" type="button" onClick={downloadCsv}>
                Download CSV
              </button>
            </div>
          </div>
        </div>
        <div className="bulk-review-bar" aria-label="Bulk event review">
          <span>
            {selectedEventIds.size} event{selectedEventIds.size === 1 ? "" : "s"} selected
          </span>
          <button
            type="button"
            disabled={selectedEventIds.size === 0}
            onClick={() => decideBulkEvents("accepted")}
          >
            Accept selected <span aria-hidden="true">(Shift+A)</span>
          </button>
          <button
            type="button"
            disabled={selectedEventIds.size === 0}
            onClick={() => decideBulkEvents("rejected")}
          >
            Reject selected
          </button>
          <button
            type="button"
            disabled={selectedEventIds.size === 0}
            onClick={() => decideBulkEvents("uncertain")}
          >
            Can’t tell selected
          </button>
          <label>
            Apply broad label
            <input
              value={bulkLabel}
              maxLength={120}
              onChange={(event) => setBulkLabel(event.currentTarget.value)}
            />
          </label>
          <button
            type="button"
            disabled={selectedEventIds.size === 0 || bulkLabel.trim().length === 0}
            onClick={applyBulkLabel}
          >
            Apply to selected segments
          </button>
        </div>
        <div className="event-table-scroll">
          <table>
            <thead>
              <tr>
                <th className="selection-cell">
                  <input
                    type="checkbox"
                    aria-label="Select all events"
                    checked={
                      readyBundle.events.length > 0 &&
                      selectedEventIds.size === readyBundle.events.length
                    }
                    onChange={(event) =>
                      setSelectedEventIds(
                        event.currentTarget.checked
                          ? new Set(readyBundle.events.map((item) => item.event_id))
                          : new Set(),
                      )
                    }
                  />
                </th>
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
                const eventStatus =
                  activeReviewState.event_reviews[event.event_id]?.decision ??
                  event.decision;
                return (
                  <tr
                    className={`status-${eventStatus} ${
                      event.event_id === selectedEventId ? "is-active" : ""
                    }`}
                    key={event.event_id}
                    tabIndex={0}
                    aria-label={`Open ${eventTitle(event)} for ${event.segment_id} at ${formatTime(event.start_s)}`}
                    onClick={() => selectEvent(event)}
                    onKeyDown={(keyEvent) => {
                      if (keyEvent.key !== "Enter" && keyEvent.key !== " ") return;
                      keyEvent.preventDefault();
                      selectEvent(event);
                    }}
                  >
                    <td className="selection-cell">
                      <input
                        type="checkbox"
                        aria-label={`Select ${eventTitle(event)} for ${event.segment_id}`}
                        checked={selectedEventIds.has(event.event_id)}
                        onClick={(clickEvent) => clickEvent.stopPropagation()}
                        onChange={(inputEvent) =>
                          toggleEventSelection(
                            event.event_id,
                            inputEvent.currentTarget.checked,
                          )
                        }
                      />
                    </td>
                    <td>{formatTime(event.start_s)}</td>
                    <td>
                      <button
                        className="table-event-button"
                        type="button"
                        onClick={(clickEvent) => {
                          clickEvent.stopPropagation();
                          selectEvent(event);
                        }}
                      >
                        {humanizeIdentifier(event.event_kind)}
                      </button>
                    </td>
                    <td>{event.segment_id}</td>
                    <td>{humanizeIdentifier(label.label)}</td>
                    <td>
                      {eventStatus}
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

      <section className="evidence-strip evidence-panel" aria-labelledby="evidence-heading">
        <div>
          <p className="eyebrow">Evidence boundary</p>
          <h2 id="evidence-heading">Single-clip development review</h2>
          <p className="evidence-provenance">
            {evidence.provider ?? "Saved model run"}
            {runDetail.length > 0 ? ` · ${runDetail.join(" · ")}` : ""}
          </p>
        </div>
        <div className="evidence-results">
          <dl>
            <div>
              <dt>Event proposals</dt>
              <dd>{evidence.eventProposalCount}</dd>
            </div>
            <div>
              <dt>Stored decisions</dt>
              <dd>
                {evidence.acceptedEventCount} accepted · {evidence.rejectedEventCount} rejected · {evidence.uncertainEventCount} can’t tell
              </dd>
            </div>
            <div>
              <dt>Recovery review</dt>
              <dd>
                {evidence.reviewedRecoveryTrackCount} tracks · {evidence.reviewedRecoveryLabelCount} labels
              </dd>
            </div>
            <div>
              <dt>Held-out clips</dt>
              <dd>{evidence.heldOutClipCount}</dd>
            </div>
          </dl>
          <p className="evidence-caveat">
            These are human decisions on this development clip’s proposals—not precision,
            recall or an accuracy score. Proposal review cannot count animals the model
            never proposed.
          </p>
        </div>
      </section>
    </>
  );
}
