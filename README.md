# WildScore

WildScore is an evidence-linked review notebook for short wildlife videos. Its
local pipeline uses Meta models to propose animal segments and reviewable labels.
The planned public viewer will replay deliberately prepared saved results without
API access.

The project is currently at the verified footage-feasibility checkpoint. A real
private clip has completed the SAM and Spark pipeline, parser validation and
deterministic presence/event bundle generation. Private media, raw model output
and generated bundles are not included in this repository. The review interface
is not built yet.

## Security boundary

- Every model called by the WildScore processing pipeline, including offline or
  cached-result generation, must be a Meta model.
- `MODEL_API_KEY` is local-process-only. It must never be prefixed with `NEXT_PUBLIC_`, embedded in browser code, committed, logged, or copied into public assets.
- Put private source media, raw model responses, and caches under the ignored `private/` directory.
- The public viewer will be a static export. It will not contain an upload endpoint, inference proxy, API route, or model credential.
- Do not place source footage in a public asset directory. A sanitised display
  copy still requires a separate rights and privacy decision before publication.

## Current prerequisites

- Node.js 24.22.1 and npm 11.19.1 (pinned in `.node-version` and `package.json`)
- ffmpeg and ffprobe 8.0.3 or a later reviewed patched release (9.0.2 is the current stable release as of 26 October 2026)

Project dependencies are exact-versioned in `package.json` and
`package-lock.json`. `@meta-sam/parser` is the official zero-runtime-dependency
parser used for SAM output.

## Local feasibility commands

Install exactly what is locked, without running dependency lifecycle scripts:

```bash
npm ci --ignore-scripts
```

Create a private `.env.local` containing `MODEL_API_KEY`, then place a reviewed,
sanitised analysis derivative at the private path expected by the scripts. Never
commit either file.

```bash
npm run check:model-key
npm run test:sam-parser
npm run test:events
npm run feasibility:meta
npm run prepare:spark-evidence
npm run feasibility:spark
npm run build:bundle
```

The scripts use `sam-3.1` for segmentation and `muse-spark-1.3` standard mode
for bounded label evidence. They preserve immutable machine proposals separately
from human review corrections. Inference outputs remain private until a specific
bundle is reviewed for publication.

## Current limitations

- One development clip has been tested; there is no held-out accuracy estimate.
- Camera movement, occlusion, crowding and the model's tracking limit can produce
  fragmented or missed segments.
- Appearance and disappearance events are review proposals, not assertions of
  biological entry, exit, visit count or individual identity.
- Provider-reported usage can support cost estimates but is not a billing-ledger
  confirmation.
