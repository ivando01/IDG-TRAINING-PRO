type AnyRecord = Record<string, unknown>;

export type NutritionSuggestion = {
  calories: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  fiberMinG: number;
  fiberMaxG: number;
  multiplier: number;
  loadLabel: string;
  goalNote: string;
};

export type PerformanceEstimate = {
  ftp: number | null;
  ftpMethod: string;
  ftpConfidence: "alta" | "media" | "baja" | "pendiente";
  vo2: number | null;
  vo2Method: string;
  vo2Confidence: "alta" | "media" | "baja" | "pendiente";
};

export function numberValue(value: unknown) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function readArray(key: string) {
  if (typeof window === "undefined") return [] as AnyRecord[];
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed as AnyRecord[] : [];
  } catch {
    return [];
  }
}

function metric(activity: AnyRecord, key: string) {
  const metrics = (activity.metrics || {}) as AnyRecord;
  return numberValue(metrics[key] ?? activity[key]);
}

function activityDate(activity: AnyRecord) {
  const raw = String(activity.date || activity.startTime || activity.start_date || "");
  const time = Date.parse(raw);
  return Number.isFinite(time) ? time : 0;
}

function currentWeekLoad() {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  start.setHours(0, 0, 0, 0);
  const all = [
    ...readArray("idg_gym_sessions_json"),
    ...readArray("idg_running_activities_json"),
    ...readArray("idg_cycling_activities_json"),
  ];
  return all
    .filter((item) => activityDate(item) >= start.getTime())
    .reduce((sum, item) => {
      const durationMin = metric(item, "durationSec") ? Math.round((metric(item, "durationSec") || 0) / 60) : numberValue(item.duration) || 0;
      const tss = metric(item, "tss");
      const intensity = numberValue(item.intensity) || 6;
      return sum + (tss || Math.round(durationMin * intensity / 10));
    }, 0);
}

export function calculateNutritionSuggestion(profile: AnyRecord, latestWeightKg?: number | null): NutritionSuggestion | null {
  const currentKg = latestWeightKg || numberValue(profile.weight) || numberValue(profile.weightKg);
  if (!currentKg) return null;
  const goalKg = numberValue(profile.weightGoal) || currentKg;
  const goal = String(profile.goal || "").toLowerCase();
  const weeklyLoad = currentWeekLoad();
  let multiplier = 33;
  let loadLabel = "dia base";

  if (weeklyLoad >= 650) {
    multiplier = 40;
    loadLabel = "carga alta";
  } else if (weeklyLoad >= 360) {
    multiplier = 36;
    loadLabel = "carga moderada";
  } else if (weeklyLoad <= 120) {
    multiplier = 33;
    loadLabel = "descanso o gym suave";
  }

  let calories = Math.round(currentKg * multiplier);
  let goalNote = "Mantener energia disponible para entrenar.";
  if (goal.includes("perdida") || goal.includes("bajar") || goalKg < currentKg - 0.5) {
    calories -= currentKg - goalKg > 4 ? 400 : 250;
    goalNote = "Deficit moderado sin sacrificar proteina.";
  } else if (goal.includes("masa") || goalKg > currentKg + 0.5) {
    calories += 250;
    goalNote = "Superavit controlado para favorecer adaptacion.";
  }

  calories = Math.max(1200, Math.round(calories));
  const proteinG = Math.round(currentKg * 1.8);
  const fatG = Math.round(currentKg * 0.8);
  const carbsG = Math.max(0, Math.round((calories - (proteinG * 4 + fatG * 9)) / 4));

  return {
    calories,
    proteinG,
    fatG,
    carbsG,
    fiberMinG: 25,
    fiberMaxG: 35,
    multiplier,
    loadLabel,
    goalNote,
  };
}

function bestRollingPower(activity: AnyRecord) {
  const points = Array.isArray(activity.points) ? activity.points as AnyRecord[] : [];
  const valid = points
    .map((point) => ({
      power: numberValue(point.power),
      time: numberValue(point.time),
      estimated: Boolean(point.powerEstimated),
    }))
    .filter((point) => point.power && point.power > 20);
  if (valid.length < 30) return null;

  let best = 0;
  for (let start = 0; start < valid.length; start += 1) {
    const startTime = valid[start].time;
    let sum = 0;
    let count = 0;
    for (let end = start; end < valid.length; end += 1) {
      if (startTime && valid[end].time && valid[end].time! - startTime > 20 * 60 * 1000) break;
      sum += valid[end].power || 0;
      count += 1;
    }
    if (count >= 20) best = Math.max(best, sum / count);
  }
  if (!best) return null;
  const realCount = valid.filter((point) => !point.estimated).length;
  return { power: best, source: realCount >= valid.length * 0.4 ? "real" : "estimated" };
}

function estimateFtp(cycling: AnyRecord[]) {
  const candidates: Array<{ value: number; method: string; confidence: PerformanceEstimate["ftpConfidence"] }> = [];
  cycling.forEach((activity) => {
    const rolling = bestRollingPower(activity);
    if (rolling) {
      candidates.push({
        value: rolling.power * 0.95,
        method: rolling.source === "real" ? "mejor esfuerzo de 20 min con potencia real" : "mejor esfuerzo de 20 min con potencia estimada",
        confidence: rolling.source === "real" ? "alta" : "media",
      });
      return;
    }

    const durationSec = metric(activity, "durationSec") || metric(activity, "movingSec") || 0;
    const avgPower = metric(activity, "avgPower");
    const normalizedPower = metric(activity, "normalizedPower");
    const powerSource = String(((activity.metrics || {}) as AnyRecord).powerSource || activity.powerSource || "estimated");
    if (durationSec >= 2400 && durationSec <= 5400 && avgPower) {
      candidates.push({
        value: avgPower * 0.95,
        method: "potencia media en esfuerzo sostenido de 40-90 min",
        confidence: powerSource === "real" ? "media" : "baja",
      });
    } else if (normalizedPower) {
      candidates.push({
        value: normalizedPower * 0.9,
        method: "potencia normalizada estimada",
        confidence: powerSource === "real" ? "media" : "baja",
      });
    }
  });

  const best = candidates.sort((a, b) => b.value - a.value)[0];
  if (!best) return { ftp: null, ftpMethod: "pendiente de actividades con potencia", ftpConfidence: "pendiente" as const };
  return {
    ftp: Math.round(clamp(best.value, 80, 450)),
    ftpMethod: best.method,
    ftpConfidence: best.confidence,
  };
}

function estimateVo2(running: AnyRecord[], cycling: AnyRecord[], profile: AnyRecord) {
  const profileVo2 = numberValue(profile.vo2Max || profile.vo2max || profile.knownVo2Max);
  if (profileVo2 && profileVo2 >= 20 && profileVo2 <= 90) {
    return {
      vo2: Math.round(profileVo2),
      vo2Method: "valor actual registrado en perfil",
      vo2Confidence: "alta" as const,
    };
  }

  const direct = [...running, ...cycling]
    .map((activity) => metric(activity, "vo2Estimate"))
    .filter((value): value is number => Boolean(value && value >= 15 && value <= 90));
  if (direct.length) {
    return {
      vo2: Math.round(Math.max(...direct)),
      vo2Method: "mejor VO2 estimado por actividad",
      vo2Confidence: "media" as const,
    };
  }

  const fcmax = numberValue(profile.fcmax);
  const fcrest = numberValue(profile.fcrest);
  if (fcmax && fcrest && fcmax > fcrest) {
    return {
      vo2: Math.round(clamp(15.3 * (fcmax / fcrest), 20, 75)),
      vo2Method: "relacion FC maxima / FC reposo",
      vo2Confidence: "baja" as const,
    };
  }

  return { vo2: null, vo2Method: "pendiente de datos suficientes", vo2Confidence: "pendiente" as const };
}

export function estimatePerformance(profile: AnyRecord): PerformanceEstimate {
  const cycling = readArray("idg_cycling_activities_json");
  const running = readArray("idg_running_activities_json");
  const ftp = estimateFtp(cycling);
  const vo2 = estimateVo2(running, cycling, profile);
  return { ...ftp, ...vo2 };
}
