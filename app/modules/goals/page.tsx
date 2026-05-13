"use client";

import { AppIcon, AppIconName } from "@/components/Brand";
import TopNav from "@/components/TopNav";
import { getCloudCollection, saveCloudCollection } from "@/lib/cloud-sync";
import { useEffect, useState } from "react";

type SportScope = "running" | "cycling" | "gym" | "swim" | "body" | "recovery";
type GoalType = "volume" | "event" | "performance" | "body" | "strength" | "habit" | "custom";
type MetricKey = "distanceKm" | "durationMin" | "sessions" | "weightKg" | "paceMinKm" | "powerWatts" | "loadKg" | "custom";
type GoalStatus = "active" | "completed" | "paused" | "at_risk";

type GoalMetric = {
  key: MetricKey;
  current: number;
  target: number;
  unit: string;
  period: "total" | "week" | "month";
  auto: boolean;
};

type GoalMilestone = {
  id: string;
  title: string;
  targetDate: string;
  completed: boolean;
  sport?: SportScope;
  metricTarget?: number;
  unit?: string;
};

type Goal = {
  id: string;
  title: string;
  prompt: string;
  description: string;
  sports: SportScope[];
  type: GoalType;
  deadline: string;
  measurable: boolean;
  metric?: GoalMetric;
  milestones: GoalMilestone[];
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
};

type GoalForm = {
  prompt: string;
  title: string;
  description: string;
  sports: SportScope[];
  type: GoalType;
  deadline: string;
  measurable: boolean;
  metricKey: MetricKey;
  current: number;
  target: number;
  unit: string;
  period: "total" | "week" | "month";
  auto: boolean;
  milestonesText: string;
};

type TrainingSignals = {
  totalSessions: number;
  runningKmMonth: number;
  cyclingKmMonth: number;
  runningKmTotal: number;
  cyclingKmTotal: number;
  runningMaxKm: number;
  cyclingMaxKm: number;
  gymSessionsMonth: number;
  gymSessionsTotal: number;
  lastRunKm: number;
  lastRideKm: number;
  latestWeight: number;
  exerciseNames: string[];
};

const GOALS_KEY = "idg_goals_json";
const LEGACY_GOALS_KEY = "iv_goals";

const todayISO = () => new Date().toISOString().slice(0, 10);

const emptyForm: GoalForm = {
  prompt: "",
  title: "",
  description: "",
  sports: ["running"],
  type: "custom",
  deadline: todayISO(),
  measurable: true,
  metricKey: "distanceKm",
  current: 0,
  target: 100,
  unit: "km",
  period: "total",
  auto: true,
  milestonesText: "",
};

const emptySignals: TrainingSignals = {
  totalSessions: 0,
  runningKmMonth: 0,
  cyclingKmMonth: 0,
  runningKmTotal: 0,
  cyclingKmTotal: 0,
  runningMaxKm: 0,
  cyclingMaxKm: 0,
  gymSessionsMonth: 0,
  gymSessionsTotal: 0,
  lastRunKm: 0,
  lastRideKm: 0,
  latestWeight: 0,
  exerciseNames: [],
};

const sportMeta: Record<SportScope, { label: string; icon: AppIconName; soft: string; bar: string }> = {
  running: { label: "Running", icon: "running", soft: "bg-emerald-50 text-emerald-700 border-emerald-100", bar: "bg-emerald-500" },
  cycling: { label: "Ciclismo", icon: "cycling", soft: "bg-sky-50 text-sky-700 border-sky-100", bar: "bg-sky-500" },
  gym: { label: "Gym", icon: "gym", soft: "bg-blue-50 text-blue-700 border-blue-100", bar: "bg-blue-600" },
  swim: { label: "Natacion", icon: "route", soft: "bg-cyan-50 text-cyan-700 border-cyan-100", bar: "bg-cyan-500" },
  body: { label: "Peso & cuerpo", icon: "weight", soft: "bg-violet-50 text-violet-700 border-violet-100", bar: "bg-violet-600" },
  recovery: { label: "Recuperacion", icon: "heartZones", soft: "bg-amber-50 text-amber-700 border-amber-100", bar: "bg-amber-500" },
};

const typeLabels: Record<GoalType, string> = {
  volume: "Volumen",
  event: "Evento",
  performance: "Rendimiento",
  body: "Composicion",
  strength: "Fuerza",
  habit: "Habito",
  custom: "Libre",
};

const metricLabels: Record<MetricKey, string> = {
  distanceKm: "Distancia",
  durationMin: "Tiempo",
  sessions: "Sesiones",
  weightKg: "Peso",
  paceMinKm: "Pace",
  powerWatts: "Potencia",
  loadKg: "Carga",
  custom: "Personalizada",
};

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function num(value: unknown) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDate(value: unknown) {
  const text = String(value || todayISO()).slice(0, 10);
  const [year, month, day] = text.split("-").map(Number);
  return new Date(year || new Date().getFullYear(), (month || 1) - 1, day || 1);
}

function addDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function isoFromParts(day: number, month: number, year?: number) {
  const now = new Date();
  const resolvedYear = year || now.getFullYear();
  const date = new Date(resolvedYear, month - 1, day);
  if (!year && date.getTime() < parseDate(todayISO()).getTime()) {
    date.setFullYear(resolvedYear + 1);
  }
  return date.toISOString().slice(0, 10);
}

function daysTo(deadline: string) {
  const end = parseDate(deadline);
  const today = parseDate(todayISO());
  return Math.ceil((end.getTime() - today.getTime()) / 86400000);
}

function monthStart() {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getDistanceKm(item: Record<string, unknown>) {
  const metrics = item.metrics && typeof item.metrics === "object" ? (item.metrics as Record<string, unknown>) : {};
  return num(metrics.distanceKm ?? item.distanceKm ?? item.distance ?? item.km);
}

function getActivityDate(item: Record<string, unknown>) {
  return parseDate(item.date ?? item.start_date ?? item.startDate ?? item.createdAt);
}

function inCurrentMonth(item: Record<string, unknown>) {
  return getActivityDate(item).getTime() >= monthStart().getTime();
}

function loadTrainingSignals(): TrainingSignals {
  const running = readJSON<Array<Record<string, unknown>>>("idg_running_activities_json", readJSON("iv_run", []));
  const cycling = readJSON<Array<Record<string, unknown>>>("idg_cycling_activities_json", readJSON("iv_bike", []));
  const gym = readJSON<Array<Record<string, unknown>>>("idg_gym_sessions_json", readJSON("iv_gym", []));
  const weight = readJSON<Array<Record<string, unknown>>>("idg_weight_records_json", readJSON("iv_weight", []));
  const exerciseNames = new Set<string>();

  gym.forEach((session) => {
    const exercises = Array.isArray(session.exercises) ? session.exercises : [];
    exercises.forEach((exercise) => {
      if (exercise && typeof exercise === "object") {
        const name = String((exercise as Record<string, unknown>).name || "").trim();
        if (name) exerciseNames.add(name);
      }
    });
  });

  return {
    totalSessions: running.length + cycling.length + gym.length,
    runningKmMonth: running.filter(inCurrentMonth).reduce((sum, item) => sum + getDistanceKm(item), 0),
    cyclingKmMonth: cycling.filter(inCurrentMonth).reduce((sum, item) => sum + getDistanceKm(item), 0),
    runningKmTotal: running.reduce((sum, item) => sum + getDistanceKm(item), 0),
    cyclingKmTotal: cycling.reduce((sum, item) => sum + getDistanceKm(item), 0),
    runningMaxKm: running.reduce((max, item) => Math.max(max, getDistanceKm(item)), 0),
    cyclingMaxKm: cycling.reduce((max, item) => Math.max(max, getDistanceKm(item)), 0),
    gymSessionsMonth: gym.filter((item) => inCurrentMonth(item as Record<string, unknown>)).length,
    gymSessionsTotal: gym.length,
    lastRunKm: getDistanceKm(running[0] || {}),
    lastRideKm: getDistanceKm(cycling[0] || {}),
    latestWeight: num(weight[0]?.kg ?? weight[0]?.weight ?? weight[0]?.value),
    exerciseNames: Array.from(exerciseNames).slice(0, 10),
  };
}

function inferDeadline(text: string) {
  const normalized = normalizeText(text);
  const value = num(normalized.match(/(\d+(?:[.,]\d+)?)\s*(dia|dias|semana|semanas|mes|meses|ano|anos|año|años)/)?.[1]);
  const unit = normalized.match(/\d+(?:[.,]\d+)?\s*(dia|dias|semana|semanas|mes|meses|ano|anos|año|años)/)?.[1] || "";
  if (!value) return addDays(90);
  if (unit.startsWith("semana")) return addDays(value * 7);
  if (unit.startsWith("mes")) return addDays(value * 30);
  if (unit.startsWith("ano") || unit.startsWith("año")) return addDays(value * 365);
  return addDays(value);
}

function inferDeadlineFromContext(text: string) {
  const normalized = normalizeText(text);
  const months: Record<string, number> = {
    enero: 1,
    febrero: 2,
    marzo: 3,
    abril: 4,
    mayo: 5,
    junio: 6,
    julio: 7,
    agosto: 8,
    septiembre: 9,
    setiembre: 9,
    octubre: 10,
    noviembre: 11,
    diciembre: 12,
  };
  const absolute = normalized.match(/(?:antes\s+del|para|el)?\s*(\d{1,2})\s+de\s+([a-z]+)(?:\s+de)?\s*(\d{4})?/);
  if (absolute && months[absolute[2]]) {
    return isoFromParts(Number(absolute[1]), months[absolute[2]], absolute[3] ? Number(absolute[3]) : undefined);
  }

  const numeric = normalized.match(/(?:antes\s+del|para|el)?\s*(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/);
  if (numeric) {
    const year = numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : undefined;
    return isoFromParts(Number(numeric[1]), Number(numeric[2]), year);
  }

  return inferDeadline(text);
}

function buildMilestoneText(title: string, sports: SportScope[], deadline: string, target?: number, unit?: string) {
  const endDays = Math.max(14, daysTo(deadline));
  const first = addDays(Math.round(endDays * 0.25));
  const second = addDays(Math.round(endDays * 0.55));
  const third = addDays(Math.round(endDays * 0.82));

  if (target && unit) {
    return [
      `Base: completar 30% de ${target} ${unit} antes de ${first}`,
      `Construccion: llegar a 60% de ${target} ${unit} antes de ${second}`,
      `Simulacion: alcanzar 85% de ${target} ${unit} antes de ${third}`,
    ].join("\n");
  }

  if (sports.includes("running") && sports.includes("cycling") && sports.includes("swim")) {
    return [
      `Base aerobica: correr y rodar comodo antes de ${first}`,
      `Brick controlado: ciclismo + running en la misma sesion antes de ${second}`,
      `Simulacion parcial de triatlon antes de ${third}`,
    ].join("\n");
  }

  return [
    `Definir prueba base para ${title || "la meta"} antes de ${first}`,
    `Completar bloque especifico antes de ${second}`,
    `Ensayo final antes de ${third}`,
  ].join("\n");
}

function inferGoalFromPrompt(prompt: string): GoalForm {
  const text = normalizeText(prompt);
  const sports = new Set<SportScope>();
  let type: GoalType = "custom";
  let metricKey: MetricKey = "custom";
  let unit = "";
  let target = 100;
  let measurable = false;
  let period: GoalMetric["period"] = "total";
  const isSingleEffort = /un solo|solo recorrido|recorrido unico|una sola|fondo largo|evento|prueba/.test(text);

  if (/triat|ironman/.test(text)) {
    sports.add("running");
    sports.add("cycling");
    sports.add("swim");
    sports.add("gym");
    type = "event";
  }
  if (/run|correr|10k|21k|maraton|media/.test(text)) sports.add("running");
  if (/cicl|bici|ruta|rodar|km al mes|kilometro/.test(text)) sports.add("cycling");
  if (/gym|fuerza|pesas|sentadilla|press|peso muerto/.test(text)) sports.add("gym");
  if (/peso|grasa|kg/.test(text) && !/km|kilometro/.test(text)) sports.add("body");
  if (/recuper|sueno|hrv|dolor/.test(text)) sports.add("recovery");

  const kmMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(km|kilometro|kilometros)/);
  if (kmMatch) {
    target = num(kmMatch[1]);
    metricKey = "distanceKm";
    unit = "km";
    measurable = true;
    type = text.includes("ruta") || text.includes("triat") || isSingleEffort ? "event" : "volume";
  }

  const sessionMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(sesion|sesiones|entreno|entrenos)/);
  if (sessionMatch) {
    target = num(sessionMatch[1]);
    metricKey = "sessions";
    unit = "sesiones";
    measurable = true;
    type = "habit";
  }

  const kgMatch = text.match(/(?:bajar|subir|llegar|peso).*?(\d+(?:[.,]\d+)?)\s*kg/);
  if (kgMatch) {
    target = num(kgMatch[1]);
    metricKey = "weightKg";
    unit = "kg";
    measurable = true;
    type = "body";
  }

  if (/mes|mensual/.test(text)) period = "month";
  if (/semana|semanal/.test(text)) period = "week";

  if (!sports.size) sports.add("running");
  if (!unit) unit = metricKey === "custom" ? "%" : metricLabels[metricKey];

  const deadline = inferDeadlineFromContext(prompt);
  const title = prompt.trim() || "Nueva meta flexible";
  const nextSports = Array.from(sports);

  return {
    ...emptyForm,
    prompt,
    title,
    description: `Objetivo creado desde: "${prompt.trim()}". Ajusta los campos si la lectura no coincide.`,
    sports: nextSports,
    type,
    deadline,
    measurable,
    metricKey,
    current: 0,
    target,
    unit,
    period,
    auto: measurable && metricKey !== "custom",
    milestonesText: buildMilestoneText(title, nextSports, deadline, measurable ? target : undefined, measurable ? unit : undefined),
  };
}

function normalizeMilestones(raw: unknown, fallbackText: string, deadline: string): GoalMilestone[] {
  if (Array.isArray(raw)) {
    return raw.map((item, index) => {
      const value = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      return {
        id: String(value.id || `ms-${index}-${Date.now()}`),
        title: String(value.title || value.name || `Hito ${index + 1}`),
        targetDate: String(value.targetDate || value.deadline || deadline).slice(0, 10),
        completed: Boolean(value.completed),
        sport: value.sport as SportScope | undefined,
        metricTarget: value.metricTarget === undefined ? undefined : num(value.metricTarget),
        unit: value.unit ? String(value.unit) : undefined,
      };
    });
  }

  return fallbackText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((title, index) => ({
      id: `ms-${Date.now()}-${index}`,
      title,
      targetDate: addDays((index + 1) * Math.max(14, Math.round(daysTo(deadline) / 4))),
      completed: false,
    }));
}

function normalizeGoal(item: Record<string, unknown>): Goal {
  const now = new Date().toISOString();
  const legacyCategory = String(item.category || "running") as SportScope;
  const sports = Array.isArray(item.sports) && item.sports.length
    ? item.sports.filter((sport): sport is SportScope => typeof sport === "string" && sport in sportMeta)
    : [legacyCategory in sportMeta ? legacyCategory : "running"];
  const title = String(item.title || item.name || "Meta sin nombre");
  const deadline = String(item.deadline || item.date || todayISO()).slice(0, 10);
  const legacyTarget = num(item.target) || 100;
  const metricRaw = item.metric && typeof item.metric === "object" ? (item.metric as Record<string, unknown>) : null;
  const metric = metricRaw || item.target !== undefined
    ? {
        key: String(metricRaw?.key || "custom") as MetricKey,
        current: num(metricRaw?.current ?? item.current),
        target: num(metricRaw?.target ?? legacyTarget) || legacyTarget,
        unit: String(metricRaw?.unit ?? item.unit ?? "%"),
        period: String(metricRaw?.period || "total") as GoalMetric["period"],
        auto: Boolean(metricRaw?.auto ?? false),
      }
    : undefined;
  const measurable = Boolean(item.measurable ?? metric);
  const milestones = normalizeMilestones(item.milestones, buildMilestoneText(title, sports, deadline, metric?.target, metric?.unit), deadline);
  const completed = measurable && metric ? metric.current >= metric.target : milestones.length > 0 && milestones.every((milestone) => milestone.completed);

  return {
    id: String(item.id || `goal-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    title,
    prompt: String(item.prompt || item.name || title),
    description: String(item.description || item.desc || ""),
    sports,
    type: String(item.type || item.kind || (measurable ? "volume" : "custom")) as GoalType,
    deadline,
    measurable,
    metric,
    milestones,
    status: completed ? "completed" : String(item.status || "active") as GoalStatus,
    createdAt: String(item.createdAt || item.ts || now),
    updatedAt: String(item.updatedAt || now),
  };
}

function autoMetricCurrent(goal: Goal, signals: TrainingSignals) {
  if (!goal.metric?.auto) return goal.metric?.current || 0;
  if (goal.metric.key === "distanceKm") {
    if (goal.type === "event") {
      const running = goal.sports.includes("running") ? signals.runningMaxKm : 0;
      const cycling = goal.sports.includes("cycling") ? signals.cyclingMaxKm : 0;
      return Math.max(running, cycling);
    }
    const running = goal.sports.includes("running") ? (goal.metric.period === "month" ? signals.runningKmMonth : signals.runningKmTotal) : 0;
    const cycling = goal.sports.includes("cycling") ? (goal.metric.period === "month" ? signals.cyclingKmMonth : signals.cyclingKmTotal) : 0;
    return running + cycling;
  }
  if (goal.metric.key === "sessions") {
    const gym = goal.sports.includes("gym") ? (goal.metric.period === "month" ? signals.gymSessionsMonth : signals.gymSessionsTotal) : 0;
    return gym;
  }
  if (goal.metric.key === "weightKg") return signals.latestWeight || goal.metric.current;
  return goal.metric.current;
}

function goalProgress(goal: Goal, signals: TrainingSignals) {
  if (goal.measurable && goal.metric?.target) {
    const current = autoMetricCurrent(goal, signals);
    if (goal.metric.key === "weightKg") {
      const start = goal.metric.current || current || goal.metric.target;
      const distance = Math.abs(start - goal.metric.target);
      const covered = Math.abs(start - current);
      return distance ? Math.max(0, Math.min(100, Math.round((covered / distance) * 100))) : 0;
    }
    return Math.max(0, Math.min(100, Math.round((current / goal.metric.target) * 100)));
  }
  if (!goal.milestones.length) return 0;
  return Math.round((goal.milestones.filter((item) => item.completed).length / goal.milestones.length) * 100);
}

function deadlineLabel(goal: Goal) {
  const days = daysTo(goal.deadline);
  if (days < 0) return `${Math.abs(days)} dias vencida`;
  if (days === 0) return "Vence hoy";
  if (days === 1) return "Vence manana";
  return `${days} dias`;
}

function linkedExercises(goal: Goal, signals: TrainingSignals) {
  const text = normalizeText(`${goal.title} ${goal.description}`);
  const recommended = new Set<string>();

  if (goal.sports.includes("cycling") || text.includes("ruta")) {
    recommended.add("Hip thrust");
    recommended.add("Peso muerto rumano");
    recommended.add("Prensa de piernas");
    recommended.add("Core anti-rotacion");
  }
  if (goal.sports.includes("running") || text.includes("10k") || text.includes("maraton")) {
    recommended.add("Sentadilla bulgara");
    recommended.add("Zancadas walking");
    recommended.add("Elevacion talones");
    recommended.add("Plancha toque de hombros");
  }
  if (goal.sports.includes("swim") || text.includes("triat")) {
    recommended.add("Face pulls");
    recommended.add("Rotacion externa hombro");
    recommended.add("Remo polea baja");
  }
  if (goal.sports.includes("gym") || goal.type === "strength") {
    recommended.add("Press banca");
    recommended.add("Jalon al pecho");
    recommended.add("Curl femoral");
  }
  if (signals.exerciseNames.length) {
    signals.exerciseNames
      .filter((name) => Array.from(recommended).some((item) => normalizeText(name).includes(normalizeText(item).split(" ")[0])))
      .forEach((name) => recommended.add(name));
  }

  return Array.from(recommended).slice(0, 6);
}

function aiRecommendation(goal: Goal, signals: TrainingSignals) {
  const pct = goalProgress(goal, signals);
  const days = Math.max(1, daysTo(goal.deadline));
  const current = goal.metric ? autoMetricCurrent(goal, signals) : 0;

  if (goal.type === "event" && goal.metric?.key === "distanceKm") {
    const remaining = Math.max(0, goal.metric.target - current);
    return `Evento puntual: el progreso se compara contra tu recorrido mas largo registrado. Faltan ${remaining.toFixed(1)} ${goal.metric.unit} para simular la distancia objetivo; prioriza fondos progresivos, nutricion, cadencia y fuerza de piernas/core.`;
  }
  if (goal.metric?.key === "distanceKm") {
    const remaining = Math.max(0, goal.metric.target - current);
    const weekly = remaining / Math.max(1, days / 7);
    return `Faltan ${remaining.toFixed(1)} ${goal.metric.unit}. Ritmo sugerido: ${weekly.toFixed(1)} ${goal.metric.unit}/semana, cruzando fondo, tecnica y fuerza especifica.`;
  }
  if (goal.type === "event") {
    return `Meta de evento al ${pct}%. Trabaja por hitos: base, bloque especifico, simulacion y descarga. Las sesiones de fuerza deben proteger los grupos que mas intervienen.`;
  }
  if (goal.type === "body") {
    return "Cruza peso, fuerza y recuperacion: ajusta el deficit sin sacrificar sesiones clave ni cargas basicas.";
  }
  if (goal.type === "habit") {
    return "Convierte la meta en frecuencia semanal. La consistencia pesa mas que una semana heroica.";
  }
  return "Mantiene una accion principal para esta semana y evita sumar objetivos que compitan por la misma recuperacion.";
}

function formToGoal(form: GoalForm, existing?: Goal): Goal {
  const now = new Date().toISOString();
  const metric = form.measurable
    ? {
        key: form.metricKey,
        current: num(form.current),
        target: Math.max(0.1, num(form.target)),
        unit: form.unit.trim() || metricLabels[form.metricKey],
        period: form.period,
        auto: form.auto,
      }
    : undefined;

  return {
    id: existing?.id || `goal-${Date.now()}`,
    title: form.title.trim(),
    prompt: form.prompt.trim() || form.title.trim(),
    description: form.description.trim(),
    sports: form.sports.length ? form.sports : ["running"],
    type: form.type,
    deadline: form.deadline,
    measurable: form.measurable,
    metric,
    milestones: normalizeMilestones(undefined, form.milestonesText, form.deadline),
    status: existing?.status || "active",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
}

function goalToForm(goal: Goal): GoalForm {
  return {
    prompt: goal.prompt,
    title: goal.title,
    description: goal.description,
    sports: goal.sports,
    type: goal.type,
    deadline: goal.deadline,
    measurable: goal.measurable,
    metricKey: goal.metric?.key || "custom",
    current: goal.metric?.current || 0,
    target: goal.metric?.target || 100,
    unit: goal.metric?.unit || "%",
    period: goal.metric?.period || "total",
    auto: goal.metric?.auto ?? false,
    milestonesText: goal.milestones.map((item) => item.title).join("\n"),
  };
}

export default function GoalsModule() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [form, setForm] = useState<GoalForm>(emptyForm);
  const [editingId, setEditingId] = useState("");
  const [analysisReady, setAnalysisReady] = useState(false);
  const [status, setStatus] = useState("");
  const [signals, setSignals] = useState<TrainingSignals>(emptySignals);

  useEffect(() => {
    let alive = true;
    window.setTimeout(() => {
      const local = readJSON<Array<Record<string, unknown>>>(GOALS_KEY, readJSON(LEGACY_GOALS_KEY, []));
      const normalized = local.map(normalizeGoal);
      if (alive) {
        setGoals(normalized);
        setSignals(loadTrainingSignals());
      }
    }, 0);
    getCloudCollection<Goal>("/goals", "goals")
      .then((cloudGoals) => {
        if (!alive || !cloudGoals.length) return;
        const cloud = cloudGoals.map((item) => normalizeGoal(item as unknown as Record<string, unknown>));
        setGoals(cloud);
        localStorage.setItem(GOALS_KEY, JSON.stringify(cloud));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const activeGoals = goals.filter((goal) => goal.status !== "completed");
  const completedGoals = goals.filter((goal) => goal.status === "completed");
  const avgProgress = goals.length ? Math.round(goals.reduce((sum, goal) => sum + goalProgress(goal, signals), 0) / goals.length) : 0;
  const atRisk = activeGoals.filter((goal) => daysTo(goal.deadline) < 0 || goalProgress(goal, signals) < 35 && daysTo(goal.deadline) < 21);

  const saveGoals = (next: Goal[], message = "Metas actualizadas.") => {
    const synced = next.map((goal) => {
      const pct = goalProgress(goal, signals);
      return {
        ...goal,
        status: pct >= 100 ? "completed" as const : goal.status === "paused" ? "paused" as const : daysTo(goal.deadline) < 0 ? "at_risk" as const : "active" as const,
      };
    }).sort((a, b) => daysTo(a.deadline) - daysTo(b.deadline));
    setGoals(synced);
    localStorage.setItem(GOALS_KEY, JSON.stringify(synced));
    saveCloudCollection("/goals", "goals", synced).catch(() => undefined);
    setStatus(message);
  };

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId("");
    setAnalysisReady(false);
  };

  const analyzePrompt = () => {
    if (!form.prompt.trim()) {
      setStatus("Escribe la meta en lenguaje libre para analizarla.");
      return;
    }
    setForm(inferGoalFromPrompt(form.prompt));
    setAnalysisReady(true);
    setStatus("Meta interpretada. Puedes guardarla o ajustar los detalles.");
  };

  const openNewGoal = () => {
    setForm(emptyForm);
    setEditingId("");
    setAnalysisReady(false);
  };

  const toggleSport = (sport: SportScope) => {
    setForm((current) => {
      const exists = current.sports.includes(sport);
      const sports = exists ? current.sports.filter((item) => item !== sport) : [...current.sports, sport];
      return { ...current, sports };
    });
  };

  const submitGoal = () => {
    if (!form.title.trim()) {
      setStatus("Escribe un titulo para la meta.");
      return;
    }
    if (form.measurable && (!form.target || form.target <= 0)) {
      setStatus("La meta medible necesita un objetivo mayor a cero.");
      return;
    }
    const existing = goals.find((goal) => goal.id === editingId);
    const payload = formToGoal(form, existing);
    const next = existing ? goals.map((goal) => goal.id === existing.id ? payload : goal) : [payload, ...goals];
    saveGoals(next, existing ? "Meta editada." : "Meta flexible creada.");
    resetForm();
  };

  const editGoal = (goal: Goal) => {
    setForm(goalToForm(goal));
    setEditingId(goal.id);
    setAnalysisReady(true);
  };

  const updateGoalCurrent = (goal: Goal, current: number) => {
    const next = goals.map((item) =>
      item.id === goal.id && item.metric
        ? { ...item, metric: { ...item.metric, current, auto: false }, updatedAt: new Date().toISOString() }
        : item,
    );
    saveGoals(next, "Progreso manual guardado.");
  };

  const toggleMilestone = (goal: Goal, milestoneId: string) => {
    const next = goals.map((item) =>
      item.id === goal.id
        ? {
            ...item,
            milestones: item.milestones.map((milestone) => milestone.id === milestoneId ? { ...milestone, completed: !milestone.completed } : milestone),
            updatedAt: new Date().toISOString(),
          }
        : item,
    );
    saveGoals(next, "Hito actualizado.");
  };

  const deleteGoal = (goal: Goal) => {
    saveGoals(goals.filter((item) => item.id !== goal.id), "Meta eliminada.");
  };

  const draftGoal = analysisReady && form.title.trim() ? formToGoal(form, goals.find((goal) => goal.id === editingId)) : null;
  const draftProgress = draftGoal ? goalProgress(draftGoal, signals) : 0;
  const draftCurrent = draftGoal?.metric ? autoMetricCurrent(draftGoal, signals) : 0;
  const draftExercises = draftGoal ? linkedExercises(draftGoal, signals) : [];

  return (
    <>
      <TopNav title="Metas" />
      <main className="min-h-0 flex-1 overflow-y-auto bg-[#F8FAFC] p-4 text-[#0F172A] lg:p-6" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-bold text-slate-500">Objetivos libres, medibles cuando se pueda, cruzados con entrenamiento</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-900">Metas inteligentes</h1>
          </div>
          <button className="inline-flex h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-black text-white" type="button" onClick={openNewGoal}>
            <AppIcon name="goals" className="h-4 w-4" />
            Nueva meta
          </button>
        </div>

        {status ? <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">{status}</div> : null}

        <section className="mb-5 rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-blue-600">Diligenciar meta</p>
              <h2 className="mt-1 text-2xl font-black text-slate-900">{editingId ? "Editar meta" : "Nueva meta"}</h2>
            </div>
            <button className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-black text-slate-600" type="button" onClick={resetForm}>Limpiar</button>
          </div>

          <div className="mt-4 grid gap-4">
            <label className="grid gap-1 text-xs font-black uppercase text-slate-500">Meta planteada
              <textarea
                className="min-h-24 resize-none rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold normal-case text-slate-900 outline-none focus:border-blue-400"
                placeholder="Ej: hacer 200 km en un solo recorrido antes del 30 de junio 2026"
                value={form.prompt}
                onChange={(event) => {
                  setForm({ ...form, prompt: event.target.value });
                  setAnalysisReady(false);
                }}
              />
            </label>

            <div className="grid gap-3 lg:grid-cols-2">
              <label className="grid gap-1 text-xs font-black uppercase text-slate-500">Titulo
                <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold normal-case text-slate-900 outline-none focus:border-blue-400" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
              </label>
              <label className="grid gap-1 text-xs font-black uppercase text-slate-500">Tipo
                <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold normal-case text-slate-900 outline-none focus:border-blue-400" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as GoalType })}>
                  {(Object.keys(typeLabels) as GoalType[]).map((key) => <option key={key} value={key}>{typeLabels[key]}</option>)}
                </select>
              </label>
            </div>

            <div>
              <p className="text-xs font-black uppercase text-slate-500">Deportes</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {(Object.keys(sportMeta) as SportScope[]).map((sport) => (
                  <button
                    className={`rounded-lg border px-3 py-2 text-xs font-black ${form.sports.includes(sport) ? sportMeta[sport].soft : "border-slate-200 bg-white text-slate-500"}`}
                    type="button"
                    key={sport}
                    onClick={() => toggleSport(sport)}
                  >
                    {sportMeta[sport].label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-[180px_160px_minmax(0,1fr)]">
              <label className="grid gap-1 text-xs font-black uppercase text-slate-500">Fecha limite
                <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold normal-case text-slate-900 outline-none focus:border-blue-400" type="date" value={form.deadline} onChange={(event) => setForm({ ...form, deadline: event.target.value })} />
              </label>
              <label className="flex items-center gap-2 self-end rounded-lg border border-slate-200 px-3 py-2 text-sm font-black text-slate-700">
                <input type="checkbox" checked={form.measurable} onChange={(event) => setForm({ ...form, measurable: event.target.checked })} />
                Meta medible
              </label>
              <label className="flex items-center gap-2 self-end rounded-lg border border-slate-200 px-3 py-2 text-sm font-black text-slate-700">
                <input type="checkbox" checked={form.auto} disabled={!form.measurable} onChange={(event) => setForm({ ...form, auto: event.target.checked })} />
                Progreso automatico desde actividades
              </label>
            </div>

            {form.measurable ? (
              <div className="grid gap-3 lg:grid-cols-5">
                <label className="grid gap-1 text-xs font-black uppercase text-slate-500">Metrica
                  <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold normal-case text-slate-900 outline-none focus:border-blue-400" value={form.metricKey} onChange={(event) => setForm({ ...form, metricKey: event.target.value as MetricKey })}>
                    {(Object.keys(metricLabels) as MetricKey[]).map((key) => <option key={key} value={key}>{metricLabels[key]}</option>)}
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-black uppercase text-slate-500">Actual
                  <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold normal-case text-slate-900 outline-none focus:border-blue-400" type="number" value={form.current} onChange={(event) => setForm({ ...form, current: num(event.target.value) })} />
                </label>
                <label className="grid gap-1 text-xs font-black uppercase text-slate-500">Objetivo
                  <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold normal-case text-slate-900 outline-none focus:border-blue-400" type="number" value={form.target} onChange={(event) => setForm({ ...form, target: num(event.target.value) })} />
                </label>
                <label className="grid gap-1 text-xs font-black uppercase text-slate-500">Unidad
                  <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold normal-case text-slate-900 outline-none focus:border-blue-400" value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} />
                </label>
                <label className="grid gap-1 text-xs font-black uppercase text-slate-500">Periodo
                  <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold normal-case text-slate-900 outline-none focus:border-blue-400" value={form.period} onChange={(event) => setForm({ ...form, period: event.target.value as GoalMetric["period"] })}>
                    <option value="total">Total</option>
                    <option value="week">Semana</option>
                    <option value="month">Mes</option>
                  </select>
                </label>
              </div>
            ) : null}

            <div className="grid gap-3 lg:grid-cols-2">
              <label className="grid gap-1 text-xs font-black uppercase text-slate-500">Hitos
                <textarea className="min-h-24 resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold normal-case text-slate-900 outline-none focus:border-blue-400" value={form.milestonesText} onChange={(event) => setForm({ ...form, milestonesText: event.target.value })} />
              </label>
              <label className="grid gap-1 text-xs font-black uppercase text-slate-500">Descripcion
                <textarea className="min-h-24 resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold normal-case text-slate-900 outline-none focus:border-blue-400" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <button className="rounded-lg bg-slate-900 px-4 py-3 text-sm font-black text-white" type="button" onClick={analyzePrompt}>Analizar meta</button>
              <button className="rounded-lg bg-blue-600 px-4 py-3 text-sm font-black text-white" type="button" onClick={submitGoal}>{editingId ? "Guardar cambios" : "Guardar meta"}</button>
            </div>
          </div>

          {draftGoal ? (
            <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-blue-600">Analisis de la meta</p>
                  <h3 className="mt-1 text-lg font-black text-slate-900">{draftGoal.title}</h3>
                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{aiRecommendation(draftGoal, signals)}</p>
                </div>
                <button className="rounded-lg bg-blue-600 px-4 py-3 text-sm font-black text-white" type="button" onClick={submitGoal}>Guardar meta</button>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-4">
                <div className="rounded-lg bg-white p-3">
                  <p className="text-[10px] font-black uppercase text-slate-500">Lectura</p>
                  <p className="mt-1 text-sm font-black text-slate-900">{typeLabels[draftGoal.type]}</p>
                </div>
                <div className="rounded-lg bg-white p-3">
                  <p className="text-[10px] font-black uppercase text-slate-500">Fecha objetivo</p>
                  <p className="mt-1 text-sm font-black text-slate-900">{draftGoal.deadline}</p>
                </div>
                <div className="rounded-lg bg-white p-3">
                  <p className="text-[10px] font-black uppercase text-slate-500">Progreso</p>
                  <p className="mt-1 text-sm font-black text-slate-900">{draftGoal.metric ? `${draftCurrent.toFixed(1)} / ${draftGoal.metric.target} ${draftGoal.metric.unit}` : `${draftProgress}% por hitos`}</p>
                </div>
                <div className="rounded-lg bg-white p-3">
                  <p className="text-[10px] font-black uppercase text-slate-500">Deportes</p>
                  <p className="mt-1 text-sm font-black text-slate-900">{draftGoal.sports.map((sport) => sportMeta[sport].label).join(", ")}</p>
                </div>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="rounded-lg bg-white p-3">
                  <p className="text-[10px] font-black uppercase text-slate-500">Hitos sugeridos</p>
                  <div className="mt-2 grid gap-1">
                    {draftGoal.milestones.slice(0, 3).map((milestone) => (
                      <p className="text-xs font-bold leading-5 text-slate-600" key={milestone.title}>{milestone.title}</p>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg bg-white p-3">
                  <p className="text-[10px] font-black uppercase text-slate-500">Datos reales y ejercicios</p>
                  <p className="mb-2 text-xs font-bold leading-5 text-slate-500">
                    {draftGoal.metric?.auto ? `Dato base: ${draftGoal.type === "event" ? "mejor recorrido registrado" : "actividades registradas"} (${draftCurrent.toFixed(1)} ${draftGoal.metric.unit}).` : "Sin lectura automatica; progreso manual o por hitos."}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {draftExercises.length ? draftExercises.map((exercise) => (
                      <span className="rounded-full bg-slate-50 px-2 py-1 text-[11px] font-black text-slate-600 ring-1 ring-slate-200" key={exercise}>{exercise}</span>
                    )) : <span className="text-xs font-bold text-slate-400">Sin ejercicios asociados aun</span>}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="mt-5 grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-[10px] font-black uppercase text-slate-500">Activas</p>
              <p className="mt-1 text-xl font-black text-slate-900">{activeGoals.length}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-[10px] font-black uppercase text-slate-500">Avance medio</p>
              <p className="mt-1 text-xl font-black text-slate-900">{avgProgress}%</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-[10px] font-black uppercase text-slate-500">En riesgo</p>
              <p className="mt-1 text-xl font-black text-slate-900">{atRisk.length}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-[10px] font-black uppercase text-slate-500">Completadas</p>
              <p className="mt-1 text-xl font-black text-slate-900">{completedGoals.length}</p>
            </div>
          </div>
        </section>

        <div className="grid gap-5">
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-black text-slate-900">Metas activas</h2>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-500">{goals.length}</span>
            </div>

            <div className="mt-4 grid gap-3">
              {goals.length ? goals.map((goal) => {
                const pct = goalProgress(goal, signals);
                const firstSport = goal.sports[0] || "running";
                const metricCurrent = goal.metric ? autoMetricCurrent(goal, signals) : 0;
                const exercises = linkedExercises(goal, signals);
                return (
                  <article className="rounded-lg border border-slate-200 bg-white p-4" key={goal.id}>
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {goal.sports.map((sport) => (
                            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black ${sportMeta[sport].soft}`} key={sport}>
                              <AppIcon name={sportMeta[sport].icon} className="h-3.5 w-3.5" />
                              {sportMeta[sport].label}
                            </span>
                          ))}
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-600">{typeLabels[goal.type]}</span>
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${goal.status === "completed" ? "bg-emerald-50 text-emerald-700" : goal.status === "at_risk" ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600"}`}>
                            {goal.status === "completed" ? "Completada" : deadlineLabel(goal)}
                          </span>
                        </div>
                        <h3 className="mt-2 text-base font-black text-slate-900">{goal.title}</h3>
                        {goal.description ? <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{goal.description}</p> : null}
                        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100">
                          <div className={`h-full rounded-full ${sportMeta[firstSport].bar}`} style={{ width: `${pct}%` }} />
                        </div>
                        <p className="mt-2 text-xs font-black text-slate-700">{aiRecommendation(goal, signals)}</p>
                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                          <div className="rounded-lg bg-slate-50 p-3">
                            <p className="text-[10px] font-black uppercase text-slate-500">Hitos</p>
                            <div className="mt-2 grid gap-1">
                              {goal.milestones.slice(0, 3).map((milestone) => (
                                <button className="flex items-center gap-2 text-left text-xs font-bold text-slate-600" type="button" key={milestone.id} onClick={() => toggleMilestone(goal, milestone.id)}>
                                  <span className={`grid h-4 w-4 place-items-center rounded border ${milestone.completed ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 bg-white"}`}>{milestone.completed ? "✓" : ""}</span>
                                  <span>{milestone.title}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="rounded-lg bg-slate-50 p-3">
                            <p className="text-[10px] font-black uppercase text-slate-500">Ejercicios que intervienen</p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {exercises.length ? exercises.map((exercise) => (
                                <span className="rounded-full bg-white px-2 py-1 text-[11px] font-black text-slate-600 ring-1 ring-slate-200" key={exercise}>{exercise}</span>
                              )) : <span className="text-xs font-bold text-slate-400">Sin ejercicios asociados aun</span>}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="grid gap-3 content-start">
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <p className="text-xs font-black text-slate-900">{pct}% completado</p>
                          {goal.metric ? (
                            <>
                              <div className="mt-2 flex items-center gap-2">
                                <input
                                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm font-bold text-slate-900 outline-none focus:border-blue-400"
                                  type="number"
                                  value={goal.metric.auto ? Number(metricCurrent.toFixed(1)) : goal.metric.current}
                                  disabled={goal.metric.auto}
                                  onChange={(event) => updateGoalCurrent(goal, num(event.target.value))}
                                />
                                <span className="text-xs font-black text-slate-400">{goal.metric.unit}</span>
                              </div>
                              <p className="mt-1 text-[11px] font-bold text-slate-400">
                                Meta {goal.metric.target} {goal.metric.unit} {goal.metric.period === "month" ? "al mes" : goal.metric.period === "week" ? "por semana" : "total"}
                              </p>
                              {goal.metric.auto ? <p className="mt-1 text-[11px] font-black text-blue-600">Progreso automatico</p> : null}
                            </>
                          ) : (
                            <p className="mt-2 text-xs font-bold text-slate-500">Progreso por hitos</p>
                          )}
                        </div>
                        <button className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700" type="button" onClick={() => editGoal(goal)}>Editar</button>
                        <button className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-600" type="button" onClick={() => deleteGoal(goal)}>Eliminar</button>
                      </div>
                    </div>
                  </article>
                );
              }) : (
                <div className="grid min-h-[260px] place-items-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-center">
                  <div className="max-w-sm">
                    <h3 className="text-xl font-black text-slate-900">Sin metas registradas</h3>
                    <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">Crea una meta libre para que el sistema la convierta en deportes, metricas, hitos y ejercicios.</p>
                    <button className="mt-4 rounded-lg bg-blue-600 px-4 py-3 text-sm font-black text-white" type="button" onClick={openNewGoal}>Crear primera meta</button>
                  </div>
                </div>
              )}
            </div>
          </section>

        </div>
      </main>
    </>
  );
}
