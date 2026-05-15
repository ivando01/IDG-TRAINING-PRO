"use client";

import { AppIcon, type AppIconName } from "@/components/Brand";
import TopNav from "@/components/TopNav";
import { getCloudCollection, saveCloudCollection } from "@/lib/cloud-sync";
import { useEffect, useMemo, useState } from "react";

type HistoryItem = {
  id: string;
  date: string;
  type: "global" | "question";
  period: string;
  title: string;
  analysis: string;
  acknowledgedAt?: string;
};

type SleepRecord = {
  id: string;
  date: string;
  source: "manual" | "image" | "json";
  fileName?: string;
  hours?: number | null;
  minutes?: number | null;
  score?: number | null;
  qualityScore?: number | null;
  deepMinutes?: number | null;
  lightMinutes?: number | null;
  remMinutes?: number | null;
  awakeMinutes?: number | null;
  hrv?: number | null;
  restingHr?: number | null;
  spo2?: number | null;
  respiratoryRate?: number | null;
  notes?: string;
  rawText?: string;
};

const HISTORY_KEY = "idg_intelligence_history_json";
const SLEEP_KEY = "idg_sleep_records_json";

function readJSON(key: string, fallback: unknown = [], allowBrowser = true) {
  if (!allowBrowser || typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function sameWeek(dateText?: string) {
  if (!dateText) return false;
  const date = new Date(`${dateText}T00:00:00`);
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  start.setHours(0, 0, 0, 0);
  return date >= start && date <= now;
}

function avg(values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => Number.isFinite(value));
  return valid.length ? Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length) : null;
}

function num(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value || "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function sleepHours(item: Record<string, unknown>) {
  const direct = num(item.hours) ?? num(item.sleep) ?? num(item.totalHours);
  if (direct !== null) return direct;
  const minutes = num(item.minutes) ?? num(item.totalMinutes) ?? num(item.durationMinutes);
  return minutes !== null ? Number((minutes / 60).toFixed(1)) : null;
}

function formatSleep(hours: number | null) {
  if (hours === null) return "--";
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  return `${whole}h ${minutes.toString().padStart(2, "0")}m`;
}

function formatMinutes(minutes?: number | null) {
  if (!Number.isFinite(minutes)) return "--";
  const value = Number(minutes);
  return `${Math.floor(value / 60)}h ${String(value % 60).padStart(2, "0")}m`;
}

function localISODate(date = new Date()) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function fileToDataURL(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(file);
  });
}

function normalizeSleepRecord(values: Record<string, unknown>, source: SleepRecord["source"], fileName?: string): SleepRecord {
  const totalMinutes = num(values.minutes) ?? num(values.totalMinutes) ?? num(values.durationMinutes);
  const hours = num(values.hours) ?? num(values.sleep) ?? num(values.totalHours) ?? (totalMinutes !== null ? Number((totalMinutes / 60).toFixed(2)) : null);
  return {
    id: crypto.randomUUID(),
    date: String(values.date || localISODate()).slice(0, 10),
    source,
    fileName,
    hours,
    minutes: totalMinutes ?? (hours !== null ? Math.round(hours * 60) : null),
    score: num(values.score) ?? num(values.points),
    qualityScore: num(values.qualityScore) ?? num(values.breathingQuality),
    deepMinutes: num(values.deepMinutes),
    lightMinutes: num(values.lightMinutes),
    remMinutes: num(values.remMinutes),
    awakeMinutes: num(values.awakeMinutes),
    hrv: num(values.hrv) ?? num(values.hrvMs),
    restingHr: num(values.restingHr) ?? num(values.restingHeartRate),
    spo2: num(values.spo2),
    respiratoryRate: num(values.respiratoryRate),
    notes: String(values.notes || ""),
    rawText: typeof values.rawText === "string" ? values.rawText : undefined,
  };
}

function sleepQualityLabel(score: number | null, hours: number | null) {
  if (score !== null && score >= 80) return "Bueno";
  if (score !== null && score >= 65) return "Regular";
  if (hours !== null && hours >= 7) return "Bueno";
  if (hours !== null && hours >= 6.3) return "Regular";
  return "Bajo";
}

function isTrainingActivity(item: Record<string, unknown>) {
  if (item.countsTowardTraining === false || item.activityKind === "support") return false;
  const text = `${String(item.activitySubType || "")} ${String(item.name || "")}`.toLowerCase();
  return !/walk|hike|caminar|caminata|senderismo/.test(text);
}

function riskLabel(metrics: { readiness: number; hardSessions: number; sleepHours: number | null; consistency: number }) {
  if (metrics.readiness < 62 || metrics.hardSessions > 2 || (metrics.sleepHours !== null && metrics.sleepHours < 6.3)) return "Alto";
  if (metrics.readiness < 76 || metrics.consistency > 85) return "Medio";
  return "Bajo";
}

function buildContext(allowBrowser = true) {
  const profile = readJSON("idg_profile_json", readJSON("iv_profile", {}, allowBrowser), allowBrowser) as Record<string, unknown>;
  const gym = readJSON("idg_gym_sessions_json", [], allowBrowser) as Array<Record<string, unknown>>;
  const running = (readJSON("idg_running_activities_json", readJSON("iv_run", [], allowBrowser), allowBrowser) as Array<Record<string, unknown>>).filter(isTrainingActivity);
  const cycling = readJSON("idg_cycling_activities_json", readJSON("iv_bike", [], allowBrowser), allowBrowser) as Array<Record<string, unknown>>;
  const weight = readJSON("idg_weight_records_json", [], allowBrowser) as Array<Record<string, unknown>>;
  const sleep = readJSON(SLEEP_KEY, [], allowBrowser) as Array<Record<string, unknown>>;

  const gymWeek = gym.filter((item) => sameWeek(String(item.date || "")));
  const runWeek = running.filter((item) => sameWeek(String(item.date || "")));
  const bikeWeek = cycling.filter((item) => sameWeek(String(item.date || "")));
  const sleepWeek = sleep.filter((item) => sameWeek(String(item.date || "")));
  const latestWeight = weight[0] || {};
  const previousWeight = weight[1] || {};
  const latestSleep = sleep[0] || {};
  const sleepTotal = sleepHours(latestSleep);
  const sleepScore = num(latestSleep.score) ?? num(latestSleep.qualityScore) ?? num(latestSleep.points);
  const hrv = num(latestSleep.hrv) ?? num(latestSleep.hrvMs) ?? num(profile.hrv);
  const restingHr = num(latestSleep.restingHr) ?? num(latestSleep.restingHeartRate) ?? num(profile.restingHr);
  const latestWeightKg = num(latestWeight.kg);
  const previousWeightKg = num(previousWeight.kg);
  const gymTarget = num(profile.gymDaysPerWeek) || 4;
  const runTarget = num(profile.runDaysPerWeek) || 2;
  const bikeTarget = num(profile.bikeDaysPerWeek) || 2;
  const completed = gymWeek.length + runWeek.length + bikeWeek.length;
  const target = gymTarget + runTarget + bikeTarget;
  const consistency = target ? Math.min(100, Math.round((completed / target) * 100)) : 0;
  const avgGymPain = avg(gymWeek.map((item) => num(item.painLevel)));
  const hardSessions = [...runWeek, ...bikeWeek].filter((item) => {
    const totals = Array.isArray(item.zoneTotals) ? item.zoneTotals : [];
    return totals.some((zone: Record<string, unknown>) => ["Z4", "Z5"].includes(String(zone.zoneKey)));
  }).length;
  const sleepPenalty = sleepTotal !== null && sleepTotal < 6.3 ? 9 : sleepTotal !== null && sleepTotal < 7 ? 4 : 0;
  const sleepBoost = sleepTotal !== null && sleepTotal >= 7.3 ? 4 : 0;
  const readiness = Math.max(45, Math.min(95, 78 + (consistency >= 60 ? 6 : -6) + sleepBoost - sleepPenalty - (hardSessions > 2 ? 8 : 0) - ((avgGymPain || 0) > 5 ? 8 : 0)));
  const cardio = runWeek.length + bikeWeek.length;
  const strength = gymWeek.length;
  const cardioPct = cardio + strength ? Math.round((cardio / (cardio + strength)) * 100) : 0;
  const latestActivity = [...gym, ...running, ...cycling].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0] || {};
  const latestCardio = [...running, ...cycling].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0] || {};
  const dominantZone = Array.isArray(latestCardio.zoneTotals)
    ? [...latestCardio.zoneTotals].sort((a: Record<string, unknown>, b: Record<string, unknown>) => (num(b.seconds) || 0) - (num(a.seconds) || 0))[0] as Record<string, unknown> | undefined
    : undefined;
  const goodSleep = sleep.filter((item) => {
    const hours = sleepHours(item);
    return hours !== null && hours >= 7;
  });
  const lowSleep = sleep.filter((item) => {
    const hours = sleepHours(item);
    return hours !== null && hours < 6.5;
  });

  return {
    profile,
    gym,
    running,
    cycling,
    weight,
    sleep,
    metrics: {
      readiness,
      consistency,
      completed,
      target,
      gymWeek: gymWeek.length,
      runWeek: runWeek.length,
      bikeWeek: bikeWeek.length,
      avgGymPain,
      hardSessions,
      cardioStrength: `${cardioPct}/${100 - cardioPct}`,
      latestWeightKg,
      weightDelta: latestWeightKg !== null && previousWeightKg !== null ? Number((latestWeightKg - previousWeightKg).toFixed(1)) : null,
      latestBodyFat: latestWeight.fat || null,
      latestMuscle: latestWeight.musclemass || latestWeight.muscle || null,
      sleepHours: sleepTotal,
      sleepScore,
      sleepQuality: sleepQualityLabel(sleepScore, sleepTotal),
      hrv,
      restingHr,
      sleepWeekAvg: sleepWeek.length ? Number((sleepWeek.reduce((sum, item) => sum + (sleepHours(item) || 0), 0) / sleepWeek.length).toFixed(1)) : null,
      sleepRecords: sleep.length,
      goodSleepDays: goodSleep.length,
      lowSleepDays: lowSleep.length,
      dominantZone: dominantZone ? `${dominantZone.zoneKey || ""} ${dominantZone.label || ""}`.trim() : "Sin datos",
      latestActivity: latestActivity.name || latestActivity.routineName || latestActivity.type || "Sin actividad",
    },
  };
}

function readinessLabel(score: number) {
  if (score >= 80) return "Listo con control de intensidad";
  if (score >= 65) return "Entrenar con moderacion";
  return "Priorizar recuperacion";
}

export default function AnalyticsModule() {
  const [period, setPeriod] = useState("Semana actual");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [question, setQuestion] = useState("");
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [context, setContext] = useState(() => buildContext(false));
  const [todayLabel, setTodayLabel] = useState("");
  const [sleepImporting, setSleepImporting] = useState(false);
  const [sleepForm, setSleepForm] = useState({
    date: "",
    hours: "",
    score: "",
    hrv: "",
    restingHr: "",
    deepMinutes: "",
    lightMinutes: "",
    remMinutes: "",
    awakeMinutes: "",
    notes: "",
  });

  useEffect(() => {
    let alive = true;
    setHistory(readJSON(HISTORY_KEY, []) as HistoryItem[]);
    setContext(buildContext());
    setTodayLabel(new Date().toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" }));
    setSleepForm((current) => ({ ...current, date: localISODate() }));
    getCloudCollection<HistoryItem>("/intelligence", "entries")
      .then((entries) => {
        if (!alive || !entries.length) return;
        const latestGlobal = entries.find((entry) => entry.type === "global");
        setHistory(entries);
        setSelectedId(latestGlobal?.id || entries[0]?.id || "");
        localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const latestGlobal = history.find((item) => item.type === "global");
  const selected = history.find((item) => item.id === selectedId) || latestGlobal || history[0];
  const metrics = context.metrics;
  const action = metrics.hardSessions > 2 ? "Running Z2 - 40 min" : metrics.gymWeek < (num(context.profile.gymDaysPerWeek) || 4) ? "Gym tecnico - 60 min" : "Ciclismo Z2 - 60 min";
  const fatigueRisk = riskLabel(metrics);
  const recoveryLabel = metrics.sleepHours !== null && metrics.sleepHours < 6.3 ? "Comprometida" : metrics.hardSessions > 2 ? "Vigilar" : "Estable";
  const sleepImpact = metrics.sleepHours === null
    ? "Importa analisis de sueno para que IDG Intelligence relacione descanso, carga y rendimiento."
    : metrics.sleepHours < 6.3
      ? `Dormiste ${formatSleep(metrics.sleepHours)}, por debajo del rango ideal. Conviene bajar intensidad y priorizar trabajo aerobico suave.`
      : `Dormiste ${formatSleep(metrics.sleepHours)}. El descanso permite tolerar carga moderada con control de zonas altas.`;
  const correlationText = metrics.sleepRecords < 4
    ? "Aun faltan mas registros de sueno para detectar una correlacion fuerte entre descanso, FC, zonas altas y ritmo/potencia."
    : `Base actual: ${metrics.goodSleepDays} dias con buen sueno y ${metrics.lowSleepDays} dias con sueno bajo. IDG comparara FC promedio, Z4/Z5 y recuperacion conforme acumules sesiones.`;
  const alerts = useMemo(() => {
    const items = [];
    if (metrics.hardSessions > 2) items.push(["Z4/Z5 elevada", "Bajar intensidad en la proxima sesion.", "border-amber-300"]);
    if ((metrics.avgGymPain || 0) >= 5) items.push(["Dolor en gym", "Revisar cargas y ejercicios sensibles.", "border-red-300"]);
    if (metrics.weightDelta !== null && Math.abs(metrics.weightDelta) > 0.8) items.push(["Peso cambiante", "Confirmar hidratacion y tendencia semanal.", "border-blue-300"]);
    if (!items.length) items.push(["Sin alertas criticas", "Mantener registro y consistencia.", "border-emerald-300"]);
    return items.slice(0, 3);
  }, [metrics]);

  const saveHistory = (next: HistoryItem[]) => {
    setHistory(next);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    saveCloudCollection("/intelligence", "entries", next).catch(() => undefined);
  };

  const runAnalysis = async (mode: "global" | "question", customQuestion = "") => {
    setLoading(true);
    setStatus("IDG Intelligence esta leyendo tus modulos...");
    try {
      const freshContext = buildContext();
      setContext(freshContext);
      const response = await fetch("/api/idg-intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: freshContext, mode, question: customQuestion, period }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo generar el analisis.");
      const item: HistoryItem = {
        id: crypto.randomUUID(),
        date: new Date().toISOString(),
        type: mode,
        period,
        title: mode === "question" ? customQuestion.slice(0, 80) || "Pregunta a IDG Intelligence" : "Analisis global",
        analysis: data.analysis,
      };
      const next = [item, ...history];
      saveHistory(next);
      setSelectedId(item.id);
      setShowAnalysis(mode === "question");
      setStatus("Analisis guardado.");
      if (mode === "question") setQuestion("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No se pudo conectar con IDG Intelligence.");
    } finally {
      setLoading(false);
    }
  };

  const acknowledge = (item: HistoryItem) => {
    const next = history.map((entry) => entry.id === item.id ? { ...entry, acknowledgedAt: new Date().toISOString() } : entry);
    saveHistory(next);
    setShowAnalysis(false);
  };

  const deleteItem = (id: string) => {
    const next = history.filter((item) => item.id !== id);
    saveHistory(next);
    setSelectedId(next[0]?.id || "");
  };

  const saveSleepRecords = (records: SleepRecord[], message: string) => {
    const clean = records
      .filter((record) => sleepHours(record as unknown as Record<string, unknown>) !== null || record.score !== null || record.hrv !== null || record.restingHr !== null)
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
      .slice(0, 180);
    localStorage.setItem(SLEEP_KEY, JSON.stringify(clean));
    setContext(buildContext());
    setStatus(message);
  };

  const importSleepAnalysis = async (file?: File) => {
    if (!file) return;
    setSleepImporting(true);
    setStatus("IDG Intelligence esta interpretando el analisis de sueno...");
    try {
      let record: SleepRecord;
      if (file.type.startsWith("image/")) {
        const image = await fileToDataURL(file);
        const response = await fetch("/api/sleep-image-analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudo interpretar la imagen de sueno.");
        record = normalizeSleepRecord({ ...(data.values || {}), rawText: data.raw }, "image", file.name);
      } else {
        const text = await file.text();
        const parsed = file.name.toLowerCase().endsWith(".json") ? JSON.parse(text) : { notes: text };
        record = normalizeSleepRecord(parsed, file.name.toLowerCase().endsWith(".json") ? "json" : "manual", file.name);
      }
      const current = readJSON(SLEEP_KEY, []) as SleepRecord[];
      saveSleepRecords([record, ...current], `Sueno registrado: ${formatSleep(sleepHours(record as unknown as Record<string, unknown>))}, score ${record.score ?? "--"}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No se pudo interpretar el analisis de sueno.");
    } finally {
      setSleepImporting(false);
    }
  };

  const saveManualSleep = () => {
    const record = normalizeSleepRecord({
      date: sleepForm.date || localISODate(),
      hours: sleepForm.hours,
      score: sleepForm.score,
      hrv: sleepForm.hrv,
      restingHr: sleepForm.restingHr,
      deepMinutes: sleepForm.deepMinutes,
      lightMinutes: sleepForm.lightMinutes,
      remMinutes: sleepForm.remMinutes,
      awakeMinutes: sleepForm.awakeMinutes,
      notes: sleepForm.notes,
    }, "manual");
    const current = readJSON(SLEEP_KEY, []) as SleepRecord[];
    saveSleepRecords([record, ...current], "Registro manual de sueno guardado.");
    setSleepForm({ date: localISODate(), hours: "", score: "", hrv: "", restingHr: "", deepMinutes: "", lightMinutes: "", remMinutes: "", awakeMinutes: "", notes: "" });
  };

  const deleteSleepRecord = (id: string) => {
    const current = readJSON(SLEEP_KEY, []) as SleepRecord[];
    saveSleepRecords(current.filter((record) => record.id !== id), "Registro de sueno eliminado.");
  };

  const sleepRecords = context.sleep as SleepRecord[];
  const latestSleep = sleepRecords[0];
  const latestSleepHours = latestSleep ? sleepHours(latestSleep as unknown as Record<string, unknown>) : null;
  const sleepEfficiency = metrics.sleepScore ?? (metrics.sleepQuality === "Bueno" ? 88 : metrics.sleepQuality === "Regular" ? 72 : 58);
  const readinessTone = metrics.readiness >= 80 ? "text-emerald-600" : metrics.readiness >= 65 ? "text-blue-600" : "text-amber-600";

  return (
    <>
      <TopNav title="Analisis IA" />
      <main className="min-h-0 flex-1 overflow-y-auto bg-[#F8FAFC] p-4 text-slate-900 lg:p-6">
        {status ? <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">{status}</div> : null}

        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-bold text-slate-500">Inteligencia aplicada a tu rendimiento y recuperacion</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-900">Analisis IA</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-fit rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-black text-blue-700 shadow-sm">
              {todayLabel ? `Hoy, ${todayLabel}` : "Hoy"}
            </div>
            <button className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-sm disabled:bg-blue-300" disabled={loading} type="button" onClick={() => runAnalysis("global")}>
              {loading ? "Analizando..." : "Generar analisis completo"}
            </button>
          </div>
        </div>

        <section className="mb-5 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-blue-50 text-blue-700"><AppIcon name="intelligence" className="h-4 w-4" /></span>
            <h2 className="text-sm font-black uppercase tracking-wide text-blue-700">Estado de hoy</h2>
          </div>
          <div className="grid gap-6 lg:grid-cols-[1fr_1.35fr_1fr] lg:divide-x lg:divide-slate-100">
            <div className="grid place-items-center text-center">
              <p className="text-sm font-black text-slate-900">Preparacion</p>
              <p className={`mt-3 text-5xl font-black leading-none ${readinessTone}`}>{metrics.readiness}%</p>
              <p className="mt-2 text-lg font-black text-slate-900">{metrics.readiness >= 80 ? "Alta" : metrics.readiness >= 65 ? "Media" : "Baja"}</p>
            </div>
            <div className="px-0 lg:px-8">
              <p className="text-sm font-black text-slate-900">Recomendacion IA</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">Hoy estas en condicion para {action.toLowerCase()}. Ajusta intensidad segun recuperacion y evita esfuerzos maximos si aparece fatiga.</p>
              <span className="mt-4 inline-flex rounded-lg bg-emerald-500 px-4 py-2 text-sm font-black text-white">{action}</span>
            </div>
            <div className="flex items-center justify-between gap-4 pl-0 lg:pl-8">
              <div>
                <p className="text-sm font-black text-slate-900">Riesgo de fatiga</p>
                <p className={`mt-2 text-2xl font-black ${fatigueRisk === "Bajo" ? "text-emerald-600" : fatigueRisk === "Medio" ? "text-amber-600" : "text-red-600"}`}>{fatigueRisk}</p>
                <p className="mt-1 text-xs font-bold text-slate-500">Recuperacion {recoveryLabel.toLowerCase()}</p>
              </div>
              <div className="grid h-24 w-24 shrink-0 place-items-center rounded-full bg-emerald-50">
                <div className="grid h-16 w-16 place-items-center rounded-full bg-white text-emerald-600 shadow-sm">
                  <AppIcon name="heartZones" className="h-7 w-7" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mb-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-blue-50 text-blue-700"><AppIcon name="analytics" className="h-4 w-4" /></span>
            <h2 className="text-sm font-black uppercase tracking-wide text-blue-700">Factores analizados</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            {[
              ["Sueno", formatSleep(metrics.sleepHours), metrics.sleepQuality, "heartZones"],
              ["HRV", metrics.hrv ? `${metrics.hrv} ms` : "--", metrics.hrv ? "Estable" : "Sin dato", "intelligence"],
              ["FC en reposo", metrics.restingHr ? `${metrics.restingHr} bpm` : "--", metrics.restingHr ? "Normal" : "Sin dato", "heartZones"],
              ["Carga semanal", metrics.consistency > 85 ? "Alta" : metrics.consistency > 55 ? "Media" : "Baja", `${metrics.completed}/${metrics.target} sesiones`, "analytics"],
              ["Ultima actividad", String(metrics.latestActivity), "Reciente", "running"],
              ["Zonas FC", metrics.dominantZone, "Dominante", "cycling"],
            ].map(([label, value, sub, icon]) => (
              <div className="rounded-lg border border-slate-100 bg-white p-4 shadow-sm" key={label}>
                <div className="mb-5 flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 text-blue-600">
                  <AppIcon name={String(icon) as AppIconName} className="h-4 w-4" />
                </div>
                <p className="text-xs font-black uppercase text-slate-500">{label}</p>
                <p className="mt-2 text-xl font-black text-slate-900">{value}</p>
                <p className="mt-2 text-xs font-black text-emerald-600">{sub}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-blue-600">Lectura de sueno</p>
              <h2 className="mt-1 text-lg font-black text-slate-900">Analisis importado y registro manual</h2>
            </div>
            <span className="w-fit rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">{sleepRecords.length} registros</span>
          </div>

          <div className="mt-4 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Ultimo analisis</p>
                  <h3 className="mt-1 text-2xl font-black text-slate-900">{latestSleep ? `${formatSleep(latestSleepHours)} - ${latestSleep.score ?? "--"} pts` : "Sin analisis importado"}</h3>
                  <p className="mt-1 text-sm font-semibold text-slate-500">{latestSleep ? `${latestSleep.date} · ${latestSleep.source === "image" ? "Imagen interpretada por IA" : latestSleep.source === "manual" ? "Registro manual" : "Archivo importado"}` : "Importa una captura o registra datos basicos para activar esta capa."}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-right">
                  <div className="rounded-lg bg-white px-3 py-2">
                    <p className="text-[10px] font-black uppercase text-slate-500">HRV</p>
                    <p className="font-black text-blue-700">{latestSleep?.hrv ?? "--"} ms</p>
                  </div>
                  <div className="rounded-lg bg-white px-3 py-2">
                    <p className="text-[10px] font-black uppercase text-slate-500">FC</p>
                    <p className="font-black text-emerald-700">{latestSleep?.restingHr ?? "--"} bpm</p>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                {[
                  ["Profundo", formatMinutes(latestSleep?.deepMinutes), "bg-violet-50 text-violet-700"],
                  ["Liviano", formatMinutes(latestSleep?.lightMinutes), "bg-fuchsia-50 text-fuchsia-700"],
                  ["REM", formatMinutes(latestSleep?.remMinutes), "bg-rose-50 text-rose-700"],
                  ["Despierto", formatMinutes(latestSleep?.awakeMinutes), "bg-amber-50 text-amber-700"],
                ].map(([label, value, color]) => (
                  <div className={`rounded-lg p-4 ${color}`} key={label}>
                    <p className="text-[10px] font-black uppercase tracking-wide">{label}</p>
                    <p className="mt-1 text-xl font-black">{value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-2">
                {sleepRecords.slice(0, 4).map((record) => (
                  <div className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2" key={record.id}>
                    <div>
                      <p className="text-sm font-black text-slate-900">{record.date} · {formatSleep(sleepHours(record as unknown as Record<string, unknown>))}</p>
                      <p className="mt-0.5 text-xs font-bold text-slate-500">Score {record.score ?? "--"} · HRV {record.hrv ?? "--"} · FC {record.restingHr ?? "--"}</p>
                    </div>
                    <button className="rounded-lg bg-red-50 px-2 py-1 text-xs font-black text-red-600" type="button" onClick={() => deleteSleepRecord(record.id)}>
                      Eliminar
                    </button>
                  </div>
                ))}
                {!sleepRecords.length ? <p className="rounded-lg bg-white p-4 text-sm font-bold text-slate-400">Aun no hay registros de sueno.</p> : null}
              </div>
            </div>

            <aside className="rounded-lg border border-slate-100 bg-white p-4">
              <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Datos basicos</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {[
                  ["Fecha", "date", "date"],
                  ["Horas", "hours", "number"],
                  ["Score", "score", "number"],
                  ["HRV", "hrv", "number"],
                  ["FC reposo", "restingHr", "number"],
                ].map(([label, key, type]) => (
                  <label className={`${key === "date" ? "col-span-2" : ""} grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500`} key={key}>
                    {label}
                    <input
                      className="h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold normal-case tracking-normal text-slate-800 outline-none focus:border-blue-400"
                      type={type}
                      step={key === "hours" ? "0.1" : "1"}
                      value={sleepForm[key as keyof typeof sleepForm]}
                      onChange={(event) => setSleepForm((current) => ({ ...current, [key]: event.target.value }))}
                    />
                  </label>
                ))}
              </div>
              <details className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
                <summary className="cursor-pointer text-xs font-black uppercase tracking-wide text-slate-500">Fases de sueno</summary>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {[
                    ["Profundo min", "deepMinutes"],
                    ["Liviano min", "lightMinutes"],
                    ["REM min", "remMinutes"],
                    ["Despierto min", "awakeMinutes"],
                  ].map(([label, key]) => (
                    <label className="grid gap-1 text-[10px] font-black uppercase text-slate-500" key={key}>
                      {label}
                      <input
                        className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm font-bold normal-case text-slate-800 outline-none focus:border-blue-400"
                        type="number"
                        value={sleepForm[key as keyof typeof sleepForm]}
                        onChange={(event) => setSleepForm((current) => ({ ...current, [key]: event.target.value }))}
                      />
                    </label>
                  ))}
                </div>
              </details>
              <textarea
                className="mt-3 min-h-20 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700 outline-none focus:border-blue-400"
                value={sleepForm.notes}
                onChange={(event) => setSleepForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Notas breves."
              />
              <div className="mt-3 grid gap-2">
                <label className={`grid place-items-center rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-black text-blue-700 transition hover:border-blue-300 hover:bg-blue-100 ${sleepImporting ? "cursor-wait opacity-70" : "cursor-pointer"}`}>
                  {sleepImporting ? "Interpretando imagen..." : "Importar imagen de sueno"}
                  <input className="hidden" disabled={sleepImporting} type="file" accept=".json,.csv,.txt,.jpg,.jpeg,.png" onChange={(event) => importSleepAnalysis(event.target.files?.[0])} />
                </label>
                <button className="rounded-lg bg-slate-900 px-4 py-3 text-sm font-black text-white" type="button" onClick={saveManualSleep}>
                  Guardar datos basicos
                </button>
              </div>
            </aside>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="rounded-lg border border-slate-100 bg-white p-5">
              <div className="mb-4 flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-violet-50 text-violet-700"><AppIcon name="heartZones" className="h-4 w-4" /></span>
                <h3 className="text-sm font-black uppercase tracking-wide text-blue-700">Impacto del sueno</h3>
              </div>
              <div className="grid gap-5 lg:grid-cols-[150px_minmax(0,1fr)]">
                <div className="grid place-items-center">
                  <div className="grid h-32 w-32 place-items-center rounded-full p-2" style={{ background: `conic-gradient(#6D5DFB ${sleepEfficiency * 3.6}deg, #E9E7FF 0deg)` }}>
                    <div className="grid h-full w-full place-items-center rounded-full bg-white">
                      <div className="text-center">
                        <p className="text-3xl font-black text-slate-900">{sleepEfficiency}%</p>
                        <p className="text-xs font-black text-blue-700">Calidad</p>
                      </div>
                    </div>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-semibold leading-6 text-slate-600">{sleepImpact}</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg bg-slate-50 p-4">
                      <p className="text-[10px] font-black uppercase text-slate-500">Promedio 7 dias</p>
                      <p className="mt-1 text-xl font-black text-slate-900">{metrics.sleepWeekAvg ? formatSleep(metrics.sleepWeekAvg) : "--"}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-4">
                      <p className="text-[10px] font-black uppercase text-slate-500">Score</p>
                      <p className="mt-1 text-xl font-black text-slate-900">{metrics.sleepScore ?? "--"}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-4">
                      <p className="text-[10px] font-black uppercase text-slate-500">Impacto</p>
                      <p className="mt-1 text-xl font-black text-amber-600">{metrics.sleepHours !== null && metrics.sleepHours < 6.5 ? "Moderado" : "Bajo"}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <aside className="rounded-lg border border-slate-100 bg-slate-50 p-5">
              <p className="text-xs font-black uppercase tracking-wide text-blue-600">Correlacion sueno-rendimiento</p>
              <h3 className="mt-1 text-lg font-black text-slate-900">Tendencia detectada</h3>
              <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">{correlationText}</p>
              <div className="mt-4 grid gap-2">
                {["FC promedio", "Z4/Z5", "Ritmo/Potencia", "Recuperacion"].map((item) => (
                  <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-xs font-black" key={item}>
                    <span className="text-slate-600">{item}</span>
                    <span className="text-blue-600">{metrics.sleepRecords < 4 ? "pendiente" : "comparando"}</span>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </section>

        <section className="mb-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-50 text-emerald-700"><AppIcon name="plan" className="h-4 w-4" /></span>
            <h2 className="text-sm font-black uppercase tracking-wide text-blue-700">Recomendacion IA</h2>
          </div>
          <div className="grid gap-4 lg:grid-cols-4">
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 p-5">
              <p className="text-sm font-black text-slate-900">Plan sugerido para hoy</p>
              <p className="mt-4 text-2xl font-black text-emerald-700">{action}</p>
              <div className="mt-5 flex gap-1">
                {[0, 1, 2, 3, 4].map((item) => <span className={`h-2 flex-1 rounded-full ${item < 3 ? "bg-emerald-500" : "bg-slate-200"}`} key={item} />)}
              </div>
              <div className="mt-2 flex justify-between text-[10px] font-bold text-slate-500"><span>Muy suave</span><span>Intensa</span></div>
            </div>
            <div className="rounded-lg bg-slate-50 p-5">
              <p className="text-sm font-black text-slate-900">Enfocate en</p>
              <div className="mt-4 grid gap-2 text-sm font-bold text-slate-600">
                {["Base aerobica", "Capilarizacion", "Movilidad", "Tecnica"].map((item) => <p key={item}>OK {item}</p>)}
              </div>
            </div>
            <div className="rounded-lg bg-red-50 p-5">
              <p className="text-sm font-black text-slate-900">Evitar hoy</p>
              <div className="mt-4 grid gap-2 text-sm font-bold text-slate-600">
                {["Series intensas", "Fuerza maxima", "Competicion", "Altas cargas"].map((item) => <p key={item}>Evitar {item}</p>)}
              </div>
            </div>
            <div className="rounded-lg bg-blue-50/70 p-5">
              <p className="text-sm font-black text-slate-900">Por que?</p>
              <p className="mt-4 text-sm font-semibold leading-6 text-slate-600">{sleepImpact} Carga actual: {metrics.consistency}% de consistencia semanal.</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {alerts.map(([title, text, border]) => (
              <div className={`rounded-lg border border-slate-100 border-l-4 ${border} bg-slate-50 p-4`} key={title}>
                <p className="font-black text-slate-900">{title}</p>
                <p className="mt-1 text-sm font-semibold text-slate-500">{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-5 rounded-lg border border-slate-200 bg-white p-6">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-blue-600">Lectura IA</p>
                <h2 className="mt-1 text-xl font-black text-slate-900">{selected?.title || "Sin analisis generado"}</h2>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold" value={period} onChange={(event) => setPeriod(event.target.value)}>
                  {["Semana actual", "Ultimo mes", "Ultimos 3 meses"].map((item) => <option key={item}>{item}</option>)}
                </select>
                <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-black text-white disabled:bg-blue-300" disabled={loading} type="button" onClick={() => runAnalysis("global")}>
                  {loading ? "Analizando..." : "Analisis completo"}
                </button>
              </div>
            </div>
            {!selected ? (
              <div className="mt-6 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                <p className="text-sm font-bold text-slate-500">Genera el primer analisis para guardar una lectura global del atleta.</p>
              </div>
            ) : !showAnalysis ? (
              <div className="mt-6 flex flex-col gap-3 rounded-lg border border-emerald-100 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-black text-emerald-800">{selected.type === "global" ? "Analisis global guardado." : "Lectura guardada."}</p>
                  <p className="mt-1 text-xs font-bold text-emerald-700">Permanece colapsado para priorizar el tablero. Puedes abrirlo o generar uno nuevo cuando lo necesites.</p>
                </div>
                <button className="w-fit rounded-lg bg-white px-3 py-2 text-xs font-black text-emerald-700" type="button" onClick={() => setShowAnalysis(true)}>Abrir lectura</button>
              </div>
            ) : (
              <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-5">
                <p className="whitespace-pre-wrap text-sm font-semibold leading-7 text-slate-700">{selected.analysis}</p>
                <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
                  <button className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700" type="button" onClick={() => setShowAnalysis(false)}>Colapsar</button>
                  <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-black text-white" type="button" onClick={() => acknowledge(selected)}>Enterado</button>
                </div>
              </div>
            )}
          </div>

          <aside className="rounded-lg border border-slate-100 bg-slate-50 p-5">
            <p className="text-xs font-black uppercase tracking-wide text-blue-600">Pregunta rapida</p>
            <h2 className="mt-1 text-lg font-black text-slate-900">Ajusta la lectura</h2>
            <textarea className="mt-4 min-h-28 w-full resize-none rounded-lg border border-slate-200 bg-white p-4 text-sm font-semibold outline-none focus:border-blue-500" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ej: Que deberia entrenar manana segun mi carga y sueno?" />
            <button className="mt-3 w-full rounded-lg bg-slate-900 px-4 py-3 text-sm font-black text-white disabled:bg-slate-400" disabled={loading || !question.trim()} type="button" onClick={() => runAnalysis("question", question)}>
              {loading ? "Consultando..." : "Enviar pregunta"}
            </button>
          </aside>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-blue-600">Archivo IA</p>
              <h2 className="text-lg font-black text-slate-900">Historial de analisis</h2>
            </div>
            <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{history.length} lecturas</span>
          </div>
          <div className="mt-4 grid gap-2 xl:grid-cols-2">
              {history.map((item) => (
                <div className={`grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg border p-3 ${selected?.id === item.id ? "border-blue-200 bg-blue-50" : "border-slate-100 bg-white"}`} key={item.id}>
                  <button className="text-left" type="button" onClick={() => { setSelectedId(item.id); setShowAnalysis(false); }}>
                    <p className="line-clamp-1 text-sm font-black text-slate-900">{item.title}</p>
                    <p className="mt-1 text-xs font-bold text-slate-500">{new Date(item.date).toLocaleDateString("es-CO")} - {item.period} - {item.acknowledgedAt ? "Leido" : "Pendiente"}</p>
                  </button>
                  <div className="flex gap-2">
                    <button className="rounded-lg border border-blue-100 bg-blue-50 px-2 py-2 text-xs font-black text-blue-700" type="button" onClick={() => { setSelectedId(item.id); setShowAnalysis(true); }}>
                      Ver
                    </button>
                    <button className="rounded-lg border border-red-100 bg-red-50 px-2 py-2 text-xs font-black text-red-600" type="button" onClick={() => deleteItem(item.id)}>
                      Eliminar
                    </button>
                  </div>
                </div>
              ))}
              {!history.length ? <p className="rounded-lg bg-slate-50 p-4 text-sm font-bold text-slate-400">Sin analisis guardados.</p> : null}
          </div>
        </section>
      </main>
    </>
  );
}
