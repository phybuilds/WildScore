# WildScore evaluation summary

WildScore was evaluated as an evidence-led review workflow, not as a general wildlife-identification benchmark. The checks below separate exploratory user timing, deterministic event accounting and a small held-out pipeline check.

## One-clip exploratory pilot

Two users reviewed the same crowded waterhole clip using different workflows.

| Review workflow | Accepted events logged | Review time |
| :--- | ---: | ---: |
| Manual review | 22 | 34.5 minutes |
| WildScore-assisted review | 30 | 6 minutes |

The WildScore total is fully accounted for: **26 reviewer-accepted core proposals + 4 accepted recovery tracks with eligible event evidence = 30 accepted events**. Six additional accepted recovery tracks improved visible coverage but did not add eligible events.

The WildScore log included unidentified birds, a warthog and several baboon and antelope events that were not present in the manual log. No adjudicated reference count was established, so these figures compare two review logs; they do **not** establish recall, precision, accuracy or a general speed-up claim.

## Held-out pipeline check

A short, static, uncrowded public-domain wolf clip was frozen as a separate pipeline fixture.

- **2/2 eligible boundary events matched** the frozen reference.
- **0 misses and 0 false alarms** occurred within those two eligible events.
- The Muse Spark label matched the frozen reference.

This verifies the saved-bundle path on one bounded fixture. It is not evidence of general model accuracy.

## Failure-focused evaluation

Crowded development footage exposed track fragmentation, occlusion, camera-motion boundaries and animal/background blending. WildScore keeps the original SAM proposal immutable and records rejection, uncertainty, label correction and supplemental recovery separately. This makes failures inspectable instead of silently rewriting them.

## Reproduce the public checks

```bash
npm ci --ignore-scripts
npm test
npm run typecheck
npm run build
npm run test:demo-integrity
```

The keyless demo replays saved fixtures and makes no Meta API call. See the [demo guide](../docs/DEMO_GUIDE.md), [CI workflow](../.github/workflows/ci.yml) and [known model limitations](../README.md#known-model-limitations).
