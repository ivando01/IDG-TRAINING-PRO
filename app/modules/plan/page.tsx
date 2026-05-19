"use client";

import { AppIcon, AppIconName } from "@/components/Brand";
import TopNav from "@/components/TopNav";
import { canSyncCloud, getCloudCollection, saveCloudCollection } from "@/lib/cloud-sync";
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

const PLAN_KEY = "idg_weekly_plan_json";
const PROFILE_KEY = "idg_profile_json";

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
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
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

function isTrainingActivity(item: Record<string, unknown>) {
  if (item.countsTowardTraining === false || item.activityKind === "support") return false;
  const text = `${String(item.activitySubType || "")} ${String(item.name || "")}`.toLowerCase();
  return !/walk|hike|caminar|caminata|senderismo/.test(text);
}

function getRealSessions(): RealSession[] {
  const gym = readJSON<Array<Record<string, unknown>>>("idg_gym_sessions_json", []);
  const running = readJSON<Array<Record<string, unknown>>>("idg_running_activities_json", []).filter(isTrainingActivity);
  const cycling = readJSON<Array<Record<string, unknown>>>("idg_cycling_activities_json", []);

  const gymSessions = gym.map((item) => ({
    id: String(item.id || crypto.randomUUID()),
    date: String(item.date || "").slice(0, 10),
    type: "gym" as const,
    title: String(item.routineName || "Gym"),
    duration: num(item.duration),
    load: Math.round(num(item.duration) * (num(item.intensity) || 6) / 10),
  }));

  const runSessions = running.map((item) => {
    const metrics = (item.metrics || {}) as Record<string, unknown>;
    return {
      id: String(item.id || crypto.randomUUID()),
      date: String(item.date || item.startTime || "").slice(0, 10),
      type: "running" as const,
      title: String(item.name || "Running"),
      duration: minutesFromActivity(item),
      load: Math.round((num(metrics.durationSec) / 60) * ((num(metrics.avgHr) || 130) / 150)),
    };
  });

  const bikeSessions = cycling.map((item) => {
    const metrics = (item.metrics || {}) as Record<string, unknown>;
    return {
      id: String(item.id || crypto.randomUUID()),
      date: String(item.date || item.startTime || "").slice(0, 10),
      type: "cycling" as const,
      title: String(item.name || "Ciclismo"),
      duration: minutesFromActivity(item),
      load: Math.round(num(metrics.tss) || (num(metrics.durationSec) / 60) * ((num(metrics.avgHr) || 125) / 145)),
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

export default function PlanModule() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek());
  const [selectedDate, setSelectedDate] = useState(() => isoDate(new Date()));
  const [sessions, setSessions] = useState<PlannedSession[]>([]);
  const [realSessions, setRealSessions] = useState<RealSession[]>([]);
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

  useEffect(() => {
    let alive = true;
    setMounted(true);
    const localPlan = readJSON<PlannedSession[]>(PLAN_KEY, []);
    setSessions(localPlan);
    setRealSessions(getRealSessions());

    if (!canSyncCloud()) {
      if (localPlan.length) setStatus("Plan cargado en este dispositivo. Inicia sesion para sincronizarlo en todos tus equipos.");
      return () => {
        alive = false;
      };
    }

    getCloudCollection<PlannedSession>("/plan", "plan")
      .then(async (cloudPlan) => {
        if (!alive) return;
        if (cloudPlan.length) {
          const sortedCloudPlan = [...cloudPlan].sort((a, b) => `${a.date}-${a.type}`.localeCompare(`${b.date}-${b.type}`));
          setSessions(sortedCloudPlan);
          localStorage.setItem(PLAN_KEY, JSON.stringify(sortedCloudPlan));
          setStatus("Plan semanal sincronizado desde la nube.");
          return;
        }
        if (localPlan.length) {
          const sortedLocalPlan = [...localPlan].sort((a, b) => `${a.date}-${a.type}`.localeCompare(`${b.date}-${b.type}`));
          await saveCloudCollection("/plan", "plan", sortedLocalPlan);
          if (!alive) return;
          setSessions(sortedLocalPlan);
          localStorage.setItem(PLAN_KEY, JSON.stringify(sortedLocalPlan));
          setStatus("Plan local subido a la nube. Ya debe verse en movil y web.");
          return;
        }
        setSessions(cloudPlan);
        localStorage.setItem(PLAN_KEY, JSON.stringify(cloudPlan));
      })
      .catch((error) => {
        if (!alive) return;
        setStatus(error instanceof Error ? error.message : "No se pudo sincronizar el plan semanal.");
      });
    return () => {
      alive = false;
    };
  }, []);

  const currentWeekKey = weekKey(weekStart);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const weekPlan = sessions.filter((session) => weekKey(parseLocalDate(session.date)) === currentWeekKey);
  const weekReal = realSessions.filter((session) => weekKey(parseLocalDate(session.date)) === currentWeekKey);

  const completedIds = new Set(
    weekPlan
      .filter((planned) => weekReal.some((real) => real.date.slice(0, 10) === planned.date && real.type === planned.type))
      .map((planned) => planned.id),
  );

  const plannedLoad = weekPlan.reduce((sum, item) => sum + (item.duration * (item.type === "gym" ? 0.7 : item.type === "cycling" ? 0.9 : item.type === "running" ? 0.85 : 0.25)), 0);
  const realLoad = weekReal.reduce((sum, item) => sum + item.load, 0);
  const plannedMinutes = weekPlan.reduce((sum, item) => sum + item.duration, 0);
  const completedCount = weekPlan.filter((item) => completedIds.has(item.id) || item.status === "completed").length;
  const completion = weekPlan.length ? Math.round((completedCount / weekPlan.length) * 100) : 0;

  const saveSessions = (next: PlannedSession[]) => {
    const sorted = [...next].sort((a, b) => `${a.date}-${a.type}`.localeCompare(`${b.date}-${b.type}`));
    setSessions(sorted);
    localStorage.setItem(PLAN_KEY, JSON.stringify(sorted));
    if (!canSyncCloud()) {
      setStatus("Plan guardado solo en este dispositivo. Inicia sesion para verlo en movil y web.");
    } else {
      saveCloudCollection("/plan", "plan", sorted)
        .then(() => setStatus("Plan sincronizado en la nube."))
        .catch((error) => setStatus(error instanceof Error ? error.message : "No se pudo sincronizar el plan semanal."));
    }
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
      id: crypto.randomUUID(),
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

  const generateWeek = () => {
    const profile = readJSON<Record<string, unknown>>(PROFILE_KEY, {});
    const gymDays = Math.min(5, Math.max(0, num(profile.gymDaysPerWeek) || 4));
    const runDays = Math.min(4, Math.max(0, num(profile.runDaysPerWeek) || 2));
    const bikeDays = Math.min(4, Math.max(0, num(profile.bikeDaysPerWeek) || 2));
    const base = weekDays.map(isoDate);
    const generated: PlannedSession[] = [];

    for (let i = 0; i < gymDays; i += 1) {
      generated.push({
        id: crypto.randomUUID(),
        date: base[[0, 1, 3, 4, 5][i] || i],
        type: "gym",
        title: gymRoutines[i % 5],
        gymRoutine: gymRoutines[i % 5],
        objective: "Rutina base",
        duration: 75,
        targetZone: "RPE 7",
        notes: "Mantener tecnica limpia y registrar pesos.",
        status: "planned",
      });
    }
    for (let i = 0; i < runDays; i += 1) {
      generated.push({
        id: crypto.randomUUID(),
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
        id: crypto.randomUUID(),
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

    const outsideWeek = sessions.filter((session) => weekKey(parseLocalDate(session.date)) !== currentWeekKey);
    saveSessions([...outsideWeek, ...generated].sort((a, b) => `${a.date}-${a.type}`.localeCompare(`${b.date}-${b.type}`)));
    setStatus("Semana generada desde tu perfil y carga reciente.");
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
              <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-black text-white" type="button" onClick={generateWeek}>Generar semana IA</button>
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

        {status ? <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">{status}</div> : null}

        <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.7fr)_390px]">
          <section className="grid gap-5">
            <div className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="grid gap-3 lg:grid-cols-7">
                {weekDays.map((day) => {
                  const date = isoDate(day);
                  const planned = weekPlan.filter((session) => session.date === date);
                  const real = weekReal.filter((session) => session.date.slice(0, 10) === date);
                  const selected = selectedDate === date;
                  return (
                    <button
                      className={`min-h-44 rounded-lg border p-3 text-left transition ${selected ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
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
                    <label className="grid gap-1 text-xs font-black uppercase text-slate-500">Rutina<select className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-800" value={draft.gymRoutine} onChange={(event) => setDraft((current) => ({ ...current, gymRoutine: event.target.value }))}>{gymRoutines.map((routine) => <option key={routine}>{routine}</option>)}</select></label>
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

          <aside className="grid content-start gap-5">
            <section className="rounded-lg border border-blue-100 bg-white p-5">
              <p className="text-xs font-black uppercase tracking-wide text-blue-600">IDG Intelligence</p>
              <h2 className="mt-1 text-xl font-black text-slate-900">Ajuste recomendado</h2>
              <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">{recommendation}</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700" type="button" onClick={() => setStatus("Sugerencia: mueve una sesion intensa hacia un dia libre o cambia por movilidad.")}>Ver detalle</button>
                <button className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white" type="button" onClick={generateWeek}>Aplicar ajuste</button>
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
          </aside>
        </div>
      </main>
    </>
  );
}

