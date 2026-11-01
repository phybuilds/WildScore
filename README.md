# WildScore

**A field log you can listen to.** WildScore turns short wildlife videos into an
evidence-linked timeline that researchers can review by sight and sound.

[Open the live cached demo](https://wildscore-demo.pages.dev/) · Built for the
Meta Global AI Developer Hackathon with **Meta SAM 3.1** and **Muse Spark 1.3**

The live site is a transparent replay of saved analysis, not live inference.
Every track, event and label remains a proposal until a person reviews it.

## Try it in 60 seconds

1. Open the live demo and press **Analyse** to replay the saved pipeline result.
2. Select a track or event to jump to its source evidence and hear its spatial cue.
3. Accept, reject or mark an event **Can’t tell**; correct labels separately.
4. Review supplemental recovery tracks and generic rerun findings without silently
   merging identities.
5. Export the full event ledger or descriptive track metrics as CSV.

For a keyless, network-free local copy:

```bash
npm ci --ignore-scripts
npm run demo -- --check
npm run demo
```

The demo command verifies the committed asset hashes before building. It removes
`MODEL_API_KEY` from the build environment and binds the viewer to `127.0.0.1`.

## Why it matters — Impact (30%)

Wildlife footage accumulates faster than small research teams can inspect it.
Crowded scenes, occlusion and camera movement make automated output especially
hard to trust. WildScore is designed for the researcher who must answer a simpler
question first: **what did the model see, when, and what evidence supports it?**

The project fits **Build for Your World** by reducing the repetitive visual search
and bookkeeping around field-video review. It also reaches toward **Push the
Frontier** by turning segmentation geometry into a navigable audiovisual score:
horizontal position becomes stereo position, appearance and disappearance use
different cue shapes, and every cue links back to the exact saved evidence.

WildScore does not claim measured time savings or production accuracy yet. The
current result establishes a usable review workflow and exposes model failure
rather than hiding it.

## Meta AI use (25%)

- **SAM 3.1** proposes frame-indexed animal geometry from a metadata-stripped
  derivative. Sparse frames and object identifiers are parsed explicitly.
- **Muse Spark 1.3** reviews bounded visual evidence for a small number of tracks.
  It receives no filename, filming location or user-supplied species hint.
- **Geometry becomes interaction:** track position drives the stereo score, saved
  timestamps drive deterministic navigation, and reruns can be compared without
  asserting that two tracks are the same animal.
- **Human review is first-class:** event decisions, label decisions, recovery
  evidence and rerun-audit decisions are separate records. Machine proposals are
  preserved when a researcher corrects them.

Every model called by the WildScore analysis pipeline is a Meta model. The static
viewer itself makes no model call.

## Technical execution (20%)

```text
local video
  -> ffprobe validation
  -> metadata-stripped private derivative
  -> Meta SAM 3.1 geometry
  -> deterministic presence and event proposals
  -> bounded Muse Spark 1.3 label evidence
  -> validated private bundle
  -> static review viewer and defensive CSV exports
```

The CLI uses argument arrays rather than shell interpolation, pins the Meta API
host, caps duration and calls, checkpoints resumable stages, validates model
output, and confirms remote media deletion after SAM. If Spark fails, the
geometry timeline remains reviewable with unlabelled tracks.

Browser review state is scoped to the analysis bundle and stored locally. CSV
exports include rejected and uncertain proposals and neutralise spreadsheet
formula prefixes in editable fields.

Run the complete verification suite:

```bash
npm test
npm run typecheck
npm run build
npm run check:public
```

## Working demo (25%)

The bundled development clip currently contains:

- 51 saved event proposals with stored human decisions;
- 10 accepted supplemental recovery tracks;
- a separate generic-rerun audit that can keep or dismiss box-only evidence;
- a cached spatial-audio timeline, label corrections and auditable CSV exports.

A separate short public-domain wolf clip supplied one frozen held-out check:
two eligible boundary events were matched with no misses or false alarms, and the
image-only Spark label matched the frozen reference. That single, uncrowded clip
is a pipeline check—not a general accuracy estimate.

The field-demo excerpt is sanitised, attributed to the WildScore project and
licensed **CC BY-NC 4.0**. Its attribution is included with the demo assets.

## Analyse your own footage

Requirements:

- Node.js 24.22.1 and npm 11.19.1;
- ffmpeg and ffprobe 8.0.3 or a later reviewed patched release;
- a Meta Model API key stored as `MODEL_API_KEY` in an ignored `.env.local` file.

Check the environment without printing the key:

```bash
node --env-file=.env.local bin/wildscore.mjs doctor
```

Inspect the bounded plan before any model call, then explicitly approve the full
run:

```bash
node --env-file=.env.local bin/wildscore.mjs analyse /path/to/clip.mp4 --dry-run --max-seconds 30 --max-calls 8
node --env-file=.env.local bin/wildscore.mjs analyse /path/to/clip.mp4 --full --yes --max-seconds 30 --max-calls 8
```

The total cap reserves up to three SAM attempts and uses the remainder for
visible-evidence-only Spark labels. Results stay under the ignored private run
directory. Open the printed run identifier without another model call:

```bash
node bin/wildscore.mjs view run-0123456789abcdef
```

A SAM-only run is also available:

```bash
node --env-file=.env.local bin/wildscore.mjs analyse /path/to/clip.mp4 --sam-only --yes --max-calls 3
```

## Security and privacy boundary

- `MODEL_API_KEY` is process-local. It is never accepted as a CLI argument,
  prefixed with `NEXT_PUBLIC_`, embedded in browser code, committed or logged.
- Source media, raw provider responses, caches and run bundles belong under the
  ignored private directory.
- Input is re-encoded with metadata removed before it is sent to a model.
- The public viewer has no upload endpoint, API route, inference proxy or secret.
- Public output is scanned for credentials, environment files, personal paths,
  private run data and source metadata before release.

## Current limitations

- The crowded development clip revealed missed animals, fragmented tracks and
  duplicate identities. Accepted recovery layers improve visible coverage but do
  not retroactively prove recall or persistent animal identity.
- Camera motion, occlusion, crowding and short tracks remain difficult. Event
  proposals are not biological claims about entry, exit or visit count.
- Muse Spark labels are bounded visual proposals, not calibrated confidence
  scores. The provider outputs used here do not supply a trustworthy,
  cross-stage confidence value, so the CSV intentionally has no confidence
  column.
- The held-out result is one small pipeline check. More diverse, independently
  annotated clips are required before reporting accuracy.
- Live missed-animal batch recovery remains a planned extension; its label-free,
  bounded preflight contract exists, but the CLI does not yet execute that batch.

## After the hackathon

SpeciesNet is a candidate comparison or optional integration after the Meta
hackathon. It is excluded from this build so the submitted pipeline remains
Meta-only. Any later integration must preserve local-first privacy, provenance
and human review boundaries.
