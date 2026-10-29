"use client";

import { useEffect, useRef, useState } from "react";

type LocalClip = {
  id: string;
  label: string;
  environment: string;
  source: string;
  summary: string;
  limitation: string;
  media_url: string;
};

function isLocalClip(value: unknown): value is LocalClip {
  if (!value || typeof value !== "object") return false;
  const clip = value as Record<string, unknown>;
  return ["id", "label", "environment", "source", "summary", "limitation", "media_url"]
    .every((key) => typeof clip[key] === "string");
}

export default function LocalEvaluationClips() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [clips, setClips] = useState<LocalClip[]>([]);
  const [selectedId, setSelectedId] = useState("");

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

  if (process.env.NODE_ENV !== "development" || clips.length === 0) return null;
  const selected = clips.find((clip) => clip.id === selectedId) ?? clips[0];

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

        <video key={selected.id} className="local-evaluation-video" controls preload="metadata">
          <source src={selected.media_url} type="video/mp4" />
        </video>

        <dl className="local-evaluation-result">
          <div>
            <dt>Saved result</dt>
            <dd>{selected.summary}</dd>
          </div>
          <div>
            <dt>Boundary</dt>
            <dd>{selected.limitation}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{selected.source}</dd>
          </div>
        </dl>
        <p className="local-evaluation-notice">
          This loopback viewer is available only on this computer. It performs no model calls.
        </p>
      </dialog>
    </div>
  );
}
