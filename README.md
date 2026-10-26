# WildScore

**Turn short wildlife clips into an evidence-linked event timeline you can see, hear, review, and export.**

WildScore is an early-stage wildlife-video review tool being developed for the Meta Global AI Developer Hackathon. The planned workflow uses Meta models to propose temporal animal tracks and broad labels, then keeps a person in control of reviewing evidence and correcting proposals.

The public demo will replay saved analysis rather than upload footage or run inference in the browser.

## Planned core experience

- Review a short wildlife clip alongside proposed animal tracks.
- Inspect conservative candidate appearance and disappearance events.
- Accept or reject events independently from confirming or correcting labels.
- Replay the evidence associated with an event.
- Hear an optional, deterministic audible event log synchronized to the video.
- Export review decisions as an auditable CSV.

## Current status

Project setup is in progress. No model results, evaluation results, or live demo are published yet.

## Technology

- TypeScript
- Next.js and React
- Meta SAM and Muse Spark for the planned analysis pipeline
- ffmpeg/ffprobe for local media preparation

All public results will be based on genuine recorded model runs and will identify limitations explicitly.
