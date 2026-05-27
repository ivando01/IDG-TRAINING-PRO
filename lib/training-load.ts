type ZoneTotalLike = {
  zoneKey?: unknown;
  seconds?: unknown;
};

type ExerciseLike = {
  reps?: unknown;
  repsBySet?: unknown;
  weights?: unknown;
};

function num(value: unknown) {
  const parsed = Number(String(value || "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function repsForLoad(value: unknown) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return 0;
  if (/\d+\s*s/.test(text)) return 1;
  const range = text.match(/(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)/);
  if (range) {
    const first = num(range[1]);
    const second = num(range[2]);
    return first && second ? (first + second) / 2 : 0;
  }
  return num(text);
}

export function gymTonnageFromExercises(exercises: unknown) {
  if (!Array.isArray(exercises)) return 0;
  return exercises.reduce((sessionSum, rawExercise) => {
    const exercise = rawExercise as ExerciseLike;
    const weights = Array.isArray(exercise.weights) ? exercise.weights : [];
    const repsBySet = Array.isArray(exercise.repsBySet) ? exercise.repsBySet : [];
    return sessionSum + weights.reduce((exerciseSum, weight, index) => {
      const reps = repsForLoad(repsBySet[index] ?? exercise.reps);
      return exerciseSum + (num(weight) * reps);
    }, 0);
  }, 0);
}

export function cardioTrimpFromZones(zoneTotals: unknown) {
  if (!Array.isArray(zoneTotals)) return 0;
  return zoneTotals.reduce((sum, rawZone) => {
    const zone = rawZone as ZoneTotalLike;
    const key = String(zone.zoneKey || "");
    const factor = Number(key.replace(/\D/g, "")) || 0;
    if (!factor) return sum;
    return sum + (num(zone.seconds) / 60) * factor;
  }, 0);
}

