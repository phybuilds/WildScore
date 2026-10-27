import type { CandidateEvent } from "../data/bundle-schema.ts";

type EventKind = CandidateEvent["event_kind"];

export interface ReferenceEvent {
  reference_event_id: string;
  reference_subject_id: string;
  event_kind: EventKind;
  onset_s: number;
  eligible: boolean;
  uncertainty_notes: string[];
}

export interface PredictedEvent {
  event_id: string;
  segment_id: string;
  event_kind: EventKind;
  onset_s: number;
}

export interface EventMatch {
  reference_event_id: string;
  prediction_event_id: string;
  event_kind: EventKind;
  onset_error_s: number;
}

export interface EventCountSummary {
  reference_count: number;
  matched_predictions: number;
  missed_events: number;
  false_alarms: number;
}

export interface EventEvaluation {
  tolerance_s: number;
  matches: EventMatch[];
  missed_reference_event_ids: string[];
  false_alarm_event_ids: string[];
  by_kind: Record<EventKind, EventCountSummary>;
  total: EventCountSummary;
}

const EVENT_KINDS: EventKind[] = ["appearance", "disappearance"];

function assertUniqueFiniteEvents(
  references: ReferenceEvent[],
  predictions: PredictedEvent[],
) {
  const referenceIds = new Set<string>();
  for (const reference of references) {
    if (
      referenceIds.has(reference.reference_event_id) ||
      !Number.isFinite(reference.onset_s) ||
      reference.onset_s < 0
    ) {
      throw new Error("Reference events require unique IDs and finite non-negative times");
    }
    referenceIds.add(reference.reference_event_id);
  }

  const predictionIds = new Set<string>();
  for (const prediction of predictions) {
    if (
      predictionIds.has(prediction.event_id) ||
      !Number.isFinite(prediction.onset_s) ||
      prediction.onset_s < 0
    ) {
      throw new Error("Predictions require unique IDs and finite non-negative times");
    }
    predictionIds.add(prediction.event_id);
  }
}

export function matchEvents({
  references,
  predictions,
  segmentCorrespondence,
  toleranceS = 1,
}: {
  references: ReferenceEvent[];
  predictions: PredictedEvent[];
  segmentCorrespondence: Readonly<Record<string, string>>;
  toleranceS?: number;
}): EventEvaluation {
  if (!Number.isFinite(toleranceS) || toleranceS < 0) {
    throw new Error("Event tolerance must be a finite non-negative number");
  }
  assertUniqueFiniteEvents(references, predictions);

  const eligibleReferences = references.filter((reference) => reference.eligible);
  const referenceById = new Map(
    eligibleReferences.map((reference) => [reference.reference_event_id, reference]),
  );
  const predictionById = new Map(
    predictions.map((prediction) => [prediction.event_id, prediction]),
  );
  const predictionForReference = new Map<string, string>();

  function candidatesFor(prediction: PredictedEvent): ReferenceEvent[] {
    const subjectId = segmentCorrespondence[prediction.segment_id];
    if (!subjectId) return [];
    return eligibleReferences
      .filter(
        (reference) =>
          reference.reference_subject_id === subjectId &&
          reference.event_kind === prediction.event_kind &&
          Math.abs(reference.onset_s - prediction.onset_s) <= toleranceS,
      )
      .sort(
        (left, right) =>
          Math.abs(left.onset_s - prediction.onset_s) -
            Math.abs(right.onset_s - prediction.onset_s) ||
          left.reference_event_id.localeCompare(right.reference_event_id),
      );
  }

  function assignPrediction(
    prediction: PredictedEvent,
    visitedReferenceIds: Set<string>,
  ): boolean {
    for (const reference of candidatesFor(prediction)) {
      if (visitedReferenceIds.has(reference.reference_event_id)) continue;
      visitedReferenceIds.add(reference.reference_event_id);
      const existingPredictionId = predictionForReference.get(
        reference.reference_event_id,
      );
      if (
        !existingPredictionId ||
        assignPrediction(
          predictionById.get(existingPredictionId)!,
          visitedReferenceIds,
        )
      ) {
        predictionForReference.set(reference.reference_event_id, prediction.event_id);
        return true;
      }
    }
    return false;
  }

  const orderedPredictions = [...predictions].sort(
    (left, right) =>
      left.onset_s - right.onset_s || left.event_id.localeCompare(right.event_id),
  );
  for (const prediction of orderedPredictions) {
    assignPrediction(prediction, new Set());
  }

  const matches = [...predictionForReference.entries()]
    .map(([referenceId, predictionId]): EventMatch => {
      const reference = referenceById.get(referenceId)!;
      const prediction = predictionById.get(predictionId)!;
      return {
        reference_event_id: referenceId,
        prediction_event_id: predictionId,
        event_kind: reference.event_kind,
        onset_error_s: Number((prediction.onset_s - reference.onset_s).toFixed(6)),
      };
    })
    .sort((left, right) =>
      left.reference_event_id.localeCompare(right.reference_event_id),
    );
  const matchedReferenceIds = new Set(
    matches.map((match) => match.reference_event_id),
  );
  const matchedPredictionIds = new Set(
    matches.map((match) => match.prediction_event_id),
  );
  const missedReferences = eligibleReferences.filter(
    (reference) => !matchedReferenceIds.has(reference.reference_event_id),
  );
  const falseAlarms = predictions.filter(
    (prediction) => !matchedPredictionIds.has(prediction.event_id),
  );

  function count(kind?: EventKind): EventCountSummary {
    const referenceCount = eligibleReferences.filter(
      (reference) => !kind || reference.event_kind === kind,
    ).length;
    const matchedCount = matches.filter(
      (match) => !kind || match.event_kind === kind,
    ).length;
    const falseAlarmCount = falseAlarms.filter(
      (prediction) => !kind || prediction.event_kind === kind,
    ).length;
    return {
      reference_count: referenceCount,
      matched_predictions: matchedCount,
      missed_events: referenceCount - matchedCount,
      false_alarms: falseAlarmCount,
    };
  }

  return {
    tolerance_s: toleranceS,
    matches,
    missed_reference_event_ids: missedReferences.map(
      (reference) => reference.reference_event_id,
    ),
    false_alarm_event_ids: falseAlarms.map((prediction) => prediction.event_id),
    by_kind: {
      appearance: count(EVENT_KINDS[0]),
      disappearance: count(EVENT_KINDS[1]),
    },
    total: count(),
  };
}
