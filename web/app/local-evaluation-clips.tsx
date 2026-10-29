"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  type LocalEvaluationOverlay,
  validateLocalEvaluationOverlay,
} from "../../src/evaluation/local-overlay";

type LocalClip = {
  id: string;
  label: string;
  environment: string;
  source: string;
  summary: string;
  limitation: string;
  detected: string;
  missed: string;
  label_review: string;
  analysis_fps: number;
  media_url: string;
  overlay_url: string;
};

function isLocalClip(value: unknown): value is LocalClip {
  if (!value || typeof value !== "object") return false;
  const clip = value as Record<string, unknown>;
  return [
    "id", "label", "environment", "source", "summary", "limitation",
    "detected", "missed", "label_review", "media_url", "overlay_url",
  ].every((key) => typeof clip[key] === "string") &&
    typeof clip.analysis_fps === "number" && Number.isFinite(clip.analysis_fps);
}

export default function LocalEvaluationClips() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [clips, setClips] = useState<LocalClip[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [overlay, setOverlay] = useState<LocalEvaluationOverlay | null>(null);
  const [overlayStatus, setOverlayStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const controller = new AbortController();
    fetch("http://127.0.0.1:3001/manifest.json", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("Local evaluation media is unavailable.");
        return response.json() as Promise<{ clips?: unknown }>;
      })
      .then((manifest) => {
        const safeClips = Array.isArray(manifest.clips)
          ? manifest.clips.filter(isLocalClip)
          : [];
        setClips(safeClips);
        setSelectedId(safeClips[0]?.id ?? "");
      })
      .catch(() => {
        setClips([]);
      });
    return () => controller.abort();
  }, []);

  const selected = clips.find((clip) => clip.id === selectedId) ?? clips[0];
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setOverlay(null);
    setOverlayStatus("loading");
    fetch(selected.overlay_url, { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Saved overlay unavailable.");
        return response.json();
      })
      .then((value) => {
        setOverlay(validateLocalEvaluationOverlay(value));
        setOverlayStatus("ready");
      })
      .catch((error) => {
        if (error?.name !== "AbortError") setOverlayStatus("error");
      });
    return () => controller.abort();
  }, [selected]);

  const frameMap = useMemo(
    () => new Map(overlay?.frames.map((frame) => [frame.frame_index, frame.objects]) ?? []),
    [overlay],
  );

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !overlay) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const activeVideo = video;
    const activeOverlay = overlay;
    const activeContext = context;
    canvas.width = activeOverlay.width;
    canvas.height = activeOverlay.height;
    let animationFrame = 0;

    function draw() {
      activeContext.clearRect(0, 0, activeOverlay.width, activeOverlay.height);
      const frameIndex = Math.round(activeVideo.currentTime * activeOverlay.fps);
      const objects = frameMap.get(frameIndex) ?? [];
      for (const object of objects) {
        const numericId = Number.parseInt(object.object_id, 10);
        const hue = Number.isFinite(numericId) ? (numericId * 47 + 44) % 360 : 44;
        const colour = `hsl(${hue} 88% 58%)`;
        const { left, top, right, bottom } = object.box;
        activeContext.strokeStyle = colour;
        activeContext.lineWidth = 2;
        activeContext.setLineDash([7, 5]);
        activeContext.strokeRect(left, top, right - left, bottom - top);
        activeContext.setLineDash([]);
        activeContext.font = "600 16px ui-sans-serif, system-ui, sans-serif";
        const label = `SAM ${object.object_id}`;
        const labelWidth = activeContext.measureText(label).width + 12;
        activeContext.fillStyle = "rgba(12, 18, 20, 0.78)";
        activeContext.fillRect(left, Math.max(0, top - 23), labelWidth, 23);
        activeContext.fillStyle = colour;
        activeContext.fillText(label, left + 6, Math.max(17, top - 6));
      }
    }

    function loop() {
      draw();
      if (!activeVideo.paused && !activeVideo.ended) animationFrame = requestAnimationFrame(loop);
    }
    function start() {
      cancelAnimationFrame(animationFrame);
      loop();
    }
    activeVideo.addEventListener("play", start);
    activeVideo.addEventListener("loadeddata", draw);
    activeVideo.addEventListener("seeked", draw);
    activeVideo.addEventListener("timeupdate", draw);
    draw();
    return () => {
      cancelAnimationFrame(animationFrame);
      activeVideo.removeEventListener("play", start);
      activeVideo.removeEventListener("loadeddata", draw);
      activeVideo.removeEventListener("seeked", draw);
      activeVideo.removeEventListener("timeupdate", draw);
    };
  }, [frameMap, overlay]);

  if (process.env.NODE_ENV !== "development" || clips.length === 0) return null;

  return (
    <div className="local-evaluation-launcher">
      <button type="button" onClick={() => dialogRef.current?.showModal()}>
        Evaluation clips
      </button>
      <dialog ref={dialogRef} className="local-evaluation-dialog">
        <div className="local-evaluation-heading">
          <div>
            <p className="eyebrow">Local-only evaluation</p>
            <h2>Broader environments</h2>
          </div>
          <button type="button" onClick={() => dialogRef.current?.close()}>
            Close
          </button>
        </div>

        <label className="local-clip-picker">
          <span>Clip</span>
          <select value={selected.id} onChange={(event) => setSelectedId(event.target.value)}>
            {clips.map((clip) => (
              <option key={clip.id} value={clip.id}>
                {clip.label} · {clip.environment}
              </option>
            ))}
          </select>
        </label>

        <div className="local-evaluation-stage">
          <video
            ref={videoRef}
            key={selected.id}
            className="local-evaluation-video"
            controls
            preload="metadata"
          >
            <source src={selected.media_url} type="video/mp4" />
          </video>
          <canvas ref={canvasRef} className="local-evaluation-overlay" aria-hidden="true" />
          <span className={`local-overlay-status ${overlayStatus}`}>
            {overlayStatus === "ready"
              ? `Saved SAM boxes · ${selected.analysis_fps} fps`
              : overlayStatus === "loading" ? "Loading saved SAM boxes" : "Saved boxes unavailable"}
          </span>
        </div>

        <dl className="local-evaluation-result">
          <div>
            <dt>Saved result</dt>
            <dd>{selected.summary}</dd>
          </div>
          <div>
            <dt>Detected evidence</dt>
            <dd>{selected.detected}</dd>
          </div>
          <div>
            <dt>Missed or uncertain</dt>
            <dd>{selected.missed}</dd>
          </div>
          <div>
            <dt>Blind label check</dt>
            <dd>{selected.label_review}</dd>
          </div>
        </dl>
        <p className="local-evaluation-notice">
          {selected.limitation} Source: {selected.source}. This loopback viewer replays cached
          results only; it performs no model calls and makes no general accuracy claim.
        </p>
      </dialog>
    </div>
  );
}
