# WildScore

WildScore is an evidence-linked review notebook for short wildlife videos. Its
local pipeline uses Meta models to propose animal segments and reviewable labels.
The static viewer replays deliberately prepared saved results without API access.

The project has a verified single-clip feasibility run and a working local
saved-result review loop. A real private clip completed the SAM and Spark
pipeline, parser validation and deterministic presence/event bundle generation.
The viewer synchronises saved geometry with video, keeps event and label reviews
independent, replays evidence and exports every proposal to CSV with its review
status. Source media and raw model output remain private. The repository includes
one approved, sanitised demo excerpt and a reviewed cached-result bundle so the
review workflow can run without a key or network model call.

## Security boundary

- Every model called by the WildScore processing pipeline, including offline or
  cached-result generation, must be a Meta model.
- `MODEL_API_KEY` is local-process-only. It must never be prefixed with `NEXT_PUBLIC_`, embedded in browser code, committed, logged, or copied into public assets.
- Put private source media, raw model responses, and caches under the ignored `private/` directory.
- The viewer is a static export. It contains no upload endpoint, inference proxy,
  API route or model credential.
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

## Keyless cached demo

After installing the locked dependencies, verify, build and serve the bundled
cached analysis on the loopback interface:

```bash
npm run demo -- --check
npm run demo
```

The demo command verifies SHA-256 hashes before building, never calls a model and
does not pass `MODEL_API_KEY` to the static build. The included field excerpt is
attributed to the WildScore project and licensed CC BY-NC 4.0; see the bundled
attribution file. For development work, use:

```bash
npm test
npm run typecheck
npm run build
npm run check:public
npm run dev
```

Validate one browser-exported missed-animal batch without loading an API key or
making a model call:

```bash
node bin/wildscore.mjs recover missing-animals.json --dry-run --max-calls 8
```

Live batch recovery is not enabled by this command yet; the preflight establishes
the bounded, label-free box-prompt contract that the local Meta SAM runner will use.

The viewer validates the saved bundle before use. Event, label and recovery
reviews use bundle-scoped browser-local storage and never leave the device.
Resetting reviews restores the immutable stored bundle. CSV export
retains proposed, accepted, rejected and `can't tell` events and neutralises
spreadsheet-formula prefixes in editable fields.

## Post-hackathon roadmap

- Consider SpeciesNet as an optional comparison or integration only after the
  Meta hackathon. It is deliberately excluded from the current pipeline because
  WildScore's hackathon build calls Meta models exclusively. Any later addition
  must preserve local-first privacy, provenance and human review boundaries.

## Current limitations

- One development clip has been tested; there is no held-out accuracy estimate.
- Camera movement, occlusion, crowding and the model's tracking limit can produce
  fragmented or missed segments.
- Appearance and disappearance events are review proposals, not assertions of
  biological entry, exit, visit count or individual identity.
- Provider-reported usage can support cost estimates but is not a billing-ledger
  confirmation.
