"use client";

import TopNav from "@/components/TopNav";
import { deleteCloudItem, getCloudCollection, saveCloudCollection } from "@/lib/cloud-sync";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

type RoutineKey = "1" | "2" | "3" | "4" | "5" | "wod" | "custom";

type ExerciseDraft = {
  id: string;
  name: string;
  sets: number;
  reps: string;
  repsBySet?: string[];
  weights: string[];
  rest: number;
  note?: string;
};

type GymSession = {
  id: string;
  date: string;
  routine: RoutineKey;
  routineName: string;
  duration: number;
  intensity: number;
  painLevel: number;
  pain: string;
  calories: string;
  notes: string;
  exercises: ExerciseDraft[];
  intelligence: string;
  aiAnalysis?: string;
  aiGeneratedAt?: string;
  aiAcknowledgedAt?: string;
  updatedAt: number;
};

type GymTemplate = {
  id: string;
  name: string;
  focus: string;
  routineKey: RoutineKey;
  source: "user" | "coach";
  exercises: ExerciseDraft[];
  updatedAt: number;
};

const STORAGE_KEY = "idg_gym_sessions_json";
const DRAFT_KEY = "idg_gym_current_session_json";
const TEMPLATES_KEY = "idg_gym_templates_json";
const PROFILE_KEY = "idg_profile_json";

function safeSaveGymLocal(sessions: GymSession[]) {
  const compact = sessions.slice(0, 160);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(compact));
    return true;
  } catch {
    // Keep Strava caches intact; fall back to a smaller gym snapshot only.
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(compact.slice(0, 100)));
    return true;
  } catch {
    return false;
  }
}

const routines: Record<RoutineKey, { name: string; exercises: Omit<ExerciseDraft, "id" | "weights">[] }> = {
  "1": {
    name: "Dia 1 - Cuadriceps + Pantorrilla",
    exercises: [
      { name: "Prensa de piernas", sets: 4, reps: "10", rest: 90, note: "Explosivo" },
      { name: "Sentadilla bulgara", sets: 3, reps: "8", rest: 75, note: "Por lado" },
      { name: "Zancadas walking", sets: 3, reps: "16", rest: 60, note: "Pasos totales" },
      { name: "Caminata del granjero", sets: 3, reps: "60s", rest: 60, note: "Mancuernas" },
      { name: "Elevacion talones de pie (prensa)", sets: 4, reps: "15", rest: 45 },
      { name: "Elevacion talones sentado", sets: 3, reps: "20", rest: 45, note: "Soleo" },
    ],
  },
  "2": {
    name: "Dia 2 - Isquios + Gluteo",
    exercises: [
      { name: "Peso muerto rumano", sets: 4, reps: "10", rest: 90, note: "Bajada 3 seg" },
      { name: "Hip thrust", sets: 3, reps: "12", rest: 75, note: "Pausa 1 seg arriba" },
      { name: "Curl femoral tumbado", sets: 4, reps: "10-12", rest: 75, note: "Maquina" },
      { name: "Zancada atras (reverse lunge)", sets: 3, reps: "10", rest: 60, note: "Por pierna" },
      { name: "Abduccion cadera externa", sets: 4, reps: "15", rest: 45, note: "Maquina" },
      { name: "Curl femoral sentado", sets: 3, reps: "12", rest: 60, note: "Angulo diferente" },
    ],
  },
  "3": {
    name: "Dia 3 - Espalda + Antebrazo",
    exercises: [
      { name: "Jalon al pecho (agarre abierto)", sets: 4, reps: "10-12", rest: 90 },
      { name: "Remo con mancuerna (1 mano)", sets: 3, reps: "10", rest: 75, note: "Por lado" },
      { name: "Remo convergente", sets: 3, reps: "10", rest: 75 },
      { name: "Remo polea baja (agarre cerrado)", sets: 3, reps: "12", rest: 75 },
      { name: "Hiperextensiones lumbares", sets: 3, reps: "15", rest: 60, note: "Lento" },
      { name: "Curl inverso barra Z", sets: 3, reps: "12", rest: 60 },
      { name: "Flexion de muneca (barra)", sets: 3, reps: "15", rest: 45, note: "Antebrazo" },
    ],
  },
  "4": {
    name: "Dia 4 - Pecho + Hombro",
    exercises: [
      { name: "Press militar con mancuernas", sets: 4, reps: "10", rest: 90, note: "De pie" },
      { name: "Press banca con mancuernas", sets: 4, reps: "10", rest: 90 },
      { name: "Press inclinado (maquina)", sets: 3, reps: "12", rest: 75 },
      { name: "Pec deck (cerrando al centro)", sets: 3, reps: "12", rest: 60 },
      { name: "Face pulls (polea alta)", sets: 4, reps: "15", rest: 60, note: "No omitir" },
      { name: "Rotacion externa hombro (polea)", sets: 3, reps: "15", rest: 45, note: "Codo 90" },
      { name: "Vuelos laterales", sets: 4, reps: "15", rest: 45, note: "Codo semiflexionado" },
    ],
  },
  "5": {
    name: "Dia 5 - Biceps + Triceps",
    exercises: [
      { name: "Curl biceps barra Z", sets: 3, reps: "10", rest: 75 },
      { name: "Curl martillo (mancuernas)", sets: 3, reps: "12", rest: 60, note: "Braquial" },
      { name: "Curl concentrado", sets: 3, reps: "12", rest: 60 },
      { name: "Copa de triceps (mancuerna)", sets: 3, reps: "10", rest: 75, note: "Obligatorio" },
      { name: "Extension triceps polea/cuerda", sets: 3, reps: "12", rest: 60 },
      { name: "Fondos en maquina", sets: 3, reps: "12", rest: 75, note: "Sin impacto hombro" },
    ],
  },
  wod: {
    name: "WOD Ranger",
    exercises: [
      { name: "Flexiones controladas", sets: 4, reps: "10", rest: 60, note: "Tempo 3-1" },
      { name: "Bulgaras explosivas (sin peso)", sets: 4, reps: "8", rest: 60, note: "Por pierna" },
      { name: "Burpees tacticos (sin salto)", sets: 4, reps: "10", rest: 60 },
      { name: "Plancha toque de hombros", sets: 4, reps: "20", rest: 45, note: "10 por lado" },
      { name: "Escaladores de montana", sets: 4, reps: "40s", rest: 45, note: "Core + cardio" },
      { name: "Farmer hold", sets: 3, reps: "45s", rest: 60, note: "Agarre y core" },
    ],
  },
  custom: {
    name: "Personalizado",
    exercises: [],
  },
};

function secondsToMMSS(seconds: number) {
  const mm = Math.floor(seconds / 60).toString().padStart(2, "0");
  const ss = Math.max(0, seconds % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

function mmssToSeconds(value: string) {
  const [mm = "0", ss = "0"] = value.split(":");
  return Math.max(0, (Number(mm) || 0) * 60 + (Number(ss) || 0));
}

function hhmmToMinutes(value: string) {
  const [hh = "0", mm = "0"] = value.split(":");
  return Math.max(0, (Number(hh) || 0) * 60 + (Number(mm) || 0));
}

function minutesToHHMM(minutes: number) {
  const hh = Math.floor(minutes / 60).toString().padStart(2, "0");
  const mm = Math.max(0, minutes % 60).toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatDurationLong(minutes: number) {
  const hh = Math.floor(minutes / 60);
  const mm = Math.max(0, minutes % 60);
  return hh ? `${hh}h ${mm}m` : `${mm}m`;
}

function localISODate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDate(dateText: string) {
  const [year, month, day] = String(dateText || localISODate()).slice(0, 10).split("-").map(Number);
  return new Date(year || new Date().getFullYear(), (month || 1) - 1, day || 1);
}

function getWeekKey(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay() || 7;
  copy.setDate(copy.getDate() - day + 1);
  return localISODate(copy);
}

function shortMonth(dateText: string) {
  const date = parseLocalDate(dateText);
  return date.toLocaleDateString("es-CO", { month: "short" }).replace(".", "").toUpperCase();
}

function normalizeExerciseDraft(exercise: Partial<ExerciseDraft>, index = 0): ExerciseDraft {
  const sets = Math.max(1, Math.min(10, Number(exercise.sets) || 3));
  const baseReps = String(exercise.reps || "10");
  const repsBySet = Array.isArray(exercise.repsBySet) ? exercise.repsBySet : [];
  return {
    id: String(exercise.id || `exercise-${index}`),
    name: String(exercise.name || `Ejercicio ${index + 1}`),
    sets,
    reps: baseReps,
    repsBySet: Array.from({ length: sets }, (_, setIndex) => String(repsBySet[setIndex] ?? baseReps)),
    weights: Array.from({ length: sets }, (_, setIndex) => String(exercise.weights?.[setIndex] ?? "")),
    rest: Math.max(0, Number(exercise.rest) || 60),
    note: exercise.note ? String(exercise.note) : undefined,
  };
}

function repsForLoad(value: string | undefined) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return 0;
  if (/\d+\s*s/.test(text)) return 1;
  const range = text.match(/(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)/);
  if (range) {
    const first = Number(range[1].replace(",", "."));
    const second = Number(range[2].replace(",", "."));
    return Number.isFinite(first) && Number.isFinite(second) ? (first + second) / 2 : 0;
  }
  const parsed = Number(text.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSession(session: GymSession): GymSession {
  const routineKey = String(session.routine || "4") as RoutineKey;
  const validRoutine = routines[routineKey] ? routineKey : "custom";
  return {
    ...session,
    date: String(session.date || localISODate()).slice(0, 10),
    routine: validRoutine,
    routineName: session.routineName || routines[validRoutine].name,
    duration: Number(session.duration) || 0,
    intensity: Number(session.intensity) || 0,
    painLevel: Number(session.painLevel) || 0,
    exercises: Array.isArray(session.exercises) ? session.exercises.map(normalizeExerciseDraft) : [],
    intelligence: String(session.intelligence || ""),
    aiAnalysis: String(session.aiAnalysis || ""),
    aiGeneratedAt: session.aiGeneratedAt ? String(session.aiGeneratedAt) : undefined,
    aiAcknowledgedAt: session.aiAcknowledgedAt ? String(session.aiAcknowledgedAt) : undefined,
    updatedAt: Number(session.updatedAt) || Date.now(),
  };
}

function sortSessions(sessions: GymSession[]) {
  return sessions.map(normalizeSession).sort((a, b) => parseLocalDate(b.date).getTime() - parseLocalDate(a.date).getTime() || b.updatedAt - a.updatedAt);
}

function cloneExercises(exercises: ExerciseDraft[]) {
  return exercises.map((exercise, index) => ({
    ...normalizeExerciseDraft(exercise, index),
    id: `${exercise.id || exercise.name}-${Date.now()}-${index}`,
  }));
}

function normalizeTemplate(template: Partial<GymTemplate>): GymTemplate | null {
  const name = String(template.name || "").trim();
  const exercises = Array.isArray(template.exercises) ? template.exercises : [];
  if (!name || !exercises.length) return null;
  const routineKey = String(template.routineKey || "custom") as RoutineKey;
  return {
    id: String(template.id || `template-${Date.now()}`),
    name,
    focus: String(template.focus || "Plantilla personalizada"),
    routineKey: routines[routineKey] ? routineKey : "custom",
    source: template.source === "coach" ? "coach" : "user",
    exercises: exercises.map(normalizeExerciseDraft),
    updatedAt: Number(template.updatedAt) || Date.now(),
  };
}

function sortTemplates(templates: GymTemplate[]) {
  return templates
    .map(normalizeTemplate)
    .filter((template): template is GymTemplate => Boolean(template))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function scaleColor(value: number) {
  if (value <= 3) return "#22c55e";
  if (value <= 6) return "#facc15";
  if (value <= 8) return "#f97316";
  return "#ef4444";
}

function Icon({ name }: { name: "save" | "edit" | "trash" | "chart" | "spark" | "plus" | "chev" | "eye" | "up" | "down" }) {
  const common = { fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeWidth: 1.8 };

  if (name === "spark") {
    return <img src="/icons/IA.png" alt="" aria-hidden="true" className="h-4 w-4 shrink-0 rounded-sm object-cover" />;
  }

  return (
    <svg aria-hidden="true" className="h-4 w-4 shrink-0" viewBox="0 0 24 24">
      {name === "save" ? <path d="M5 4h12l2 2v14H5zM8 4v6h8V4M8 20v-6h8v6" {...common} /> : null}
      {name === "edit" ? <path d="m4 16 11-11 4 4L8 20H4zM13 7l4 4" {...common} /> : null}
      {name === "trash" ? <path d="M4 7h16M9 7V4h6v3M8 10v8M12 10v8M16 10v8M6 7l1 14h10l1-14" {...common} /> : null}
      {name === "chart" ? <path d="M5 19V9M12 19V5M19 19v-7M4 19h16" {...common} /> : null}
      {name === "eye" ? <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" {...common} /> : null}
      {name === "plus" ? <path d="M12 5v14M5 12h14" {...common} /> : null}
      {name === "chev" ? <path d="m6 9 6 6 6-6" {...common} /> : null}
      {name === "up" ? <path d="m6 15 6-6 6 6" {...common} /> : null}
      {name === "down" ? <path d="m6 9 6 6 6-6" {...common} /> : null}
    </svg>
  );
}

export default function GymModule() {
  const intelligenceRef = useRef<HTMLElement | null>(null);
  const [routine, setRoutine] = useState<RoutineKey>("4");
  const [unit, setUnit] = useState<"kg" | "lbs">("lbs");
  const [date, setDate] = useState("");
  const [duration, setDuration] = useState("01:15");
  const [intensity, setIntensity] = useState(7);
  const [painLevel, setPainLevel] = useState(0);
  const [pain, setPain] = useState("");
  const [calories, setCalories] = useState("");
  const [notes, setNotes] = useState("");
  const [exercises, setExercises] = useState<ExerciseDraft[]>([]);
  const [history, setHistory] = useState<GymSession[]>([]);
  const [templates, setTemplates] = useState<GymTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [customRoutineName, setCustomRoutineName] = useState("");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [inlineEditingId, setInlineEditingId] = useState("");
  const [inlineDraft, setInlineDraft] = useState<GymSession | null>(null);
  const [intelligence, setIntelligence] = useState("Selecciona una sesion guardada o guarda una rutina para generar recomendaciones.");
  const [showAI, setShowAI] = useState(true);
  const [aiLoadingId, setAiLoadingId] = useState("");
  const [weeklyTarget, setWeeklyTarget] = useState(4);
  const [savedExerciseIds, setSavedExerciseIds] = useState<string[]>([]);

  const buildExercises = (nextRoutine: RoutineKey, savedHistory: GymSession[]) => {
    const previous = savedHistory.find((session) => session.routine === nextRoutine);
    const byName = new Map((previous?.exercises ?? []).map((exercise) => [exercise.name, exercise]));

    return routines[nextRoutine].exercises.map((exercise, index) => {
      const old = byName.get(exercise.name);
      const sets = old?.sets ?? exercise.sets;

      return {
        id: `${nextRoutine}-${index}-${exercise.name}`,
        ...exercise,
        sets,
        reps: old?.reps ?? exercise.reps,
        repsBySet: Array.from({ length: sets }, (_, setIndex) => old?.repsBySet?.[setIndex] ?? old?.reps ?? exercise.reps),
        rest: old?.rest ?? exercise.rest,
        weights: Array.from({ length: sets }, (_, setIndex) => old?.weights[setIndex] ?? ""),
      };
    });
  };

  const persistTemplates = (next: GymTemplate[]) => {
    const sorted = sortTemplates(next);
    setTemplates(sorted);
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(sorted));
    saveCloudCollection("/gym/templates", "templates", sorted).catch(() => undefined);
    return sorted;
  };

  useEffect(() => {
    let alive = true;
    setDate(localISODate());
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const saved: GymSession[] = raw ? JSON.parse(raw) : [];
      const sorted = sortSessions(saved);
      setHistory(sorted);
      const savedTemplates = sortTemplates(JSON.parse(localStorage.getItem(TEMPLATES_KEY) || "[]"));
      setTemplates(savedTemplates);
      const draftRaw = localStorage.getItem(DRAFT_KEY);
      const draft = draftRaw ? normalizeSession(JSON.parse(draftRaw) as GymSession) : null;
      if (draft) {
        setRoutine(draft.routine);
        if (draft.routine === "custom") setCustomRoutineName(draft.routineName);
        setDate(draft.date);
        setDuration(minutesToHHMM(draft.duration || 75));
        setIntensity(draft.intensity || 7);
        setPainLevel(draft.painLevel || 0);
        setPain(draft.pain || "");
        setCalories(draft.calories || "");
        setNotes(draft.notes || "");
        setExercises(draft.exercises.length ? draft.exercises : buildExercises(draft.routine, sorted));
        setEditingId(draft.id);
        setIntelligence(`Rutina en curso recuperada: ${draft.routineName}.`);
        const matchingTemplate = savedTemplates.find((template) => template.name === draft.routineName);
        if (matchingTemplate) setSelectedTemplateId(matchingTemplate.id);
      } else {
        setExercises(buildExercises("4", sorted));
      }
      const profileRaw = localStorage.getItem(PROFILE_KEY);
      const profile = profileRaw ? JSON.parse(profileRaw) : {};
      setWeeklyTarget(Math.max(1, Math.min(7, Number(profile.gymDaysPerWeek) || 4)));
    } catch {
      setExercises(buildExercises("4", []));
    } finally {
      setDraftReady(true);
    }
    getCloudCollection<GymSession>("/gym/sessions", "sessions")
      .then((cloudSessions) => {
        if (!alive || !cloudSessions.length) return;
        const sorted = sortSessions(cloudSessions);
        setHistory(sorted);
        if (!localStorage.getItem(DRAFT_KEY)) setExercises(buildExercises("4", sorted));
        safeSaveGymLocal(sorted);
      })
      .catch(() => undefined);
    getCloudCollection<GymTemplate>("/gym/templates", "templates")
      .then((cloudTemplates) => {
        if (!alive || !cloudTemplates.length) return;
        const sorted = sortTemplates(cloudTemplates);
        setTemplates(sorted);
        localStorage.setItem(TEMPLATES_KEY, JSON.stringify(sorted));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!draftReady || !date || !exercises.length || (!builderOpen && !editingId.startsWith("gym-draft"))) return;
    const draft = buildDraftSession();
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, id: editingId || draft.id, intelligence: buildIntelligence(draft) }));
    } catch {
      // Keep the visible routine in memory if the browser storage is full.
    }
  }, [draftReady, builderOpen, date, routine, customRoutineName, selectedTemplateId, duration, intensity, painLevel, pain, calories, notes, exercises, editingId]);

  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);
  const routineName = selectedTemplate?.name || (routine === "custom" && customRoutineName ? customRoutineName : routines[routine].name);
  const latest = history.find((session) => selectedTemplate ? session.routineName === selectedTemplate.name : session.routine === routine);
  const loadUnit = `${unit}·rep`;
  const exerciseVolume = (exercise: ExerciseDraft) => exercise.weights.reduce((sum, weight, index) => sum + ((Number(weight) || 0) * repsForLoad(exercise.repsBySet?.[index] ?? exercise.reps)), 0);
  const sessionVolume = (session: Pick<GymSession, "exercises">) => session.exercises.reduce((sum, exercise) => sum + exerciseVolume(exercise), 0);
  const completedSetsFor = (session: Pick<GymSession, "exercises">) => session.exercises.reduce((sum, exercise) => sum + exercise.weights.filter((weight) => Number(weight) > 0).length, 0);
  const exerciseSnapshot = (session: Pick<GymSession, "exercises">) =>
    session.exercises.map((exercise) => {
      const weights = exercise.weights.map((weight) => Number(weight) || 0);
      const loadedWeights = weights.filter((weight) => weight > 0);
      return {
        name: exercise.name,
        setsPlanned: exercise.sets,
        setsLoaded: loadedWeights.length,
        reps: exercise.repsBySet?.length ? exercise.repsBySet.join("/") : exercise.reps,
        maxWeight: loadedWeights.length ? Math.max(...loadedWeights) : 0,
        minWeight: loadedWeights.length ? Math.min(...loadedWeights) : 0,
        totalLoad: exerciseVolume(exercise),
        restSec: exercise.rest,
        note: exercise.note || "",
      };
    });
  const buildCoachContext = (session: GymSession) => {
    const sameRoutine = history
      .filter((item) => item.routineName === session.routineName && item.id !== session.id)
      .slice(0, 6);
    const previous = sameRoutine[0];
    const currentLoad = sessionVolume(session);
    const previousLoad = previous ? sessionVolume(previous) : 0;
    return {
      unit,
      current: {
        routineName: session.routineName,
        date: session.date,
        durationMin: session.duration,
        intensity: session.intensity,
        painLevel: session.painLevel,
        pain: session.pain,
        calories: session.calories,
        notes: session.notes,
        totalLoad: currentLoad,
        completedSets: completedSetsFor(session),
        exercises: exerciseSnapshot(session),
      },
      previousSameRoutine: previous
        ? {
            date: previous.date,
            totalLoad: previousLoad,
            loadDelta: currentLoad - previousLoad,
            loadDeltaPct: previousLoad ? Math.round(((currentLoad - previousLoad) / previousLoad) * 100) : null,
            intensity: previous.intensity,
            painLevel: previous.painLevel,
            exercises: exerciseSnapshot(previous),
          }
        : null,
      recentSameRoutine: sameRoutine.map((item) => ({
        date: item.date,
        totalLoad: sessionVolume(item),
        intensity: item.intensity,
        painLevel: item.painLevel,
      })),
    };
  };

  const stats = useMemo(() => {
    const currentWeek = getWeekKey(new Date());
    const weekSessions = history.filter((session) => getWeekKey(parseLocalDate(session.date)) === currentWeek);
    const completedTrainingDays = new Set(weekSessions.map((session) => session.date)).size;
    const weekMinutes = weekSessions.reduce((sum, session) => sum + session.duration, 0);
    const weekVolume = weekSessions.reduce(
      (sum, session) => sum + sessionVolume(session),
      0,
    );
    const previousWeek = new Date();
    previousWeek.setDate(previousWeek.getDate() - 7);
    const previousWeekKey = getWeekKey(previousWeek);
    const previousWeekSessions = history.filter((session) => getWeekKey(parseLocalDate(session.date)) === previousWeekKey);
    const previousWeekVolume = previousWeekSessions.reduce(
      (sum, session) => sum + sessionVolume(session),
      0,
    );
    const volume = sessionVolume({ exercises });
    const completedSets = exercises.reduce((sum, exercise) => sum + exercise.weights.filter((weight) => Number(weight) > 0).length, 0);

    return {
      volume,
      completedSets,
      completedTrainingDays,
      weeklyTarget,
      weeklyPercent: Math.min(100, Math.round((completedTrainingDays / weeklyTarget) * 100)),
      weekMinutes,
      volumeDelta: previousWeekVolume > 0 ? Math.round(((weekVolume - previousWeekVolume) / previousWeekVolume) * 100) : weekVolume > 0 ? 100 : 0,
      avgIntensity: history.length ? Math.round(history.reduce((sum, session) => sum + session.intensity, 0) / history.length) : intensity,
      avgRest: Math.round(exercises.reduce((sum, exercise) => sum + exercise.rest, 0) / Math.max(1, exercises.length)),
    };
  }, [exercises, history, intensity, weeklyTarget]);

  const changeRoutine = (nextRoutine: RoutineKey) => {
    setRoutine(nextRoutine);
    setSelectedTemplateId("");
    setCustomRoutineName(nextRoutine === "custom" ? "Personalizado" : "");
    setExercises(buildExercises(nextRoutine, history));
    setEditingId("");
    const previous = history.find((session) => session.routine === nextRoutine);
    setIntelligence(previous ? `Pesos cargados desde la sesion ${previous.date}.` : "Rutina base cargada desde IDG Training Pro v21.");
  };

  const applyTemplate = (templateId: string) => {
    const template = templates.find((item) => item.id === templateId);
    if (!template) {
      setSelectedTemplateId("");
      return;
    }
    setSelectedTemplateId(template.id);
    setCustomRoutineName(template.name);
    setRoutine("custom");
    setExercises(cloneExercises(template.exercises));
    setEditingId("");
    setIntelligence(`Plantilla personalizada cargada: ${template.name}. Puedes editarla y guardar una nueva version.`);
  };

  const startNewRoutine = () => {
    const name = window.prompt("Nombre de la nueva rutina", "Funcional / CrossFit");
    if (!name?.trim()) return;
    setRoutine("custom");
    setSelectedTemplateId("");
    setCustomRoutineName(name.trim());
    setExercises([
      { id: `custom-${Date.now()}-1`, name: "Ejercicio 1", sets: 3, reps: "10", repsBySet: ["10", "10", "10"], weights: ["", "", ""], rest: 60 },
      { id: `custom-${Date.now()}-2`, name: "Ejercicio 2", sets: 3, reps: "10", repsBySet: ["10", "10", "10"], weights: ["", "", ""], rest: 60 },
      { id: `custom-${Date.now()}-3`, name: "Ejercicio 3", sets: 3, reps: "10", repsBySet: ["10", "10", "10"], weights: ["", "", ""], rest: 60 },
    ]);
    setEditingId("");
    setBuilderOpen(true);
    setIntelligence(`Nueva rutina "${name.trim()}" creada. Agrega ejercicios, series y pesos; luego guardala como plantilla para usarla en Gym y Plan.`);
  };

  const saveCurrentTemplate = () => {
    const name = window.prompt("Nombre de la plantilla personalizada", routineName);
    if (!name?.trim()) return;
    const template: GymTemplate = {
      id: selectedTemplateId || `template-${Date.now()}`,
      name: name.trim(),
      focus: selectedTemplate?.focus || routines[routine].name,
      routineKey: routine,
      source: "user",
      exercises: cloneExercises(exercises),
      updatedAt: Date.now(),
    };
    const withoutCurrent = templates.filter((item) => item.id !== template.id);
    persistTemplates([template, ...withoutCurrent]);
    setSelectedTemplateId(template.id);
    setCustomRoutineName(template.name);
    setRoutine("custom");
    setIntelligence(`Plantilla "${template.name}" guardada. IDG Coach ya puede usar esta version personalizada como base.`);
  };

  const updateExercise = (id: string, patch: Partial<ExerciseDraft>) => {
    setSavedExerciseIds((current) => current.filter((item) => item !== id));
    setExercises((current) => current.map((exercise) => (exercise.id === id ? { ...exercise, ...patch } : exercise)));
  };

  const changeSets = (id: string, delta: number) => {
    setSavedExerciseIds((current) => current.filter((item) => item !== id));
    setExercises((current) =>
      current.map((exercise) => {
        if (exercise.id !== id) return exercise;
        const sets = Math.max(1, Math.min(10, exercise.sets + delta));
        return {
          ...exercise,
          sets,
          repsBySet: Array.from({ length: sets }, (_, index) => exercise.repsBySet?.[index] ?? exercise.reps),
          weights: Array.from({ length: sets }, (_, index) => exercise.weights[index] ?? ""),
        };
      }),
    );
  };

  const updateSetReps = (id: string, index: number, value: string) => {
    setSavedExerciseIds((current) => current.filter((item) => item !== id));
    setExercises((current) =>
      current.map((exercise) => {
        if (exercise.id !== id) return exercise;
        const repsBySet = Array.from({ length: exercise.sets }, (_, setIndex) => exercise.repsBySet?.[setIndex] ?? exercise.reps);
        repsBySet[index] = value;
        return { ...exercise, reps: repsBySet[0] || exercise.reps, repsBySet };
      }),
    );
  };

  const updateWeight = (id: string, index: number, value: string) => {
    setSavedExerciseIds((current) => current.filter((item) => item !== id));
    setExercises((current) =>
      current.map((exercise) => {
        if (exercise.id !== id) return exercise;
        const weights = [...exercise.weights];
        weights[index] = value;
        return { ...exercise, weights };
      }),
    );
  };

  const addExercise = () => {
    setExercises((current) => [
      ...current,
      { id: `custom-${Date.now()}`, name: `Ejercicio ${current.length + 1}`, sets: 3, reps: "10", repsBySet: ["10", "10", "10"], weights: ["", "", ""], rest: 60 },
    ]);
  };

  const deleteExercise = (id: string) => {
    setSavedExerciseIds((current) => current.filter((item) => item !== id));
    setExercises((current) => (current.length > 1 ? current.filter((exercise) => exercise.id !== id) : current));
  };

  const moveExercise = (id: string, direction: -1 | 1) => {
    setExercises((current) => {
      const index = current.findIndex((exercise) => exercise.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
    setIntelligence("Orden de ejercicios actualizado en la rutina actual.");
  };

  const buildIntelligence = (session: GymSession) => {
    const context = buildCoachContext(session);
    const loaded = context.current.exercises.filter((exercise) => exercise.maxWeight > 0).sort((a, b) => b.totalLoad - a.totalLoad);
    const top = loaded[0];
    const underLoaded = context.current.exercises.filter((exercise) => exercise.setsLoaded > 0 && exercise.setsLoaded < exercise.setsPlanned);
    const noLoad = context.current.exercises.filter((exercise) => exercise.setsLoaded === 0);
    const previous = context.previousSameRoutine;
    const previousExercises = new Map(previous?.exercises.map((exercise) => [exercise.name.toLowerCase(), exercise]) || []);
    const progressed = context.current.exercises
      .map((exercise) => {
        const before = previousExercises.get(exercise.name.toLowerCase());
        if (!before) return null;
        const delta = exercise.totalLoad - before.totalLoad;
        return { name: exercise.name, delta, current: exercise.totalLoad, previous: before.totalLoad };
      })
      .filter((item): item is { name: string; delta: number; current: number; previous: number } => item !== null && item.previous > 0 && item.delta !== 0)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const mainChange = progressed[0];
    const deltaText = previous?.loadDeltaPct !== null && previous?.loadDeltaPct !== undefined
      ? ` Frente a la misma rutina anterior: ${previous.loadDeltaPct > 0 ? "+" : ""}${previous.loadDeltaPct}% de carga.`
      : "";
    const painText = session.painLevel > 3
      ? `dolor ${session.painLevel}/10${session.pain ? ` en ${session.pain}` : ""}; baja carga en ejercicios que lo disparen`
      : `dolor ${session.painLevel}/10; margen para progresar de forma controlada`;
    const missingText = noLoad.length
      ? ` Hay ${noLoad.length} ejercicios sin peso registrado: ${noLoad.slice(0, 2).map((exercise) => exercise.name).join(", ")}.`
      : underLoaded.length
        ? ` Series incompletas en ${underLoaded.slice(0, 2).map((exercise) => `${exercise.name} (${exercise.setsLoaded}/${exercise.setsPlanned})`).join(", ")}.`
        : "";
    const changeText = mainChange
      ? ` Cambio clave: ${mainChange.name} ${mainChange.delta > 0 ? "subio" : "bajo"} ${Math.abs(mainChange.delta).toFixed(0)} ${unit}.`
      : previous
        ? " Sin cambios fuertes por ejercicio frente al registro comparable."
        : " Sin historial comparable para esta rutina.";

    return top
      ? [
          `- Lectura: ${session.routineName} registro ${context.current.totalLoad.toFixed(0)} ${unit} en ${context.current.completedSets} series efectivas.${deltaText} Mayor carga: ${top.name} (${top.totalLoad.toFixed(0)} ${unit}, max ${top.maxWeight} ${unit}).`,
          `- Alerta: Intensidad ${session.intensity}/10 y ${painText}.${missingText}`,
          `- Proxima: ${changeText} ${session.intensity >= 8 ? "Mantén o sube solo el ejercicio más estable; no subas todo el día." : "Sube 1 serie o 5-10 lb solo en el ejercicio mejor tolerado."}`,
        ].join("\n")
      : `${session.routineName}: sin pesos registrados. La carga se calcula como peso x repeticiones en cada serie.`;
  };

  const usableIntelligence = (value: string) => {
    const text = String(value || "").trim();
    if (!text) return "";
    if (/^IDG Coach esta analizando/i.test(text)) return "";
    if (/guardado en la rutina actual/i.test(text)) return "";
    if (/Rutina base cargada/i.test(text)) return "";
    if (/Pesos cargados desde/i.test(text)) return "";
    if (/Selecciona una sesion/i.test(text)) return "";
    return text;
  };

  const buildDraftSession = (): GymSession => ({
    id: editingId || "draft",
    date,
    routine,
    routineName,
    duration: hhmmToMinutes(duration),
    intensity,
    painLevel,
    pain,
    calories,
    notes,
    exercises,
    intelligence: "",
    updatedAt: Date.now(),
  });

  const savedAnalysisFor = (session: GymSession) => usableIntelligence(session.aiAnalysis || "");

  const persistHistory = (sessions: GymSession[]) => {
    const nextHistory = sortSessions(sessions);
    setHistory(nextHistory);
    safeSaveGymLocal(nextHistory);
    saveCloudCollection("/gym/sessions", "sessions", nextHistory).catch(() => undefined);
    return nextHistory;
  };

  const requestGymAnalysis = async (session: GymSession) => {
    const response = await fetch("/api/gym-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session, unit, load: sessionVolume(session), context: buildCoachContext(session), history: history.slice(0, 8) }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudo analizar la rutina.");
    return data.analysis || buildIntelligence(session);
  };

  const analyzeRoutine = async () => {
    const draft = buildDraftSession();
    setIntelligence("IDG Coach esta analizando carga, intensidad y coherencia de la rutina...");
    try {
      setIntelligence(await requestGymAnalysis(draft));
    } catch {
      setIntelligence(buildIntelligence(draft));
    }
    window.requestAnimationFrame(() => {
      document.querySelector(".gym-intelligence-card")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  };

  const analyzeSessionFromHistory = async (session: GymSession, forceNew = false) => {
    const existing = savedAnalysisFor(session) || usableIntelligence(session.intelligence);
    setBuilderOpen(false);
    setSelectedSessionId(session.id);
    setShowAI(true);
    window.requestAnimationFrame(() => {
      intelligenceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    if (existing && !forceNew) {
      if (!savedAnalysisFor(session)) {
        persistHistory(history.map((item) => (item.id === session.id ? { ...session, aiAnalysis: existing, intelligence: existing, aiAcknowledgedAt: undefined, aiGeneratedAt: new Date().toISOString(), updatedAt: Date.now() } : item)));
      }
      setIntelligence(existing);
      return;
    }

    setAiLoadingId(session.id);
    try {
      const analysis = await requestGymAnalysis(session);
      const updatedSession: GymSession = {
        ...session,
        intelligence: analysis,
        aiAnalysis: analysis,
        aiGeneratedAt: new Date().toISOString(),
        aiAcknowledgedAt: undefined,
        updatedAt: Date.now(),
      };
      persistHistory(history.map((item) => (item.id === session.id ? updatedSession : item)));
      setIntelligence(analysis);
    } catch {
      const analysis = buildIntelligence(session);
      const updatedSession: GymSession = {
        ...session,
        intelligence: analysis,
        aiAnalysis: analysis,
        aiGeneratedAt: new Date().toISOString(),
        aiAcknowledgedAt: undefined,
        updatedAt: Date.now(),
      };
      persistHistory(history.map((item) => (item.id === session.id ? updatedSession : item)));
      setIntelligence(analysis);
    } finally {
      setAiLoadingId("");
    }
  };

  const markSessionAnalysisRead = (session: GymSession) => {
    const nextSession = { ...session, aiAcknowledgedAt: new Date().toISOString(), updatedAt: Date.now() };
    persistHistory(history.map((item) => (item.id === session.id ? nextSession : item)));
    setShowAI(false);
  };

  const toggleBuilder = () => {
    setBuilderOpen((open) => {
      const nextOpen = !open;
      if (nextOpen) {
        setSelectedSessionId("");
      }
      return nextOpen;
    });
  };

  const saveSession = () => {
    const session: GymSession = {
      id: editingId || `gym-${Date.now()}`,
      date,
      routine,
      routineName,
      duration: hhmmToMinutes(duration),
      intensity,
      painLevel,
      pain,
      calories,
      notes,
      exercises,
      intelligence: "",
      updatedAt: Date.now(),
    };
    session.intelligence = usableIntelligence(intelligence) || buildIntelligence(session);
    session.aiAnalysis = usableIntelligence(intelligence) || "";
    session.aiGeneratedAt = session.aiAnalysis ? new Date().toISOString() : undefined;
    session.aiAcknowledgedAt = undefined;

    const withoutCurrent = history.filter((item) => item.id !== session.id);
    persistHistory([session, ...withoutCurrent]);
    localStorage.removeItem(DRAFT_KEY);
    setIntelligence(session.intelligence);
    setBuilderOpen(false);
    setEditingId("");
  };

  const saveExercise = (exerciseId: string) => {
    const exercise = exercises.find((item) => item.id === exerciseId);
    if (!exercise) return;
    const session: GymSession = { ...buildDraftSession(), id: editingId || `gym-draft-${Date.now()}` };
    session.intelligence = usableIntelligence(intelligence) || buildIntelligence(session);
    setEditingId(session.id);
    localStorage.setItem(DRAFT_KEY, JSON.stringify(session));
    setSavedExerciseIds((current) => Array.from(new Set([...current, exerciseId])));
    setIntelligence(`${exercise.name} guardado en la rutina actual. La sesion completa se guarda solo con "Guardar sesion".`);
  };

  const editSession = (session: GymSession) => {
    const matchingTemplate = templates.find((template) => template.name === session.routineName);
    setSelectedTemplateId(matchingTemplate?.id || "");
    setCustomRoutineName(matchingTemplate ? matchingTemplate.name : session.routine === "custom" ? session.routineName : "");
    setRoutine(session.routine);
    setDate(session.date);
    setDuration(minutesToHHMM(session.duration));
    setIntensity(session.intensity);
    setPainLevel(session.painLevel);
    setPain(session.pain);
    setCalories(session.calories);
    setNotes(session.notes);
    setExercises(session.exercises);
    setEditingId(session.id);
    setSelectedSessionId("");
    setBuilderOpen(true);
    setIntelligence(session.intelligence || buildIntelligence(session));
  };

  const viewSession = (session: GymSession) => {
    setBuilderOpen(false);
    setEditingId("");
    setInlineEditingId("");
    setInlineDraft(null);
    setIntelligence(savedAnalysisFor(session) || usableIntelligence(session.intelligence) || buildIntelligence(session));
    setShowAI(!session.aiAcknowledgedAt);
    setSelectedSessionId((current) => (current === session.id ? "" : session.id));
  };

  const startInlineEdit = (session: GymSession) => {
    setInlineEditingId(session.id);
    setInlineDraft({
      ...session,
      exercises: session.exercises.map((exercise) => ({ ...exercise, weights: [...exercise.weights] })),
    });
  };

  const updateInlineExercise = (id: string, patch: Partial<ExerciseDraft>) => {
    setInlineDraft((current) =>
      current
        ? {
            ...current,
            exercises: current.exercises.map((exercise) => (exercise.id === id ? { ...exercise, ...patch } : exercise)),
          }
        : current,
    );
  };

  const changeInlineSets = (id: string, delta: number) => {
    setInlineDraft((current) =>
      current
        ? {
            ...current,
            exercises: current.exercises.map((exercise) => {
              if (exercise.id !== id) return exercise;
              const sets = Math.max(1, Math.min(10, exercise.sets + delta));
              return {
                ...exercise,
                sets,
                repsBySet: Array.from({ length: sets }, (_, index) => exercise.repsBySet?.[index] ?? exercise.reps),
                weights: Array.from({ length: sets }, (_, index) => exercise.weights[index] ?? ""),
              };
            }),
          }
        : current,
    );
  };

  const updateInlineSetReps = (id: string, index: number, value: string) => {
    setInlineDraft((current) =>
      current
        ? {
            ...current,
            exercises: current.exercises.map((exercise) => {
              if (exercise.id !== id) return exercise;
              const repsBySet = Array.from({ length: exercise.sets }, (_, setIndex) => exercise.repsBySet?.[setIndex] ?? exercise.reps);
              repsBySet[index] = value;
              return { ...exercise, reps: repsBySet[0] || exercise.reps, repsBySet };
            }),
          }
        : current,
    );
  };

  const updateInlineWeight = (id: string, index: number, value: string) => {
    setInlineDraft((current) =>
      current
        ? {
            ...current,
            exercises: current.exercises.map((exercise) => {
              if (exercise.id !== id) return exercise;
              const weights = [...exercise.weights];
              weights[index] = value;
              return { ...exercise, weights };
            }),
          }
        : current,
    );
  };

  const saveInlineSession = () => {
    if (!inlineDraft) return;
    const session: GymSession = {
      ...inlineDraft,
      intelligence: usableIntelligence(inlineDraft.aiAnalysis || inlineDraft.intelligence) || buildIntelligence(inlineDraft),
      updatedAt: Date.now(),
    };
    persistHistory(history.map((item) => (item.id === session.id ? session : item)));
    setIntelligence(session.intelligence);
    setInlineEditingId("");
    setInlineDraft(null);
  };

  const deleteSession = (id: string) => {
    persistHistory(history.filter((session) => session.id !== id));
    deleteCloudItem(`/gym/sessions/${encodeURIComponent(id)}`).catch(() => undefined);
  };

  const selectedSession = history.find((session) => session.id === selectedSessionId) || null;
  const selectedSessionAnalysis = selectedSession ? savedAnalysisFor(selectedSession) || usableIntelligence(selectedSession.intelligence) : "";

  return (
    <>
      <TopNav title="Gym" />
      <main className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-4 lg:p-6">
        <div className="grid grid-cols-1 gap-4">
          <section className="gym-main grid min-w-0 gap-4">
            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.35fr_1fr]">
                <div>
                  <h2 className="text-lg font-black text-slate-900">Resumen de la semana</h2>
                  <div className="mt-6 grid grid-cols-2 gap-5 md:grid-cols-4">
                    {[
                      ["▣", stats.completedTrainingDays, "Entrenos", "text-blue-600", "bg-blue-50"],
                      ["◴", formatDurationLong(stats.weekMinutes), "Tiempo total", "text-emerald-600", "bg-emerald-50"],
                      ["↗", `${stats.volumeDelta > 0 ? "+" : ""}${stats.volumeDelta}%`, "Carga", "text-violet-600", "bg-violet-50"],
                      ["☆", stats.weeklyPercent >= 75 ? "Excelente" : "En progreso", "Consistencia", "text-green-600", "bg-green-50"],
                    ].map(([icon, value, label, color, bg]) => (
                      <article className="border-r border-slate-200 last:border-r-0" key={label}>
                        <div className={`grid h-10 w-10 place-items-center rounded-full ${bg} ${color} mb-4 text-lg font-black`}>{icon}</div>
                        <strong className="block text-2xl font-black text-slate-900">{value}</strong>
                        <span className="mt-1 block text-sm font-semibold text-slate-500">{label}</span>
                      </article>
                    ))}
                  </div>
                </div>

                <div className="border-t border-slate-200 pt-5 xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0">
                  <h2 className="text-lg font-black text-slate-900">Progreso semanal</h2>
                  <div className="mt-6 grid grid-cols-7 gap-4 text-center">
                    {["L", "M", "M", "J", "V", "S", "D"].map((day, index) => {
                      const today = new Date();
                      const monday = new Date(today);
                      const weekday = monday.getDay() || 7;
                      monday.setDate(monday.getDate() - weekday + 1 + index);
                      const key = localISODate(monday);
                      const completed = history.some((session) => session.date === key);
                      return (
                        <div key={`${day}-${index}`}>
                          <span className="text-sm font-black text-slate-500">{day}</span>
                          <div className={`mx-auto mt-4 grid h-8 w-8 place-items-center rounded-full border-2 text-sm font-black ${
                            completed ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 bg-white text-slate-300"
                          }`}>
                            {completed ? "✓" : ""}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-5 flex items-center justify-between text-sm font-black">
                    <span className="text-slate-500">{stats.completedTrainingDays} / {stats.weeklyTarget} entrenos completados</span>
                    <span className="text-emerald-600">{stats.weeklyPercent}%</span>
                  </div>
                </div>
              </div>
            </section>

            <section className="app-card gym-builder-card rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex w-full items-center justify-between gap-4 text-left">
                <div>
                  <span className="text-xs font-black uppercase tracking-wide text-slate-500">Iniciar rutina</span>
                  <strong className="mt-1 block text-xl font-black text-slate-900">{routineName}</strong>
                  <small className="mt-1 block text-sm text-slate-500">{latest ? `Ultima guardada: ${latest.date}` : "Rutina base cargada desde HTML v21"}</small>
                </div>
                <span className="flex flex-wrap justify-end gap-2">
                  <button className="rounded-lg bg-white px-3 py-2 text-sm font-black text-blue-600 ring-1 ring-blue-100" type="button" onClick={startNewRoutine}>
                    Nueva rutina
                  </button>
                  <button className="rounded-lg bg-blue-50 px-3 py-2 text-sm font-black text-blue-600" type="button" onClick={toggleBuilder}>
                    {builderOpen ? "Cerrar rutina" : "Iniciar rutina"}
                  </button>
                </span>
              </div>

              {builderOpen ? (
                <>
                  <div className="gym-toolbar mt-4 grid grid-cols-1 items-end gap-3 lg:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)_auto_150px_130px_130px]">
                    <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500">Rutina<select className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-800" value={routine} onChange={(event) => changeRoutine(event.target.value as RoutineKey)}>{Object.entries(routines).map(([key, value]) => <option key={key} value={key}>{value.name}</option>)}</select></label>
                    <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500">Plantilla usuario<select className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-800" value={selectedTemplateId} onChange={(event) => applyTemplate(event.target.value)}><option value="">Sin plantilla</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
                    <div className="unit-switch flex h-10 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">{(["kg", "lbs"] as const).map((value) => <button className="min-w-12 px-3 text-sm font-black" key={value} type="button" style={unit === value ? { background: value === "lbs" ? "#ea580c" : "#2563eb", color: "#ffffff" } : undefined} onClick={() => setUnit(value)}>{value}</button>)}</div>
                    <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500">Fecha<input className="h-10 rounded-lg border border-slate-200 px-3 text-sm text-slate-800" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
                    <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500">Duracion HH:MM<input className="h-10 rounded-lg border border-slate-200 px-3 text-sm text-slate-800" value={duration} onChange={(event) => setDuration(event.target.value)} /></label>
                    <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500">Calorias<input className="h-10 rounded-lg border border-slate-200 px-3 text-sm text-slate-800" type="number" value={calories} placeholder="Opcional" onChange={(event) => setCalories(event.target.value)} /></label>
                  </div>
                  {routine === "custom" ? (
                    <label className="mt-3 grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500">Nombre de rutina<input className="h-10 rounded-lg border border-blue-200 bg-blue-50/40 px-3 text-sm font-semibold normal-case text-slate-900" value={customRoutineName} placeholder="Funcional, CrossFit, Core, movilidad..." onChange={(event) => setCustomRoutineName(event.target.value)} /></label>
                  ) : null}

                  <div className="my-3 grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
                    <div className="grid gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black uppercase tracking-wide text-slate-500">Intensidad</span>
                        <strong className="text-sm font-black text-slate-900">{intensity}/10</strong>
                      </div>
                      <div className="grid grid-cols-10 gap-1">
                        {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
                          <button
                            className="h-8 rounded-md text-xs font-black text-white transition"
                            key={value}
                            style={{
                              background: value <= intensity ? scaleColor(value) : "#dbe4f0",
                              color: value <= intensity ? "white" : "#64748b",
                            }}
                            type="button"
                            onClick={() => setIntensity(value)}
                          >
                            {value}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black uppercase tracking-wide text-slate-500">Dolor</span>
                        <strong className="text-sm font-black text-slate-900">{painLevel}/10</strong>
                      </div>
                      <div className="grid grid-cols-10 gap-1">
                        {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
                          <button
                            className="h-8 rounded-full text-xs font-black transition"
                            key={value}
                            style={{
                              background: value <= painLevel ? scaleColor(value) : "#dbe4f0",
                              color: value <= painLevel ? "white" : "#64748b",
                            }}
                            type="button"
                            onClick={() => setPainLevel(value)}
                          >
                            {value}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="gym-context grid gap-3 md:grid-cols-[180px_1fr]">
                    <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500">Zona dolor<input className="h-10 rounded-lg border border-slate-200 px-3 text-sm text-slate-800" value={pain} placeholder="Opcional" onChange={(event) => setPain(event.target.value)} /></label>
                    <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500">Notas<input className="h-10 rounded-lg border border-slate-200 px-3 text-sm text-slate-800" value={notes} placeholder="Sensaciones o ajustes" onChange={(event) => setNotes(event.target.value)} /></label>
                  </div>

                  <div className="gym-exercise-head mt-4 hidden grid-cols-[minmax(170px,1fr)_92px_minmax(360px,1.8fr)_72px_174px] gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-black uppercase tracking-wide text-blue-100 min-[900px]:grid">
                    <span>Ejercicio</span><span>Series</span><span>Reps y peso por serie ({unit})</span><span>Descanso</span><span>Acciones</span>
                  </div>

                  <div className="gym-exercise-list mt-3 grid gap-2">
                    {exercises.map((exercise, index) => {
                      const exerciseSaved = savedExerciseIds.includes(exercise.id);
                      return (
                      <article className={`gym-exercise-row grid items-center gap-2 rounded-lg border p-3 min-[900px]:grid-cols-[minmax(170px,1fr)_92px_minmax(360px,1.8fr)_72px_174px] ${exerciseSaved ? "gym-exercise-row-saved border-emerald-200 bg-emerald-50/80" : "border-slate-200 bg-slate-50"}`} key={exercise.id}>
                        <div className="gym-exercise-name grid grid-cols-[30px_minmax(0,1fr)] items-center gap-2"><span className={`grid h-7 w-7 place-items-center rounded-lg text-sm font-black text-white ${exerciseSaved ? "bg-emerald-600" : "bg-green-500"}`}>{exerciseSaved ? "OK" : index + 1}</span><input className="h-9 rounded-lg border border-slate-200 px-2 text-sm font-semibold text-slate-900" value={exercise.name} onChange={(event) => updateExercise(exercise.id, { name: event.target.value })} /></div>
                        <div className="series-ctrl"><button type="button" onClick={() => changeSets(exercise.id, -1)}>-</button><strong>{exercise.sets}</strong><button type="button" onClick={() => changeSets(exercise.id, 1)}>+</button></div>
                        <div className="weight-chips" data-unit={unit}>{exercise.weights.map((weight, setIndex) => <label key={`${exercise.id}-${setIndex}`}><span>S{setIndex + 1}</span><input aria-label={`Repeticiones serie ${setIndex + 1}`} className="set-reps-input" inputMode="numeric" placeholder="rep" type="text" value={exercise.repsBySet?.[setIndex] ?? exercise.reps} onChange={(event) => updateSetReps(exercise.id, setIndex, event.target.value)} /><input aria-label={`Peso serie ${setIndex + 1}`} className="set-weight-input" inputMode="decimal" placeholder={unit} type="number" value={weight} onChange={(event) => updateWeight(exercise.id, setIndex, event.target.value)} /></label>)}</div>
                        <input className="compact-input rest-input h-9 rounded-lg border border-slate-200 px-2 text-center text-sm text-slate-800" value={secondsToMMSS(exercise.rest)} onChange={(event) => updateExercise(exercise.id, { rest: mmssToSeconds(event.target.value) })} />
                        <div className="gym-row-actions">
                          <button className={exerciseSaved ? "gym-exercise-saved-btn" : ""} type="button" title={exerciseSaved ? "Ejercicio guardado" : "Guardar ejercicio"} onClick={() => saveExercise(exercise.id)}>{exerciseSaved ? <span className="text-[10px] font-black">OK</span> : <Icon name="save" />}</button>
                          <button type="button" title="Subir ejercicio" disabled={index === 0} onClick={() => moveExercise(exercise.id, -1)}><Icon name="up" /></button>
                          <button type="button" title="Bajar ejercicio" disabled={index === exercises.length - 1} onClick={() => moveExercise(exercise.id, 1)}><Icon name="down" /></button>
                          <button type="button" title="Editar"><Icon name="edit" /></button>
                          <button type="button" title="Eliminar" onClick={() => deleteExercise(exercise.id)}><Icon name="trash" /></button>
                        </div>
                      </article>
                      );
                    })}
                  </div>

                  <button className="add-exercise-btn mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-blue-200 bg-blue-50 p-3 font-black text-blue-600" type="button" onClick={addExercise}><Icon name="plus" /> Agregar ejercicio</button>
                  <div className="gym-form-actions mt-3 flex justify-end gap-3">
                    <button className="ai-main-btn inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-3 font-black text-white" type="button" onClick={analyzeRoutine}>
                      <Icon name="spark" /> Analizar rutina
                    </button>
                    <button className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-4 py-3 font-black text-blue-700" type="button" onClick={saveCurrentTemplate}>
                      <Icon name="save" /> Guardar plantilla
                    </button>
                    <button className="save-main-btn inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-3 font-black text-white" type="button" onClick={saveSession}>
                      <Icon name="save" /> Guardar sesion
                    </button>
                  </div>
                </>
              ) : null}
            </section>

            {builderOpen ? (
            <section className="gym-intelligence-card rounded-lg border border-blue-100 bg-blue-50 p-5 shadow-sm">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="flex min-w-0 gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-blue-600 text-white">
                    <Icon name="spark" />
                  </span>
                  <div>
                    <p className="text-xs font-black uppercase tracking-wide text-blue-700">Analisis de rutina</p>
                    <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">{intelligence}</p>
                  </div>
                </div>
                <div className="grid shrink-0 grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-white px-3 py-2">
                    <p className="text-[10px] font-black uppercase text-slate-400">Series</p>
                    <p className="mt-1 text-lg font-black text-slate-900">{stats.completedSets}</p>
                  </div>
                  <div className="rounded-lg bg-white px-3 py-2">
                    <p className="text-[10px] font-black uppercase text-slate-400">Carga</p>
                    <p className="mt-1 text-lg font-black text-slate-900">{stats.volume.toFixed(0)} {loadUnit}</p>
                  </div>
                  <div className="rounded-lg bg-white px-3 py-2">
                    <p className="text-[10px] font-black uppercase text-slate-400">Intensidad</p>
                    <p className="mt-1 text-lg font-black text-slate-900">{intensity}/10</p>
                  </div>
                </div>
              </div>
            </section>
            ) : null}

            <section ref={intelligenceRef} className="rounded-lg border border-blue-100 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-blue-600 text-white">
                    <Icon name="spark" />
                  </span>
                  <div>
                    <p className="text-xs font-black uppercase tracking-wide text-blue-600">IDG Intelligence</p>
                    <h2 className="mt-1 text-lg font-black text-slate-900">IDG Intelligence</h2>
                    <p className="mt-1 text-sm font-semibold text-slate-500">
                      {selectedSession
                        ? `${selectedSession.routineName} - analisis guardado para esta sesion.`
                        : "Selecciona una sesion del historial para generar o revisar el analisis IA."}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="rounded-lg bg-blue-600 px-4 py-3 text-sm font-black text-white disabled:bg-blue-300"
                    type="button"
                    disabled={!selectedSession || aiLoadingId === selectedSession?.id}
                    onClick={() => selectedSession && analyzeSessionFromHistory(selectedSession, true)}
                  >
                    {selectedSession && aiLoadingId === selectedSession.id ? "Analizando..." : selectedSessionAnalysis ? "Reanalizar sesion" : "Generar analisis IA"}
                  </button>
                </div>
              </div>

              {selectedSession && selectedSessionAnalysis && !showAI ? (
                <button
                  className="mt-4 w-full rounded-lg border border-slate-200 bg-slate-50 p-4 text-left text-sm font-black text-slate-700 hover:bg-slate-100"
                  type="button"
                  onClick={() => setShowAI(true)}
                >
                  Hay un analisis IA guardado. Toca para volver a leerlo.
                </button>
              ) : selectedSession && selectedSessionAnalysis ? (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="whitespace-pre-wrap text-sm font-semibold leading-7 text-slate-700">{selectedSessionAnalysis}</p>
                  <div className="mt-4 flex justify-end border-t border-slate-200 pt-4">
                    <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-black text-white" type="button" onClick={() => markSessionAnalysisRead(selectedSession)}>
                      Enterado
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-500">
                  {selectedSession ? "Esta sesion aun no tiene analisis IA. Genera uno para conservarlo en el historial." : "El analisis aparecera aqui cuando elijas una sesion."}
                </div>
              )}
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-black text-slate-900">Historial de sesiones</h2>
                  <p className="mt-1 text-sm font-semibold text-slate-500">{history.length ? `${history.length} sesiones guardadas` : "Aun no hay sesiones guardadas."}</p>
                </div>
                <button className="text-sm font-black text-blue-600" type="button">Ver todas</button>
              </div>
              <div className="grid gap-3">
                {history.map((session) => {
                  const volume = sessionVolume(session);
                  const date = parseLocalDate(session.date);
                  const day = date.getDate().toString().padStart(2, "0");
                  const setCount = session.exercises.reduce((sum, exercise) => sum + exercise.sets, 0);
                  const selected = selectedSessionId === session.id;
                  const isInlineEditing = inlineEditingId === session.id && inlineDraft?.id === session.id;
                  const detailSession = isInlineEditing && inlineDraft ? inlineDraft : session;
                  const detailVolume = sessionVolume(detailSession);
                  const detailSetCount = detailSession.exercises.reduce((sum, exercise) => sum + exercise.sets, 0);
                  const aiAnalysis = savedAnalysisFor(session);
                  const aiLabel = aiAnalysis ? (session.aiAcknowledgedAt ? "IA leida" : "IA nueva") : "Generar IA";
                  return (
                    <Fragment key={session.id}>
                      <article className={`grid grid-cols-1 items-start gap-3 rounded-lg border bg-white p-4 shadow-sm min-[1100px]:grid-cols-[58px_minmax(180px,1fr)_110px_100px_100px_100px_180px] min-[1100px]:items-center min-[1100px]:gap-4 ${selected ? "border-blue-200" : "border-slate-200"}`}>
                        <div className="border-l-4 border-emerald-500 pl-4">
                          <strong className="block text-2xl font-black leading-none text-slate-900">{day}</strong>
                          <span className="mt-1 block text-xs font-black uppercase text-slate-500">{shortMonth(session.date)}</span>
                        </div>
                        <div className="min-w-0">
                          <strong className="block text-base font-black text-slate-900">{session.routineName}</strong>
                          <span className="mt-1 block text-sm font-semibold text-slate-500">{session.exercises.length} ejercicios - {setCount} series</span>
                        </div>
                        <div><strong className="block text-base font-black text-slate-900">{volume.toFixed(0)} {loadUnit}</strong><span className="text-xs font-semibold text-slate-500">Carga</span></div>
                        <div><strong className="block text-base font-black text-slate-900">{session.intensity * 10}%</strong><span className="text-xs font-semibold text-slate-500">Intensidad</span></div>
                        <div><strong className="block text-base font-black text-slate-900">{minutesToHHMM(session.duration)}</strong><span className="text-xs font-semibold text-slate-500">Duracion</span></div>
                        <div>
                          <strong className={`block text-sm font-black ${aiAnalysis && !session.aiAcknowledgedAt ? "text-blue-600" : "text-slate-900"}`}>{aiLabel}</strong>
                          <span className="text-xs font-semibold text-slate-500">{aiAnalysis ? "Analisis guardado" : "Sin analisis IA"}</span>
                        </div>
                        <div className="flex justify-start gap-2 min-[1100px]:justify-end">
                          <button className="grid h-10 w-10 place-items-center rounded-lg border border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100" type="button" title={selected ? "Cerrar sesion" : "Ver sesion"} onClick={() => viewSession(session)}><Icon name="eye" /></button>
                          <button className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 disabled:opacity-60" type="button" onClick={() => analyzeSessionFromHistory(session)} disabled={aiLoadingId === session.id}>{aiLoadingId === session.id ? "..." : aiAnalysis ? "Ver IA" : "IA"}</button>
                          <button className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50" type="button" title="Editar" onClick={() => editSession(session)}><Icon name="edit" /></button>
                          <button className="grid h-10 w-10 place-items-center rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100" type="button" title="Eliminar" onClick={() => deleteSession(session.id)}><Icon name="trash" /></button>
                        </div>
                      </article>
                      {selected ? (
                        <article className="rounded-lg border border-blue-100 bg-white p-5 shadow-sm">
                          <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 lg:flex-row lg:items-start lg:justify-between">
                            <div>
                              <p className="text-xs font-black uppercase tracking-wide text-blue-700">Detalle de rutina</p>
                              <h3 className="mt-1 text-xl font-black text-slate-900">{detailSession.routineName}</h3>
                              <p className="mt-1 text-sm font-semibold text-slate-500">{detailSession.date} - {detailSession.exercises.length} ejercicios - {detailSetCount} series</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {isInlineEditing ? (
                                <>
                                  <button className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-600" type="button" onClick={() => { setInlineEditingId(""); setInlineDraft(null); }}>Cancelar</button>
                                  <button className="rounded-lg bg-green-600 px-4 py-2 text-sm font-black text-white" type="button" onClick={saveInlineSession}>Guardar cambios</button>
                                </>
                              ) : (
                                <button className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-black text-white" type="button" onClick={() => startInlineEdit(session)}>
                                  <Icon name="edit" /> Editar aqui
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="mt-4 grid gap-3 md:grid-cols-4">
                            <div className="rounded-lg bg-slate-50 p-3">
                              <p className="text-[10px] font-black uppercase text-slate-400">Carga</p>
                              <p className="mt-1 text-lg font-black text-slate-900">{detailVolume.toFixed(0)} {loadUnit}</p>
                            </div>
                            <label className="rounded-lg bg-slate-50 p-3">
                              <p className="text-[10px] font-black uppercase text-slate-400">Duracion</p>
                              {isInlineEditing ? (
                                <input className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm font-black text-slate-900" value={minutesToHHMM(detailSession.duration)} onChange={(event) => setInlineDraft((current) => current ? { ...current, duration: hhmmToMinutes(event.target.value) } : current)} />
                              ) : (
                                <p className="mt-1 text-lg font-black text-slate-900">{minutesToHHMM(detailSession.duration)}</p>
                              )}
                            </label>
                            <label className="rounded-lg bg-slate-50 p-3">
                              <p className="text-[10px] font-black uppercase text-slate-400">Intensidad</p>
                              {isInlineEditing ? (
                                <input className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm font-black text-slate-900" max="10" min="1" type="number" value={detailSession.intensity} onChange={(event) => setInlineDraft((current) => current ? { ...current, intensity: Math.max(1, Math.min(10, Number(event.target.value) || 1)) } : current)} />
                              ) : (
                                <p className="mt-1 text-lg font-black text-slate-900">{detailSession.intensity}/10</p>
                              )}
                            </label>
                            <label className="rounded-lg bg-slate-50 p-3">
                              <p className="text-[10px] font-black uppercase text-slate-400">Dolor</p>
                              {isInlineEditing ? (
                                <input className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm font-black text-slate-900" max="10" min="0" type="number" value={detailSession.painLevel} onChange={(event) => setInlineDraft((current) => current ? { ...current, painLevel: Math.max(0, Math.min(10, Number(event.target.value) || 0)) } : current)} />
                              ) : (
                                <p className="mt-1 text-lg font-black text-slate-900">{detailSession.painLevel}/10</p>
                              )}
                            </label>
                          </div>

                          <section className="mt-4 rounded-lg border border-blue-100 bg-blue-50 p-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex gap-3">
                                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-blue-600 text-white"><Icon name="spark" /></span>
                                <div>
                                  <p className="text-xs font-black uppercase tracking-wide text-blue-700">IDG Intelligence</p>
                                  <p className="mt-1 text-sm font-semibold leading-6 text-slate-700">{savedAnalysisFor(detailSession) ? "Esta sesion tiene analisis IA guardado." : "Genera un analisis especifico para esta sesion."}</p>
                                </div>
                              </div>
                              <button
                                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-black text-white disabled:bg-blue-300"
                                type="button"
                                disabled={aiLoadingId === detailSession.id}
                                onClick={() => analyzeSessionFromHistory(detailSession, !savedAnalysisFor(detailSession))}
                              >
                                {aiLoadingId === detailSession.id ? "Analizando..." : savedAnalysisFor(detailSession) ? "Ver IA" : "Generar IA"}
                              </button>
                            </div>
                          </section>

                          <section className="mt-4">
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <h4 className="text-sm font-black text-slate-900">Ejercicios, series, repeticiones y pesos</h4>
                              <span className="text-xs font-black text-slate-400">{unit.toUpperCase()}</span>
                            </div>
                            <div className="grid gap-2">
                              {detailSession.exercises.map((exercise, index) => {
                                const maxWeight = Math.max(...exercise.weights.map((weight) => Number(weight) || 0));
                                return (
                                  <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 xl:grid-cols-[34px_minmax(170px,1fr)_92px_minmax(360px,1.6fr)_88px]" key={`${detailSession.id}-${exercise.id}`}>
                                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-500 text-sm font-black text-white">{index + 1}</span>
                                    {isInlineEditing ? (
                                      <input className="h-9 rounded-lg border border-slate-200 px-2 text-sm font-black text-slate-900" value={exercise.name} onChange={(event) => updateInlineExercise(exercise.id, { name: event.target.value })} />
                                    ) : (
                                      <div>
                                        <p className="text-sm font-black text-slate-900">{exercise.name}</p>
                                        {exercise.note ? <p className="mt-1 text-xs font-semibold text-slate-500">{exercise.note}</p> : null}
                                      </div>
                                    )}
                                    <div>
                                      <p className="mb-1 text-[10px] font-black uppercase text-slate-400">Series</p>
                                      {isInlineEditing ? (
                                        <div className="series-ctrl"><button type="button" onClick={() => changeInlineSets(exercise.id, -1)}>-</button><strong>{exercise.sets}</strong><button type="button" onClick={() => changeInlineSets(exercise.id, 1)}>+</button></div>
                                      ) : (
                                        <p className="text-sm font-black text-slate-900">{exercise.sets}</p>
                                      )}
                                    </div>
                                    <div>
                                      <p className="mb-1 text-[10px] font-black uppercase text-slate-400">Reps y peso por serie</p>
                                      <div className="weight-chips" data-unit={unit}>
                                        {exercise.weights.map((weight, setIndex) => (
                                          <label key={`${exercise.id}-${setIndex}`}>
                                            <span>S{setIndex + 1}</span>
                                            {isInlineEditing ? (
                                              <>
                                                <input aria-label={`Repeticiones serie ${setIndex + 1}`} className="set-reps-input" inputMode="numeric" placeholder="rep" type="text" value={exercise.repsBySet?.[setIndex] ?? exercise.reps} onChange={(event) => updateInlineSetReps(exercise.id, setIndex, event.target.value)} />
                                                <input aria-label={`Peso serie ${setIndex + 1}`} className="set-weight-input" inputMode="decimal" placeholder={unit} type="number" value={weight} onChange={(event) => updateInlineWeight(exercise.id, setIndex, event.target.value)} />
                                              </>
                                            ) : (
                                              <span className="px-1 font-black text-slate-900">{exercise.repsBySet?.[setIndex] ?? exercise.reps} x {weight || "--"}</span>
                                            )}
                                          </label>
                                        ))}
                                      </div>
                                    </div>
                                    <div>
                                      <p className="mb-1 text-[10px] font-black uppercase text-slate-400">Max</p>
                                      <p className="text-sm font-black text-blue-700">{maxWeight > 0 ? `${maxWeight} ${unit}` : "--"}</p>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </section>

                          <label className="mt-4 block">
                            <p className="mb-1 text-xs font-black uppercase tracking-wide text-slate-500">Notas</p>
                            {isInlineEditing ? (
                              <textarea className="min-h-24 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700 outline-none focus:border-blue-500" value={detailSession.notes} onChange={(event) => setInlineDraft((current) => current ? { ...current, notes: event.target.value } : current)} />
                            ) : detailSession.notes ? (
                              <p className="rounded-lg bg-slate-50 p-3 text-sm font-semibold text-slate-600">{detailSession.notes}</p>
                            ) : (
                              <p className="rounded-lg bg-slate-50 p-3 text-sm font-semibold text-slate-400">Sin notas registradas.</p>
                            )}
                          </label>
                        </article>
                      ) : null}
                    </Fragment>
                  );
                })}
              </div>
            </section>
          </section>
        </div>
      </main>
    </>
  );
}
