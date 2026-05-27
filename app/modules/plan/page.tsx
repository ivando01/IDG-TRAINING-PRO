"use client";

import { AppIcon, AppIconName } from "@/components/Brand";
import TopNav from "@/components/TopNav";
import { canSyncCloud, getCloudCollection, loadCloudBackedCollection, saveCloudBackedCollection } from "@/lib/cloud-sync";
import { cardioTrimpFromZones } from "@/lib/training-load";
import { useEffect, useMemo, useState } from "react";

type SessionType = "gym" | "running" | "cycling" | "mobility" | "rest";
type PlanStatus = "planned" | "completed" | "moved" | "skipped";

type PlannedSession = {
  id: string;
  date: string;
  type: SessionType;
  title: string;
  gymRoutine?: string;
  objective: string;
  duration: number;
  targetZone: string;
  notes: string;
  status: PlanStatus;
};

type RealSession = {
  id: string;
  date: string;
  type: "gym" | "running" | "cycling";
  title: string;
  duration: number;
  load: number;
};

type GymTemplate = {
  id: string;
  name: string;
  focus?: string;
  exercises?: unknown[];
  updatedAt?: number;
};

const PLAN_KEY = "idg_weekly_plan_json";
const PROFILE_KEY = "idg_profile_json";
const GYM_TEMPLATES_KEY = "idg_gym_templates_json";
const MAX_PLAN_SUPPORT_CACHE_BYTES = 750_000;

const gymRoutines = [
  "Dia 1 - Cuadriceps + Pantorrilla",
  "Dia 2 - Isquios + Gluteo",
  "Dia 3 - Espalda + Antebrazo",
  "Dia 4 - Pecho + Hombro",
  "Dia 5 - Biceps + Triceps",
  "WOD Ranger",
  "Personalizado",
];

const objectives: Record<SessionType, string[]> = {
  gym: ["Rutina base", "Fuerza controlada", "Hipertrofia", "Tecnica + movilidad"],
  running: ["Z2 quema grasa", "Fondo suave", "Z3 aerobico", "Intervalos", "Recuperacion"],
  cycling: ["Z2 quema grasa", "Fondo", "Z3 aerobico", "Subidas", "Recuperacion"],
  mobility: ["Movilidad general", "Hombro + espalda", "Cadera + tobillo", "Core suave"],
  rest: ["Descanso total", "Descanso activo"],
};

const typeMeta: Record<SessionType, { label: string; icon: AppIconName; color: string; soft: string }> = {
  gym: { label: "Gym", icon: "gym", color: "bg-blue-600", soft: "bg-blue-50 text-blue-700 border-blue-100" },
  running: { label: "Running", icon: "running", color: "bg-emerald-500", soft: "bg-emerald-50 text-emerald-700 border-emerald-100" },
  cycling: { label: "Ciclismo", icon: "cycling", color: "bg-slate-800", soft: "bg-slate-100 text-slate-800 border-slate-200" },
  mobility: { label: "Movilidad", icon: "heartZones", color: "bg-amber-500", soft: "bg-amber-50 text-amber-700 border-amber-100" },
  rest: { label: "Descanso", icon: "calendar", color: "bg-slate-400", soft: "bg-slate-50 text-slate-600 border-slate-200" },
};

function readJSON<T>(key: string, fallback: T): T {
  try {
    if (typeof window === "undefined") return fallback;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function readSupportJSON<T>(key: string, fallback: T): T {
  try {
    if (typeof window === "undefined") return fallback;
    const raw = localStorage.getItem(key);
    if (!raw || raw.length > MAX_PLAN_SUPPORT_CACHE_BYTES) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function makeId(prefix = "plan") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function num(value: unknown) {
  const parsed = Number(String(value || "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function startOfWeek(date = new Date()) {
  const next = new Date(date);
  next.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  next.setHours(0, 0, 0, 0);
  return next;
}

function isoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDate(dateText: string) {
  const [year, month, day] = String(dateText || isoDate()).slice(0, 10).split("-").map(Number);
  return new Date(year || new Date().getFullYear(), (month || 1) - 1, day || 1);
}

function weekKey(date: Date) {
  return isoDate(startOfWeek(date));
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatWeekRange(start: Date) {
  const end = addDays(start, 6);
  const a = start.toLocaleDateString("es-CO", { day: "2-digit", month: "short" }).replace(".", "");
  const b = end.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" }).replace(".", "");
  return `${a} - ${b}`;
}

function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function minutesFromActivity(activity: Record<string, unknown>) {
  return Math.round(num((activity.metrics as Record<string, unknown> | undefined)?.durationSec) / 60);
}

function cardioLoad(activity: Record<string, unknown>, fallbackIntensity = 140) {
  const metrics = (activity.metrics || {}) as Record<string, unknown>;
  const trimp = cardioTrimpFromZones(activity.zoneTotals);
  if (trimp) return Math.round(trimp);
  return Math.round((num(metrics.durationSec) / 60) * ((num(metrics.avgHr) || fallbackIntensity) / fallbackIntensity));
}

function zoneFactor(targetZone: string) {
  const match = String(targetZone || "").match(/z\s*(\d)/i);
  return match ? Number(match[1]) || 1 : 1;
}

function plannedLoadForSession(session: PlannedSession) {
  if (session.type === "rest") return 0;
  if (session.type === "mobility") return session.duration * 1;
  if (session.type === "gym") return session.duration * 7;
  return session.duration * zoneFactor(session.targetZone || session.objective);
}

function activityDate(item: Record<string, unknown>) {
  return String(item.date || item.startTime || item.start_date || item.startDate || item.activity_date || "").slice(0, 10);
}

function isTrainingActivity(item: Record<string, unknown>) {
  if (item.countsTowardTraining === false || item.activityKind === "support") return false;
  const text = `${String(item.activitySubType || "")} ${String(item.name || "")}`.toLowerCase();
  return !/walk|hike|caminar|caminata|senderismo/.test(text);
}

function getRealSessions(): RealSession[] {
  const gym = readSupportJSON<Array<Record<string, unknown>>>("idg_gym_sessions_json", []);
  const running = readSupportJSON<Array<Record<string, unknown>>>("idg_running_activities_json", []).filter(isTrainingActivity);
  const cycling = readSupportJSON<Array<Record<string, unknown>>>("idg_cycling_activities_json", []);

  const gymSessions = gym.map((item) => ({
    id: String(item.id || makeId("real-gym")),
    date: String(item.date || "").slice(0, 10),
    type: "gym" as const,
    title: String(item.routineName || "Gym"),
    duration: num(item.duration),
    load: Math.round(num(item.duration) * (num(item.intensity) || 6)),
  }));

  const runSessions = running.map((item) => {
    const metrics = (item.metrics || {}) as Record<string, unknown>;
    return {
      id: String(item.id || makeId("real-run")),
      date: activityDate(item),
      type: "running" as const,
      title: String(item.name || "Running"),
      duration: minutesFromActivity(item),
      load: cardioLoad(item, 150),
    };
  });

  const bikeSessions = cycling.map((item) => {
    const metrics = (item.metrics || {}) as Record<string, unknown>;
    return {
      id: String(item.id || makeId("real-bike")),
      date: activityDate(item),
      type: "cycling" as const,
      title: String(item.name || "Ciclismo"),
      duration: minutesFromActivity(item),
      load: Math.round(cardioTrimpFromZones(item.zoneTotals) || num(metrics.tss) || cardioLoad(item, 145)),
    };
  });

  return [...gymSessions, ...runSessions, ...bikeSessions].filter((item) => item.date);
}

function defaultTitle(type: SessionType, gymRoutine: string, objective: string) {
  if (type === "gym") return gymRoutine;
  if (type === "rest") return "Descanso";
  if (type === "mobility") return "Movilidad";
  return objective;
}

function normalizePlanSession(item: Partial<PlannedSession>): PlannedSession | null {
  const type = (["gym", "running", "cycling", "mobility", "rest"] as SessionType[]).includes(item.type as SessionType) ? item.type as SessionType : "gym";
  const date = String(item.date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const objective = String(item.objective || objectives[type][0] || "Sesion");
  const gymRoutine = type === "gym" ? String(item.gymRoutine || item.title || gymRoutines[0]) : undefined;
  return {
    id: String(item.id || makeId("plan-session")),
    date,
    type,
    title: String(item.title || defaultTitle(type, gymRoutine || "", objective)),
    gymRoutine,
    objective,
    duration: Math.max(0, num(item.duration)),
    targetZone: String(item.targetZone || (type === "gym" ? "RPE 7" : type === "rest" ? "" : "Z2")),
    notes: String(item.notes || ""),
    status: (["planned", "completed", "moved", "skipped"] as PlanStatus[]).includes(item.status as PlanStatus) ? item.status as PlanStatus : "planned",
  };
}

function normalizePlan(items: unknown) {
  const list = Array.isArray(items) ? items : [];
  return list
    .map((item) => normalizePlanSession(item))
    .filter((item): item is PlannedSession => Boolean(item))
    .sort((a, b) => `${a.date}-${a.type}`.localeCompare(`${b.date}-${b.type}`));
}

export default function PlanModule() {
  const [weekStart, setWeekStart] = useState(() => new Date(0));
  const [selectedDate, setSelectedDate] = useState("");
  const [sessions, setSessions] = useState<PlannedSession[]>([]);
  const [realSessions, setRealSessions] = useState<RealSession[]>([]);
  const [gymTemplates, setGymTemplates] = useState<GymTemplate[]>([]);
  const [proposedPlan, setProposedPlan] = useState<PlannedSession[] | null>(null);
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState("");
  const [draft, setDraft] = useState({
    type: "gym" as SessionType,
    gymRoutine: gymRoutines[0],
    objective: objectives.gym[0],
    duration: "75",
    targetZone: "Z2",
    notes: "",
  });
  const gymRoutineOptions = useMemo(() => {
    const customNames = gymTemplates.map((template) => template.name).filter(Boolean);
    return Array.from(new Set([...gymRoutines, ...customNames]));
  }, [gymTemplates]);

  useEffect(() => {
    let alive = true;
    const today = new Date();
    setWeekStart(startOfWeek(today));
    setSelectedDate(isoDate(today));
    setMounted(true);
    const localPlan = normalizePlan(readJSON<PlannedSession[]>(PLAN_KEY, []));
    const localTemplates = readJSON<GymTemplate[]>(GYM_TEMPLATES_KEY, []).filter((template) => template.name);
    setSessions(localPlan);
    setRealSessions(getRealSessions());
    setGymTemplates(localTemplates);

    if (!canSyncCloud()) {
      if (localPlan.length) setStatus("Plan cargado en este dispositivo. Inicia sesion para sincronizarlo en todos tus equipos.");
      return () => {
        alive = false;
      };
    }

    const loadCloudPlan = () => {
      if (!canSyncCloud()) return;
      getCloudCollection<GymTemplate>("/gym/templates", "templates")
        .then((templates) => {
          if (!alive || !templates.length) return;
          setGymTemplates(templates.filter((template) => template.name));
          localStorage.setItem(GYM_TEMPLATES_KEY, JSON.stringify(templates));
        })
        .catch(() => undefined);
      loadCloudBackedCollection<PlannedSession>({
        path: "/plan",
        key: "plan",
        cacheKey: PLAN_KEY,
        fallback: localPlan,
        onStatus: setStatus,
      })
        .then(({ items: cloudPlan }) => {
        if (!alive) return;
        const sortedPlan = normalizePlan(cloudPlan);
        setSessions(sortedPlan);
        localStorage.setItem(PLAN_KEY, JSON.stringify(sortedPlan));
      })
      .catch((error) => {
        if (!alive) return;
        setStatus(error instanceof Error ? error.message : "No se pudo sincronizar el plan semanal.");
      });
    };
    loadCloudPlan();
    const refreshOnFocus = () => loadCloudPlan();
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);
    return () => {
      alive = false;
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, []);

  const currentWeekKey = mounted ? weekKey(weekStart) : "";
  const weekDays = mounted ? Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)) : [];
  const visibleSessions = proposedPlan || sessions;
  const weekPlan = visibleSessions.filter((session) => weekKey(parseLocalDate(session.date)) === currentWeekKey);
  const weekReal = realSessions.filter((session) => weekKey(parseLocalDate(session.date)) === currentWeekKey);

  const completedIds = new Set(
    weekPlan
      .filter((planned) => weekReal.some((real) => real.date.slice(0, 10) === planned.date && real.type === planned.type))
      .map((planned) => planned.id),
  );

  const plannedLoad = weekPlan.reduce((sum, item) => sum + plannedLoadForSession(item), 0);
  const realLoad = weekReal.reduce((sum, item) => sum + item.load, 0);
  const plannedMinutes = weekPlan.reduce((sum, item) => sum + item.duration, 0);
  const completedCount = weekPlan.filter((item) => completedIds.has(item.id) || item.status === "completed").length;
  const completion = weekPlan.length ? Math.round((completedCount / weekPlan.length) * 100) : 0;

  const saveSessions = (next: PlannedSession[]) => {
    const sorted = normalizePlan(next);
    setSessions(sorted);
    setProposedPlan(null);
    saveCloudBackedCollection({ path: "/plan", key: "plan", cacheKey: PLAN_KEY, items: sorted, onStatus: setStatus });
    setRealSessions(getRealSessions());
  };

  const setDraftType = (type: SessionType) => {
    setDraft((current) => ({
      ...current,
      type,
      objective: objectives[type][0],
      duration: type === "gym" ? "75" : type === "cycling" ? "90" : type === "running" ? "45" : type === "mobility" ? "25" : "",
      targetZone: type === "rest" ? "" : type === "gym" ? "RPE 7" : "Z2",
    }));
  };

  const addSession = () => {
    const objective = draft.type === "gym" ? "Rutina base" : draft.objective;
    const nextSession: PlannedSession = {
      id: makeId("plan-session"),
      date: selectedDate,
      type: draft.type,
      title: defaultTitle(draft.type, draft.gymRoutine, objective),
      gymRoutine: draft.type === "gym" ? draft.gymRoutine : undefined,
      objective,
      duration: Math.max(0, Number(draft.duration) || 0),
      targetZone: draft.targetZone,
      notes: draft.notes,
      status: "planned",
    };
    saveSessions([...sessions, nextSession].sort((a, b) => `${a.date}-${a.type}`.localeCompare(`${b.date}-${b.type}`)));
    setStatus("Sesion agregada al plan semanal.");
  };

  const updateSessionStatus = (id: string, nextStatus: PlanStatus) => {
    saveSessions(sessions.map((session) => session.id === id ? { ...session, status: nextStatus } : session));
  };

  const deleteSession = (id: string) => {
    saveSessions(sessions.filter((session) => session.id !== id));
    setStatus("Sesion eliminada del plan.");
  };

  const buildGeneratedWeek = () => {
    const profile = readJSON<Record<string, unknown>>(PROFILE_KEY, {});
    const gymDays = Math.min(5, Math.max(0, num(profile.gymDaysPerWeek) || 4));
    const runDays = Math.min(4, Math.max(0, num(profile.runDaysPerWeek) || 2));
    const bikeDays = Math.min(4, Math.max(0, num(profile.bikeDaysPerWeek) || 2));
    const base = weekDays.map(isoDate);
    const generated: PlannedSession[] = [];

    for (let i = 0; i < gymDays; i += 1) {
      generated.push({
        id: makeId("plan-session"),
        date: base[[0, 1, 3, 4, 5][i] || i],
        type: "gym",
        title: gymRoutineOptions[i % Math.max(1, gymRoutineOptions.length)],
        gymRoutine: gymRoutineOptions[i % Math.max(1, gymRoutineOptions.length)],
        objective: "Rutina base",
        duration: 75,
        targetZone: "RPE 7",
        notes: "Mantener tecnica limpia y registrar pesos.",
        status: "planned",
      });
    }
    for (let i = 0; i < runDays; i += 1) {
      generated.push({
        id: makeId("plan-session"),
        date: base[[2, 6, 4, 1][i] || i],
        type: "running",
        title: i === 0 ? "Z2 base aerobica" : "Fondo suave",
        objective: i === 0 ? "Z2 base aerobica" : "Fondo suave",
        duration: i === 0 ? 40 : 60,
        targetZone: "Z2",
        notes: "Controlar FC y cadencia estable.",
        status: "planned",
      });
    }
    for (let i = 0; i < bikeDays; i += 1) {
      generated.push({
        id: makeId("plan-session"),
        date: base[[5, 2, 6, 3][i] || i],
        type: "cycling",
        title: i === 0 ? "Z2 endurance" : "Fondo",
        objective: i === 0 ? "Z2 endurance" : "Fondo",
        duration: i === 0 ? 90 : 150,
        targetZone: "Z2",
        notes: "Evitar picos innecesarios si hay fatiga.",
        status: "planned",
      });
    }
    return generated;
  };

  const generateWeek = () => {
    const generated = buildGeneratedWeek();
    const outsideWeek = sessions.filter((session) => weekKey(parseLocalDate(session.date)) !== currentWeekKey);
    setProposedPlan([...outsideWeek, ...generated].sort((a, b) => `${a.date}-${a.type}`.localeCompare(`${b.date}-${b.type}`)));
    setStatus("IDG Coach genero una propuesta. Revisa la semana y confirma antes de modificar tu plan.");
  };

  const applyProposedPlan = () => {
    if (!proposedPlan) return;
    saveSessions(proposedPlan);
    setStatus("Propuesta aplicada y sincronizada en la nube.");
  };

  const discardProposedPlan = () => {
    setProposedPlan(null);
    setStatus("Propuesta descartada. Tu plan actual no cambio.");
  };

  const selectedSessions = weekPlan.filter((session) => session.date === selectedDate);
  const selectedReal = weekReal.filter((session) => session.date.slice(0, 10) === selectedDate);
  const dominantSport = ["gym", "running", "cycling"].map((type) => ({
    type,
    planned: weekPlan.filter((session) => session.type === type).length,
    real: weekReal.filter((session) => session.type === type).length,
  }));

  const recommendation = completion >= 85
    ? "Semana muy bien encaminada. Manten la carga y protege el descanso."
    : realLoad > plannedLoad * 1.25 && plannedLoad > 0
      ? "La carga real supera lo planeado. Conviene mover intensidad y priorizar Z2 o movilidad."
      : weekPlan.length === 0
        ? "Genera o agrega sesiones para que IDG pueda comparar plan vs real."
        : "Aun hay margen de cumplimiento. Reprograma pendientes sin concentrar demasiada carga en un solo dia.";

  if (!mounted) {
    return (
      <>
        <TopNav title="Plan Semanal" />
        <main className="min-h-0 flex-1 overflow-y-auto bg-[#F8FAFC] p-4 text-[#0F172A] lg:p-6">
          <div className="rounded-lg border border-slate-200 bg-white p-6">
            <p className="text-sm font-black uppercase tracking-wide text-blue-600">Planificacion deportiva</p>
            <h1 className="mt-2 text-2xl font-black text-slate-900">Cargando plan semanal</h1>
            <p className="mt-2 text-sm font-semibold text-slate-500">Preparando tu semana y sincronizando datos del dispositivo.</p>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <TopNav title="Plan Semanal" />
      <main className="min-h-0 flex-1 overflow-y-auto bg-[#F8FAFC] p-4 text-[#0F172A] lg:p-6">
        <div className="mb-5 rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-sm font-bold text-slate-500">Planificacion deportiva</p>
              <h1 className="mt-1 text-3xl font-black tracking-tight">Plan Semanal Inteligente</h1>
              <p className="mt-1 text-sm font-semibold text-slate-500">Programa gym, running y ciclismo; compara automaticamente contra lo realizado.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700" type="button" onClick={() => setWeekStart(addDays(weekStart, -7))}>Anterior</button>
              <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700" type="button" onClick={() => setWeekStart(startOfWeek())}>Actual</button>
              <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700" type="button" onClick={() => setWeekStart(addDays(weekStart, 7))}>Siguiente</button>
              <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-black text-white" type="button" onClick={generateWeek}>Generar propuesta IA</button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-4">
            {[
              ["Semana", formatWeekRange(weekStart)],
              ["Cumplimiento", `${completion}%`],
              ["Planeado", `${weekPlan.length} sesiones - ${formatDuration(plannedMinutes)}`],
              ["Carga", `${mounted ? Math.round(realLoad) : 0} real / ${Math.round(plannedLoad)} plan`],
            ].map(([label, value]) => (
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-4" key={label}>
                <p className="text-xs font-black uppercase text-slate-400">{label}</p>
                <p className="mt-1 text-lg font-black text-slate-900">{value}</p>
              </div>
            ))}
          </div>
        </div>

        {status ? (
          <div className="mb-4 flex flex-col gap-3 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700 sm:flex-row sm:items-center sm:justify-between">
            <span>{status}</span>
            {/no se pudo|error|backend|nube/i.test(status) ? (
              <button className="w-fit rounded-lg bg-white px-3 py-2 text-xs font-black text-blue-700 ring-1 ring-blue-100" type="button" onClick={() => window.location.reload()}>
                Reintentar
              </button>
            ) : null}
          </div>
        ) : null}
        {proposedPlan ? (
          <div className="mb-4 flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800 lg:flex-row lg:items-center lg:justify-between">
            <span>Estas viendo una propuesta de IDG Coach. Nada se guarda hasta que la confirmes.</span>
            <div className="flex flex-wrap gap-2">
              <button className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white" type="button" onClick={applyProposedPlan}>Confirmar propuesta</button>
              <button className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-black text-amber-800" type="button" onClick={discardProposedPlan}>Descartar</button>
            </div>
          </div>
        ) : null}

        <div className="grid gap-5">
          <section className="grid gap-5">
            <div className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="pb-2">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
                {weekDays.map((day) => {
                  const date = isoDate(day);
                  const planned = weekPlan.filter((session) => session.date === date);
                  const real = weekReal.filter((session) => session.date.slice(0, 10) === date);
                  const selected = selectedDate === date;
                  return (
                    <button
                      className={`min-h-36 rounded-lg border p-3 text-left transition lg:min-h-44 ${selected ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                      key={date}
                      type="button"
                      onClick={() => setSelectedDate(date)}
                    >
                      <div className="mb-3 flex items-start justify-between">
                        <div>
                          <p className="text-xs font-black uppercase text-slate-400">{day.toLocaleDateString("es-CO", { weekday: "short" })}</p>
                          <p className="text-2xl font-black text-slate-900">{day.getDate()}</p>
                        </div>
                        {real.length ? <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-black text-emerald-700">{real.length} real</span> : null}
                      </div>
                      <div className="grid gap-2">
                        {planned.slice(0, 3).map((session) => {
                          const done = completedIds.has(session.id) || session.status === "completed";
                          return (
                            <div className={`rounded-md border px-2 py-2 ${typeMeta[session.type].soft}`} key={session.id} title={`${session.type === "gym" ? session.gymRoutine : session.title} - ${formatDuration(session.duration)} - ${session.targetZone}`}>
                              <div className="flex min-w-0 items-center gap-2">
                                <AppIcon name={typeMeta[session.type].icon} className="h-4 w-4" />
                                <span className="truncate text-xs font-black">{typeMeta[session.type].label}</span>
                                {done ? <span className="ml-auto h-2 w-2 rounded-full bg-emerald-500" /> : null}
                              </div>
                            </div>
                          );
                        })}
                        {planned.length > 3 ? <p className="text-xs font-black text-slate-400">+{planned.length - 3} mas</p> : null}
                        {!planned.length ? <p className="rounded-md border border-dashed border-slate-200 py-4 text-center text-xs font-bold text-slate-400">Libre</p> : null}
                      </div>
                    </button>
                  );
                })}
                </div>
              </div>
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
              <section className="rounded-lg border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-black text-slate-900">{parseLocalDate(selectedDate).toLocaleDateString("es-CO", { weekday: "long", day: "2-digit", month: "long" })}</h2>
                    <p className="text-sm font-semibold text-slate-500">{selectedSessions.length} planeadas - {selectedReal.length} realizadas</p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3">
                  {selectedSessions.map((session) => {
                    const done = completedIds.has(session.id) || session.status === "completed";
                    return (
                      <div className="rounded-lg border border-slate-200 p-4" key={session.id}>
                        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                          <div className="flex items-start gap-3">
                            <div className={`grid h-10 w-10 place-items-center rounded-lg text-white ${typeMeta[session.type].color}`}>
                              <AppIcon name={typeMeta[session.type].icon} className="h-5 w-5" />
                            </div>
                            <div>
                              <p className="font-black text-slate-900">{session.type === "gym" ? session.gymRoutine : session.title}</p>
                              <p className="text-sm font-semibold text-slate-500">{typeMeta[session.type].label} - {session.objective} - {formatDuration(session.duration)} - {session.targetZone}</p>
                              {session.notes ? <p className="mt-1 text-xs font-bold text-slate-400">{session.notes}</p> : null}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button className={`rounded-lg px-3 py-2 text-xs font-black ${done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`} type="button" onClick={() => updateSessionStatus(session.id, done ? "planned" : "completed")}>{done ? "Completada" : "Marcar hecho"}</button>
                            <button className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-600" type="button" onClick={() => updateSessionStatus(session.id, "moved")}>Reprogramar</button>
                            <button className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-600" type="button" onClick={() => deleteSession(session.id)}>Eliminar</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {!selectedSessions.length ? <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-sm font-bold text-slate-400">Este dia no tiene sesiones planeadas.</div> : null}
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-5">
                <h2 className="text-lg font-black text-slate-900">Agregar sesion</h2>
                <div className="mt-4 grid gap-3">
                  <div className="grid grid-cols-3 gap-2">
                    {(["gym", "running", "cycling", "mobility", "rest"] as SessionType[]).map((type) => (
                      <button className={`rounded-lg border px-2 py-2 text-xs font-black ${draft.type === type ? typeMeta[type].soft : "border-slate-200 bg-white text-slate-500"}`} key={type} type="button" onClick={() => setDraftType(type)}>
                        {typeMeta[type].label}
                      </button>
                    ))}
                  </div>
                  {draft.type === "gym" ? (
                    <label className="grid gap-1 text-xs font-black uppercase text-slate-500">Rutina<select className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-800" value={draft.gymRoutine} onChange={(event) => setDraft((current) => ({ ...current, gymRoutine: event.target.value }))}>{gymRoutineOptions.map((routine) => <option key={routine}>{routine}</option>)}</select></label>
                  ) : null}
                  {draft.type !== "gym" ? (
                    <label className="grid gap-1 text-xs font-black uppercase text-slate-500">Objetivo<select className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-800" value={draft.objective} onChange={(event) => setDraft((current) => ({ ...current, objective: event.target.value }))}>{objectives[draft.type].map((option) => <option key={option}>{option}</option>)}</select></label>
                  ) : null}
                  {draft.type !== "rest" ? (
                    <div className="grid grid-cols-1 gap-3">
                      <label className="grid min-w-0 gap-1 text-xs font-black uppercase text-slate-500">Duracion min<input className="h-10 w-full min-w-0 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-800" value={draft.duration} onChange={(event) => setDraft((current) => ({ ...current, duration: event.target.value }))} /></label>
                      <label className="grid min-w-0 gap-1 text-xs font-black uppercase text-slate-500">Zona/RPE<input className="h-10 w-full min-w-0 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-800" value={draft.targetZone} onChange={(event) => setDraft((current) => ({ ...current, targetZone: event.target.value }))} /></label>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-500">
                      El descanso no requiere duracion ni zona. Se usa para proteger recuperacion y ordenar la carga semanal.
                    </div>
                  )}
                  <label className="grid gap-1 text-xs font-black uppercase text-slate-500">Notas<textarea className="min-h-20 rounded-lg border border-slate-200 p-3 text-sm font-semibold text-slate-700" value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
                  <button className="rounded-lg bg-blue-600 px-4 py-3 text-sm font-black text-white" type="button" onClick={addSession}>Agregar al dia</button>
                </div>
              </section>
            </div>
          </section>

          <section className="grid gap-5 xl:grid-cols-3">
            <section className="rounded-lg border border-blue-100 bg-white p-5">
              <p className="text-xs font-black uppercase tracking-wide text-blue-600">IDG Intelligence</p>
              <h2 className="mt-1 text-xl font-black text-slate-900">Ajuste recomendado</h2>
              <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">{recommendation}</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700" type="button" onClick={() => setStatus("Sugerencia: mueve una sesion intensa hacia un dia libre o cambia por movilidad.")}>Ver detalle</button>
                {proposedPlan ? (
                  <button className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white" type="button" onClick={applyProposedPlan}>Confirmar</button>
                ) : (
                  <button className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white" type="button" onClick={generateWeek}>Proponer ajuste</button>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-5">
              <h2 className="text-lg font-black text-slate-900">Plan vs Real</h2>
              <div className="mt-4 grid gap-4">
                {dominantSport.map((row) => {
                  const meta = typeMeta[row.type as SessionType];
                  const pct = row.planned ? Math.min(100, Math.round((row.real / row.planned) * 100)) : 0;
                  return (
                    <div key={row.type}>
                      <div className="mb-1 flex justify-between text-xs font-black">
                        <span className="flex items-center gap-2"><AppIcon name={meta.icon} className="h-4 w-4" /> {meta.label}</span>
                        <span>{row.real}/{row.planned}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full ${meta.color}`} style={{ width: `${pct}%` }} /></div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-5">
              <h2 className="text-lg font-black text-slate-900">Carga semanal</h2>
              <div className="mt-4 grid gap-3">
                <div>
                  <div className="mb-1 flex justify-between text-xs font-black text-slate-500"><span>Planeada</span><span>{Math.round(plannedLoad)}</span></div>
                  <div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.min(100, plannedLoad ? 100 : 0)}%` }} /></div>
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-xs font-black text-slate-500"><span>Real</span><span>{Math.round(realLoad)}</span></div>
                  <div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, plannedLoad ? (realLoad / plannedLoad) * 100 : 0)}%` }} /></div>
                </div>
              </div>
              <p className="mt-3 text-xs font-semibold leading-5 text-slate-500">La carga real se alimenta de gym, running y ciclismo guardados.</p>
            </section>
          </section>
        </div>
      </main>
    </>
  );
}

