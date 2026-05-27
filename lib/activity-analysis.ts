export type SportType = "running" | "cycling";

export type HRZone = {
  key: "Z1" | "Z2" | "Z3" | "Z4" | "Z5";
  name: string;
  min: number;
  max: number;
  color: string;
};

export type ActivityPoint = {
  lat?: number;
  lon?: number;
  ele?: number | null;
  time?: number;
  distanceKm: number;
  hr?: number | null;
  cad?: number | null;
  speedKmh?: number | null;
  power?: number | null;
  powerEstimated?: boolean;
  temp?: number | null;
};

export type ZoneTimelineSegment = {
  zoneKey: HRZone["key"] | "NA";
  label: string;
  color: string;
  seconds: number;
  startKm: number;
  endKm: number;
  avgHr: number | null;
  range: string;
};

export type ActivityMetrics = {
  distanceKm: number;
  durationSec: number;
  movingSec: number;
  avgSpeedKmh: number | null;
  maxSpeedKmh: number | null;
  pace: string | null;
  avgPower: number | null;
  elevationGain: number;
  elevationLoss: number;
  altitudeMax: number | null;
  altitudeMin: number | null;
  avgGradePct: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
  strideMeters: number | null;
  vo2Estimate: number | null;
  calories: number | null;
  normalizedPower: number | null;
  estimatedFtp: number | null;
  powerSource: "real" | "estimated" | "none";
  tss: number | null;
  intensityFactor: number | null;
  variabilityIndex: number | null;
};

export type ActivityAnalysis = {
  id: string;
  sport: SportType;
  activityKind?: "training" | "support";
  activitySubType?: string;
  countsTowardTraining?: boolean;
  source: "GPX" | "FIT" | "STRAVA";
  name: string;
  date: string;
  startTime?: string;
  points: ActivityPoint[];
  metrics: ActivityMetrics;
  zones: HRZone[];
  zoneTotals: ZoneTimelineSegment[];
  zoneTimeline: ZoneTimelineSegment[];
  notes: string;
  aiAnalysis?: string;
  aiGeneratedAt?: string;
  aiAcknowledgedAt?: string;
  segments: Array<{
    name: string;
    distanceKm: number;
    elevationGain: number;
    average: string;
    bestTime: string;
    result: string;
  }>;
};

const PROFILE_KEY = "idg_profile_json";
const LEGACY_PROFILE_KEY = "iv_profile";

const ZONE_COLORS = {
  Z1: "#94A3B8",
  Z2: "#22C55E",
  Z3: "#FACC15",
  Z4: "#F97316",
  Z5: "#EF4444",
};

export const DEFAULT_ZONES: HRZone[] = [
  { key: "Z1", name: "Calentamiento", min: 0, max: 114, color: ZONE_COLORS.Z1 },
  { key: "Z2", name: "Quema grasa", min: 114, max: 133, color: ZONE_COLORS.Z2 },
  { key: "Z3", name: "Aerobico", min: 133, max: 152, color: ZONE_COLORS.Z3 },
  { key: "Z4", name: "Anaerobico", min: 152, max: 171, color: ZONE_COLORS.Z4 },
  { key: "Z5", name: "Extremo", min: 171, max: 190, color: ZONE_COLORS.Z5 },
];

function calculatedZonesFromProfile(profile: Record<string, unknown> | null | undefined): HRZone[] {
  const fcmax = Number(profile?.fcmax) || 190;
  const fcrest = Number(profile?.fcrest) || 0;
  const useReserve = fcrest >= 35 && fcrest < fcmax - 20;
  const ranges = [
    [0.5, 0.6],
    [0.6, 0.7],
    [0.7, 0.8],
    [0.8, 0.9],
    [0.9, 1],
  ];
  return ranges.map(([minPct, maxPct], index) => {
    const key = `Z${index + 1}` as HRZone["key"];
    const min = useReserve ? fcrest + (fcmax - fcrest) * minPct : fcmax * minPct;
    const max = useReserve ? fcrest + (fcmax - fcrest) * maxPct : fcmax * maxPct;
    return {
      key,
      name: DEFAULT_ZONES[index].name,
      min: index === 0 ? 0 : Math.round(min),
      max: Math.round(max),
      color: ZONE_COLORS[key],
    };
  });
}

function sanitizeZones(zones: HRZone[], fallback: HRZone[]) {
  let previousMax = 0;
  const normalized = zones.slice(0, 5).map((zone, index) => {
    const key = `Z${index + 1}` as HRZone["key"];
    const fallbackZone = fallback[index] || DEFAULT_ZONES[index];
    const rawMin = Number(zone.min);
    const rawMax = Number(zone.max);
    const min = index === 0 ? 0 : Math.max(previousMax, Number.isFinite(rawMin) ? Math.round(rawMin) : fallbackZone.min);
    const max = Number.isFinite(rawMax) && rawMax > min ? Math.round(rawMax) : Math.max(min + 1, fallbackZone.max);
    previousMax = max;
    return {
      key,
      name: fallbackZone.name,
      min,
      max,
      color: ZONE_COLORS[key],
    };
  });
  const coherent = normalized.every((zone, index) => zone.min < zone.max && (index === 0 || zone.min >= normalized[index - 1].max));
  return coherent ? normalized : fallback;
}

export function getStoredZones(): HRZone[] {
  if (typeof window === "undefined") return DEFAULT_ZONES;
  try {
    const raw = localStorage.getItem(PROFILE_KEY) || localStorage.getItem(LEGACY_PROFILE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const calculated = calculatedZonesFromProfile(parsed);
    if (Array.isArray(parsed?.zones) && parsed.zones.length >= 5) {
      const stored = parsed.zones.slice(0, 5).map((zone: { name?: string; min?: number; max?: number }, index: number) => {
        const key = `Z${index + 1}` as HRZone["key"];
        return {
          key,
          name: DEFAULT_ZONES[index].name,
          min: Number(zone.min),
          max: Number(zone.max),
          color: ZONE_COLORS[key],
        };
      });
      return sanitizeZones(stored, calculated);
    }
    return calculated;
  } catch {
    return DEFAULT_ZONES;
  }
}

export function formatDuration(seconds: number) {
  const sec = Math.max(0, Math.round(seconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function formatPace(distanceKm: number, seconds: number) {
  if (!distanceKm || !seconds) return null;
  const total = seconds / distanceKm;
  const m = Math.floor(total / 60);
  const s = Math.round(total % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function haversineKm(a: ActivityPoint, b: ActivityPoint) {
  if (a.lat === undefined || a.lon === undefined || b.lat === undefined || b.lon === undefined) return 0;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function avg(values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => Number.isFinite(value) && Number(value) > 0);
  return valid.length ? Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length) : null;
}

export function normalizeCadenceValue(value: unknown, sport: SportType, activityName = "") {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  const name = activityName.toLowerCase();
  const looksLikeWalk = /caminar|caminata|walk|walking/.test(name);
  let cadence = parsed;

  if (sport === "running") {
    if (cadence >= 40 && cadence <= 125) cadence = cadence * 2;
    if (looksLikeWalk && cadence > 170 && cadence <= 260) cadence = cadence / 2;
    if (cadence < 40 || cadence > 260) return null;
  } else if (cadence < 20 || cadence > 180) {
    return null;
  }

  return Math.round(cadence);
}

function max(values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => Number.isFinite(value));
  return valid.length ? Math.round(Math.max(...valid)) : null;
}

function min(values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => Number.isFinite(value));
  return valid.length ? Math.round(Math.min(...valid)) : null;
}

function smoothNumericValues(values: Array<number | null | undefined>, radius = 3) {
  return values.map((value, index) => {
    if (!Number.isFinite(value)) return null;
    const slice = values
      .slice(Math.max(0, index - radius), Math.min(values.length, index + radius + 1))
      .filter((item): item is number => Number.isFinite(item));
    return slice.length ? slice.reduce((sum, item) => sum + item, 0) / slice.length : Number(value);
  });
}

function elevationStats(points: ActivityPoint[]) {
  const smoothed = smoothNumericValues(points.map((point) => point.ele), 4);
  const valid = smoothed.filter((value): value is number => Number.isFinite(value));
  let gain = 0;
  let loss = 0;
  let pending = 0;
  const noiseFloorM = 1.5;

  for (let i = 1; i < smoothed.length; i += 1) {
    const prev = smoothed[i - 1];
    const curr = smoothed[i];
    if (!Number.isFinite(prev) || !Number.isFinite(curr)) continue;
    pending += Number(curr) - Number(prev);
    if (Math.abs(pending) >= noiseFloorM) {
      if (pending > 0) gain += pending;
      else loss += Math.abs(pending);
      pending = 0;
    }
  }

  return {
    gain,
    loss,
    max: valid.length ? Math.round(Math.max(...valid)) : null,
    min: valid.length ? Math.round(Math.min(...valid)) : null,
  };
}

function zoneForHr(hr: number | null | undefined, zones: HRZone[]) {
  if (!hr || hr < 40) return null;
  const ordered = [...zones].sort((a, b) => a.min - b.min);
  if (ordered[0] && hr < ordered[0].min) return ordered[0];
  return ordered.find((zone) => hr >= zone.min && hr <= zone.max)
    || [...ordered].reverse().find((zone) => hr >= zone.min)
    || ordered.at(-1)
    || null;
}

function estimateCalories(avgHr: number | null, durationSec: number, sport: SportType, distanceKm: number) {
  const minutes = durationSec / 60;
  if (avgHr && minutes) {
    const weight = 68;
    const age = 46;
    return Math.max(0, Math.round(((-55.0969 + 0.6309 * avgHr + 0.1988 * weight + 0.2017 * age) / 4.184) * minutes));
  }
  return Math.round(distanceKm * (sport === "running" ? 70 : 35));
}

function getAthleteWeightKg() {
  if (typeof window === "undefined") return 68;
  try {
    const raw = localStorage.getItem(PROFILE_KEY) || localStorage.getItem(LEGACY_PROFILE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const value = Number(parsed?.weightKg || parsed?.weight || parsed?.peso || parsed?.currentWeight);
    return Number.isFinite(value) && value > 35 ? value : 68;
  } catch {
    return 68;
  }
}

function estimateVirtualCyclingPower(points: ActivityPoint[]) {
  const athleteKg = getAthleteWeightKg();
  const systemMassKg = athleteKg + 10;
  const crr = 0.005;
  const airDensity = 1.12;
  const cda = 0.36;
  const drivetrain = 0.96;
  const result = points.map((point) => ({ ...point }));
  for (let i = 1; i < result.length; i += 1) {
    const prev = result[i - 1];
    const point = result[i];
    if (point.power && point.power > 20) continue;
    const dt = point.time && prev.time ? Math.max(1, (point.time - prev.time) / 1000) : 1;
    const distanceM = Math.max(1, haversineKm(prev, point) * 1000);
    const vMs = point.speedKmh && point.speedKmh > 1 ? point.speedKmh / 3.6 : distanceM / dt;
    if (!Number.isFinite(vMs) || vMs < 1.5 || vMs > 25) continue;
    const elevationDelta = Number.isFinite(point.ele) && Number.isFinite(prev.ele) ? Number(point.ele) - Number(prev.ele) : 0;
    const grade = Math.max(-0.18, Math.min(0.18, elevationDelta / distanceM));
    const gravity = systemMassKg * 9.81 * grade * vMs;
    const rolling = systemMassKg * 9.81 * crr * vMs;
    const aero = 0.5 * airDensity * cda * vMs ** 3;
    const acceleration = i > 1 && result[i - 2].speedKmh ? systemMassKg * ((vMs - result[i - 2].speedKmh! / 3.6) / dt) * vMs : 0;
    const watts = Math.round(Math.max(0, (gravity + rolling + aero + acceleration) / drivetrain));
    point.power = Math.min(650, watts);
    point.powerEstimated = true;
  }
  return result;
}

function normalizedPower(points: ActivityPoint[]) {
  const power = points.map((point) => point.power).filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 20);
  if (power.length < 30) return null;
  const rolling: number[] = [];
  for (let i = 0; i < power.length; i += 1) {
    const slice = power.slice(Math.max(0, i - 29), i + 1);
    rolling.push(slice.reduce((sum, value) => sum + value, 0) / slice.length);
  }
  const fourth = rolling.reduce((sum, value) => sum + value ** 4, 0) / rolling.length;
  return Math.round(fourth ** 0.25);
}

function getStoredEstimatedFtp() {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PROFILE_KEY) || localStorage.getItem(LEGACY_PROFILE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const ftp = Number(parsed?.estimatedFtp || parsed?.ftpEstimate);
    return Number.isFinite(ftp) && ftp >= 80 && ftp <= 450 ? Math.round(ftp) : null;
  } catch {
    return null;
  }
}

function estimateCyclingFtpForActivity(points: ActivityPoint[], np: number | null, avgPower: number | null, durationSec: number) {
  const stored = getStoredEstimatedFtp();
  const power = points
    .map((point) => ({ power: typeof point.power === "number" && Number.isFinite(point.power) ? point.power : null, time: point.time }))
    .filter((point): point is { power: number; time: number | undefined } => point.power !== null && point.power > 20);
  let best20 = 0;
  if (power.length >= 30) {
    for (let start = 0; start < power.length; start += 1) {
      const startTime = power[start].time;
      let sum = 0;
      let count = 0;
      for (let end = start; end < power.length; end += 1) {
        if (startTime && power[end].time && power[end].time! - startTime > 20 * 60 * 1000) break;
        sum += power[end].power;
        count += 1;
      }
      if (count >= 20) best20 = Math.max(best20, sum / count);
    }
  }
  const candidates = [
    best20 ? best20 * 0.95 : null,
    durationSec >= 2400 && durationSec <= 5400 && avgPower ? avgPower * 0.95 : null,
    np ? np * 0.9 : null,
    stored,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  if (!candidates.length) return null;
  return Math.round(Math.max(80, Math.min(450, Math.max(...candidates))));
}

function estimateRunningVo2(avgSpeedKmh: number | null, avgHr: number | null, maxHr: number | null) {
  if (!avgSpeedKmh || avgSpeedKmh <= 0) return null;
  const metersPerMinute = (avgSpeedKmh * 1000) / 60;
  const runningEconomyVo2 = -4.6 + 0.182258 * metersPerMinute + 0.000104 * metersPerMinute ** 2;
  const hrRatio = avgHr && maxHr && avgHr > 70 && maxHr > avgHr
    ? Math.max(0.72, Math.min(0.96, avgHr / maxHr))
    : null;
  const estimate = hrRatio ? runningEconomyVo2 / hrRatio : runningEconomyVo2;
  return Math.round(Math.max(20, Math.min(80, estimate)));
}

function buildMetrics(points: ActivityPoint[], sport: SportType): ActivityMetrics {
  const durationSec = points.length > 1 && points[0].time && points.at(-1)?.time ? Math.round((points.at(-1)!.time! - points[0].time!) / 1000) : 0;
  const distanceKm = points.at(-1)?.distanceKm || 0;
  const elevation = elevationStats(points);
  const avgHr = avg(points.map((point) => point.hr));
  const speeds = points.map((point) => point.speedKmh).filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0.5);
  const powerAvg = sport === "cycling" ? avg(points.map((point) => point.power)) : null;
  const np = sport === "cycling" ? normalizedPower(points) : null;
  const powerPoints = sport === "cycling" ? points.filter((point) => point.power && point.power > 20) : [];
  const realPowerPoints = powerPoints.filter((point) => !point.powerEstimated);
  const powerSource = sport !== "cycling" || !powerPoints.length ? "none" : realPowerPoints.length >= powerPoints.length * 0.4 ? "real" : "estimated";
  const ftp = sport === "cycling" ? estimateCyclingFtpForActivity(points, np, powerAvg, durationSec) : null;
  const intensityFactor = np && ftp ? Number((np / ftp).toFixed(2)) : null;
  const tss = intensityFactor && durationSec ? Math.round((durationSec * np! * intensityFactor) / (ftp! * 3600) * 100) : null;
  const avgCadence = avg(points.map((point) => point.cad));
  const avgSpeedKmh = speeds.length ? Number((speeds.reduce((sum, value) => sum + value, 0) / speeds.length).toFixed(1)) : durationSec ? Number((distanceKm / (durationSec / 3600)).toFixed(1)) : null;
  const strideMeters = sport === "running" && avgCadence && distanceKm && durationSec ? Number(((distanceKm * 1000) / ((avgCadence * durationSec) / 60)).toFixed(2)) : null;
  const maxHrValue = max(points.map((point) => point.hr));
  const vo2Estimate = sport === "running" ? estimateRunningVo2(avgSpeedKmh, avgHr, maxHrValue) : null;
  return {
    distanceKm: Number(distanceKm.toFixed(2)),
    durationSec,
    movingSec: durationSec,
    avgSpeedKmh,
    maxSpeedKmh: speeds.length ? Number(Math.max(...speeds).toFixed(1)) : null,
    pace: sport === "running" ? formatPace(distanceKm, durationSec) : null,
    avgPower: sport === "cycling" ? powerAvg : null,
    elevationGain: Math.round(elevation.gain),
    elevationLoss: Math.round(elevation.loss),
    altitudeMax: elevation.max,
    altitudeMin: elevation.min,
    avgGradePct: distanceKm ? Number(((elevation.gain / (distanceKm * 1000)) * 100).toFixed(1)) : null,
    avgHr,
    maxHr: maxHrValue,
    avgCadence,
    strideMeters,
    vo2Estimate,
    calories: estimateCalories(avgHr, durationSec, sport, distanceKm),
    normalizedPower: sport === "cycling" ? np : null,
    estimatedFtp: sport === "cycling" ? ftp : null,
    powerSource,
    tss: sport === "cycling" ? tss : null,
    intensityFactor: sport === "cycling" ? intensityFactor : null,
    variabilityIndex: sport === "cycling" && np && powerAvg ? Number((np / powerAvg).toFixed(2)) : null,
  };
}

function downsample(points: ActivityPoint[], maxPoints = 2500) {
  if (points.length <= maxPoints) return points;
  const step = points.length / maxPoints;
  const sampled: ActivityPoint[] = [];
  for (let i = 0; i < maxPoints; i += 1) sampled.push(points[Math.min(points.length - 1, Math.round(i * step))]);
  return sampled;
}

function buildZoneAnalytics(points: ActivityPoint[], zones: HRZone[]) {
  const totals = new Map<string, ZoneTimelineSegment>();
  const timeline: ZoneTimelineSegment[] = [];
  const add = (segment: ZoneTimelineSegment) => {
    const existing = totals.get(segment.zoneKey);
    if (existing) {
      existing.seconds += segment.seconds;
      existing.endKm = Math.max(existing.endKm, segment.endKm);
      existing.avgHr = existing.avgHr && segment.avgHr ? Math.round((existing.avgHr + segment.avgHr) / 2) : existing.avgHr || segment.avgHr;
    } else totals.set(segment.zoneKey, { ...segment, startKm: 0, endKm: segment.endKm });
  };
  let current: ZoneTimelineSegment | null = null;
  let hrs: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const point = points[i];
    const zone = zoneForHr(point.hr, zones);
    const seconds = point.time && prev.time ? Math.max(1, Math.round((point.time - prev.time) / 1000)) : 1;
    const key = zone?.key || "NA";
    const label = zone ? `${zone.key} ${zone.name}` : "Sin FC";
    const color = zone?.color || "#CBD5E1";
    if (!current || current.zoneKey !== key) {
      if (current) {
        current.avgHr = hrs.length ? Math.round(hrs.reduce((sum, value) => sum + value, 0) / hrs.length) : null;
        timeline.push(current);
        add(current);
      }
      current = { zoneKey: key, label, color, seconds: 0, startKm: prev.distanceKm, endKm: point.distanceKm, avgHr: null, range: zone ? `${zone.min}-${zone.max} bpm` : "sin datos" };
      hrs = [];
    }
    current.seconds += seconds;
    current.endKm = point.distanceKm;
    if (point.hr) hrs.push(point.hr);
  }
  if (current) {
    current.avgHr = hrs.length ? Math.round(hrs.reduce((sum, value) => sum + value, 0) / hrs.length) : null;
    timeline.push(current);
    add(current);
  }
  return { zoneTotals: Array.from(totals.values()), zoneTimeline: timeline };
}

function buildSegments(points: ActivityPoint[], sport: SportType) {
  const distance = points.at(-1)?.distanceKm || 0;
  const chunks = sport === "cycling" ? [0.12, 0.34, 0.62] : [0.2, 0.5, 0.78];
  return chunks.map((ratio, index) => {
    const startKm = distance * ratio;
    const endKm = Math.min(distance, startKm + (sport === "cycling" ? Math.max(1.2, distance * 0.08) : Math.max(0.4, distance * 0.12)));
    const slice = points.filter((point) => point.distanceKm >= startKm && point.distanceKm <= endKm);
    const gain = elevationStats(slice).gain;
    return {
      name: index === 0 ? "Apertura controlada" : index === 1 ? "Bloque principal" : "Cierre de intensidad",
      distanceKm: Number(Math.max(0, endKm - startKm).toFixed(1)),
      elevationGain: Math.round(gain),
      average: sport === "cycling" ? `${avg(slice.map((point) => point.speedKmh)) || "--"} km/h` : `${avg(slice.map((point) => point.hr)) || "--"} bpm`,
      bestTime: slice.length > 1 && slice[0].time && slice.at(-1)?.time ? formatDuration((slice.at(-1)!.time! - slice[0].time!) / 1000) : "--",
      result: index === 1 ? "PR" : "Base",
    };
  });
}

function finalizeActivity(activity: Omit<ActivityAnalysis, "metrics" | "zoneTotals" | "zoneTimeline" | "segments">): ActivityAnalysis {
  const preparedPoints = activity.sport === "cycling" ? estimateVirtualCyclingPower(activity.points) : activity.points;
  const analysisPoints = preparedPoints;
  const points = downsample(preparedPoints);
  const metrics = buildMetrics(analysisPoints, activity.sport);
  const zoneAnalytics = buildZoneAnalytics(analysisPoints, activity.zones);
  return {
    ...activity,
    points,
    metrics,
    ...zoneAnalytics,
    segments: buildSegments(points, activity.sport),
  };
}

export function createActivityFromPoints(activity: Omit<ActivityAnalysis, "metrics" | "zoneTotals" | "zoneTimeline" | "segments">): ActivityAnalysis {
  return finalizeActivity(activity);
}

function extNumber(point: Element, localName: string) {
  const all = Array.from(point.querySelectorAll("*"));
  const found = all.find((node) => node.localName === localName);
  return found ? Number(found.textContent) : null;
}

export async function parseGPXFile(file: File, sport: SportType, zones = getStoredZones()): Promise<ActivityAnalysis> {
  const text = await file.text();
  const xml = new DOMParser().parseFromString(text, "text/xml");
  const trackPoints = Array.from(xml.querySelectorAll("trkpt"));
  if (!trackPoints.length) throw new Error("El GPX no tiene puntos de ruta.");
  const name = xml.querySelector("trk name")?.textContent || file.name.replace(/\.gpx$/i, "");
  const points: ActivityPoint[] = [];
  let distanceKm = 0;
  for (const point of trackPoints) {
    const lat = Number(point.getAttribute("lat"));
    const lon = Number(point.getAttribute("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const timeText = point.querySelector("time")?.textContent;
    const next: ActivityPoint = {
      lat,
      lon,
      ele: Number(point.querySelector("ele")?.textContent ?? NaN),
      time: timeText ? new Date(timeText).getTime() : undefined,
      distanceKm,
      hr: extNumber(point, "hr"),
      cad: normalizeCadenceValue(extNumber(point, "cad"), sport, name),
      temp: extNumber(point, "atemp"),
    };
    const prev = points.at(-1);
    if (prev) {
      const delta = haversineKm(prev, next);
      if (delta < 0.5) distanceKm += delta;
      next.distanceKm = distanceKm;
      if (next.time && prev.time) {
        const dt = (next.time - prev.time) / 1000;
        next.speedKmh = dt > 0 ? Number(((delta / dt) * 3600).toFixed(1)) : null;
      }
    }
    points.push(next);
  }
  const start = points.find((point) => point.time)?.time;
  return finalizeActivity({
    id: crypto.randomUUID(),
    sport,
    source: "GPX",
    name,
    date: start ? new Date(start).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    startTime: start ? new Date(start).toISOString() : undefined,
    points,
    zones,
    notes: "",
  });
}

function readValue(bytes: Uint8Array, offset: number, size: number, arch: number, signed = false) {
  let value = 0;
  if (size === 1) value = bytes[offset];
  else if (size === 2) value = arch === 0 ? bytes[offset] | (bytes[offset + 1] << 8) : (bytes[offset] << 8) | bytes[offset + 1];
  else if (size === 4) {
    value = arch === 0 ? bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24) : (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
    value = signed ? value | 0 : value >>> 0;
  }
  return value;
}

function semicirclesToDegrees(value: number) {
  return (value * 180) / 2147483648;
}

export async function parseFITFile(file: File, sport: SportType, zones = getStoredZones()): Promise<ActivityAnalysis> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes[8] !== 46 || bytes[9] !== 70 || bytes[10] !== 73 || bytes[11] !== 84) throw new Error("Archivo FIT invalido.");
  const dataSize = bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24);
  let offset = bytes[0];
  const definitions: Record<number, { global: number; fields: Array<{ num: number; size: number; type: number }>; arch: number }> = {};
  const points: ActivityPoint[] = [];
  const fitEpoch = new Date("1989-12-31T00:00:00Z").getTime();
  let distanceKm = 0;
  while (offset < dataSize + bytes[0] && offset < bytes.length - 2) {
    const header = bytes[offset++];
    if (header & 0x80) continue;
    const isDefinition = (header & 0x40) !== 0;
    const local = header & 0x0f;
    if (isDefinition) {
      offset += 1;
      const arch = bytes[offset++];
      const global = readValue(bytes, offset, 2, arch);
      offset += 2;
      const fieldsCount = bytes[offset++];
      const fields = [];
      for (let i = 0; i < fieldsCount; i += 1) fields.push({ num: bytes[offset++], size: bytes[offset++], type: bytes[offset++] });
      definitions[local] = { global, fields, arch };
    } else {
      const definition = definitions[local];
      if (!definition) break;
      const message: Record<number, number> = {};
      for (const field of definition.fields) {
        message[field.num] = readValue(bytes, offset, field.size, definition.arch, field.num === 0 || field.num === 1);
        offset += field.size;
      }
      if (definition.global === 20) {
        const latRaw = message[0];
        const lonRaw = message[1];
        const next: ActivityPoint = {
          lat: latRaw !== undefined && latRaw !== 0x7fffffff ? semicirclesToDegrees(latRaw) : undefined,
          lon: lonRaw !== undefined && lonRaw !== 0x7fffffff ? semicirclesToDegrees(lonRaw) : undefined,
          ele: message[2] && message[2] < 65535 ? message[2] / 5 - 500 : null,
          time: message[253] ? fitEpoch + message[253] * 1000 : undefined,
          distanceKm,
          hr: message[3] && message[3] < 250 ? message[3] : null,
          cad: normalizeCadenceValue(message[4], sport, file.name),
          speedKmh: message[6] && message[6] < 65535 ? Number(((message[6] / 1000) * 3.6).toFixed(1)) : null,
          power: sport === "cycling" && message[7] && message[7] < 3000 ? message[7] : null,
        };
        const prev = points.at(-1);
        if (prev) {
          const delta = haversineKm(prev, next);
          if (delta < 0.5) distanceKm += delta;
          next.distanceKm = distanceKm;
          if (sport === "cycling" && !next.power && next.speedKmh && prev.ele !== null && next.ele !== null && prev.ele !== undefined && next.ele !== undefined) {
            const dt = next.time && prev.time ? Math.max(1, (next.time - prev.time) / 1000) : 1;
            const grade = ((next.ele - prev.ele) / Math.max(1, (next.speedKmh / 3.6) * dt)) * 100;
            const vMs = next.speedKmh / 3.6;
            const massKg = 80;
            const force = massKg * 9.81 * Math.sin(Math.atan(grade / 100)) + massKg * 9.81 * 0.004 + 0.5 * 1.15 * 0.35 * vMs * vMs;
            next.power = Math.max(0, Math.round(force * vMs));
          }
        }
        if (Number.isFinite(next.lat) || next.hr || next.speedKmh) points.push(next);
      }
    }
  }
  const start = points.find((point) => point.time)?.time;
  return finalizeActivity({
    id: crypto.randomUUID(),
    sport,
    source: "FIT",
    name: file.name.replace(/\.fit$/i, ""),
    date: start ? new Date(start).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    startTime: start ? new Date(start).toISOString() : undefined,
    points,
    zones,
    notes: "",
  });
}

export async function parseActivityFile(file: File, sport: SportType) {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "gpx") return parseGPXFile(file, sport);
  if (ext === "fit") return parseFITFile(file, sport);
  throw new Error("Formato no soportado. Usa GPX o FIT.");
}

export function storageKeyForSport(sport: SportType) {
  return sport === "running" ? "idg_running_activities_json" : "idg_cycling_activities_json";
}

export function legacyKeyForSport(sport: SportType) {
  return sport === "running" ? "iv_run" : "iv_bike";
}
