"use client";

import TopNav from "@/components/TopNav";
import { getCloudCollection, saveCloudCollection } from "@/lib/cloud-sync";
import { Fragment, useEffect, useMemo, useState } from "react";

type RoutineKey = "1" | "2" | "3" | "4" | "5" | "wod" | "custom";

type ExerciseDraft = {
  id: string;
  name: string;
  sets: number;
  reps: string;
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
  updatedAt: number;
};

const STORAGE_KEY = "idg_gym_sessions_json";
const DRAFT_KEY = "idg_gym_current_session_json";
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
    exercises: Array.isArray(session.exercises) ? session.exercises : [],
    updatedAt: Number(session.updatedAt) || Date.now(),
  };
}

function sortSessions(sessions: GymSession[]) {
  return sessions.map(normalizeSession).sort((a, b) => parseLocalDate(b.date).getTime() - parseLocalDate(a.date).getTime() || b.updatedAt - a.updatedAt);
}

function scaleColor(value: number) {
  if (value <= 3) return "#22c55e";
  if (value <= 6) return "#facc15";
  if (value <= 8) return "#f97316";
  return "#ef4444";
}

function Icon({ name }: { name: "save" | "edit" | "trash" | "chart" | "spark" | "plus" | "chev" | "eye" }) {
  const common = { fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeWidth: 1.8 };

  return (
    <svg aria-hidden="true" className="h-4 w-4 shrink-0" viewBox="0 0 24 24">
      {name === "save" ? <path d="M5 4h12l2 2v14H5zM8 4v6h8V4M8 20v-6h8v6" {...common} /> : null}
      {name === "edit" ? <path d="m4 16 11-11 4 4L8 20H4zM13 7l4 4" {...common} /> : null}
      {name === "trash" ? <path d="M4 7h16M9 7V4h6v3M8 10v8M12 10v8M16 10v8M6 7l1 14h10l1-14" {...common} /> : null}
      {name === "chart" ? <path d="M5 19V9M12 19V5M19 19v-7M4 19h16" {...common} /> : null}
      {name === "eye" ? <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" {...common} /> : null}
      {name === "spark" ? <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" {...common} /> : null}
      {name === "plus" ? <path d="M12 5v14M5 12h14" {...common} /> : null}
      {name === "chev" ? <path d="m6 9 6 6 6-6" {...common} /> : null}
    </svg>
  );
}

export default function GymModule() {
  const [routine, setRoutine] = useState<RoutineKey>("4");
  const [unit, setUnit] = useState<"kg" | "lbs">("kg");
  const [date, setDate] = useState("");
  const [duration, setDuration] = useState("01:15");
  const [intensity, setIntensity] = useState(7);
  const [painLevel, setPainLevel] = useState(0);
  const [pain, setPain] = useState("");
  const [calories, setCalories] = useState("");
  const [notes, setNotes] = useState("");
  const [exercises, setExercises] = useState<ExerciseDraft[]>([]);
  const [history, setHistory] = useState<GymSession[]>([]);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [inlineEditingId, setInlineEditingId] = useState("");
  const [inlineDraft, setInlineDraft] = useState<GymSession | null>(null);
  const [intelligence, setIntelligence] = useState("Selecciona una sesion guardada o guarda una rutina para generar recomendaciones.");
  const [weeklyTarget, setWeeklyTarget] = useState(4);

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
        rest: old?.rest ?? exercise.rest,
        weights: Array.from({ length: sets }, (_, setIndex) => old?.weights[setIndex] ?? ""),
      };
    });
  };

  useEffect(() => {
    let alive = true;
    setDate(localISODate());
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const saved: GymSession[] = raw ? JSON.parse(raw) : [];
      const sorted = sortSessions(saved);
      setHistory(sorted);
      const draftRaw = localStorage.getItem(DRAFT_KEY);
      const draft = draftRaw ? normalizeSession(JSON.parse(draftRaw) as GymSession) : null;
      if (draft) {
        setRoutine(draft.routine);
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
  }, [draftReady, builderOpen, date, routine, duration, intensity, painLevel, pain, calories, notes, exercises, editingId]);

  const routineName = routines[routine].name;
  const latest = history.find((session) => session.routine === routine);

  const stats = useMemo(() => {
    const currentWeek = getWeekKey(new Date());
    const weekSessions = history.filter((session) => getWeekKey(parseLocalDate(session.date)) === currentWeek);
    const completedTrainingDays = new Set(weekSessions.map((session) => session.date)).size;
    const weekMinutes = weekSessions.reduce((sum, session) => sum + session.duration, 0);
    const weekVolume = weekSessions.reduce(
      (sum, session) =>
        sum + session.exercises.reduce(
          (sessionSum, exercise) => sessionSum + exercise.weights.reduce((acc, weight) => acc + (Number(weight) || 0), 0),
          0,
        ),
      0,
    );
    const previousWeek = new Date();
    previousWeek.setDate(previousWeek.getDate() - 7);
    const previousWeekKey = getWeekKey(previousWeek);
    const previousWeekSessions = history.filter((session) => getWeekKey(parseLocalDate(session.date)) === previousWeekKey);
    const previousWeekVolume = previousWeekSessions.reduce(
      (sum, session) =>
        sum + session.exercises.reduce(
          (sessionSum, exercise) => sessionSum + exercise.weights.reduce((acc, weight) => acc + (Number(weight) || 0), 0),
          0,
        ),
      0,
    );
    const volume = exercises.reduce((sum, exercise) => {
      const setSum = exercise.weights.reduce((acc, weight) => acc + (Number(weight) || 0), 0);
      return sum + setSum;
    }, 0);
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
    setExercises(buildExercises(nextRoutine, history));
    setEditingId("");
    const previous = history.find((session) => session.routine === nextRoutine);
    setIntelligence(previous ? `Pesos cargados desde la sesion ${previous.date}.` : "Rutina base cargada desde IDG Training Pro v21.");
  };

  const updateExercise = (id: string, patch: Partial<ExerciseDraft>) => {
    setExercises((current) => current.map((exercise) => (exercise.id === id ? { ...exercise, ...patch } : exercise)));
  };

  const changeSets = (id: string, delta: number) => {
    setExercises((current) =>
      current.map((exercise) => {
        if (exercise.id !== id) return exercise;
        const sets = Math.max(1, Math.min(10, exercise.sets + delta));
        return { ...exercise, sets, weights: Array.from({ length: sets }, (_, index) => exercise.weights[index] ?? "") };
      }),
    );
  };

  const updateWeight = (id: string, index: number, value: string) => {
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
      { id: `custom-${Date.now()}`, name: `Ejercicio ${current.length + 1}`, sets: 3, reps: "10", weights: ["", "", ""], rest: 60 },
    ]);
  };

  const deleteExercise = (id: string) => {
    setExercises((current) => (current.length > 1 ? current.filter((exercise) => exercise.id !== id) : current));
  };

  const buildIntelligence = (session: GymSession) => {
    const loaded = session.exercises
      .map((exercise) => ({
        name: exercise.name,
        max: Math.max(...exercise.weights.map((weight) => Number(weight) || 0)),
      }))
      .filter((exercise) => exercise.max > 0)
      .sort((a, b) => b.max - a.max);
    const top = loaded[0];
    const painText = session.painLevel > 3 ? "reduce carga y cuida el dolor reportado" : "puedes sostener progresion controlada";

    return top
      ? `${session.routineName}: mayor carga en ${top.name} (${top.max} ${unit}). Intensidad ${session.intensity}/10; ${painText}. Proxima sesion: aumenta solo si terminas con tecnica limpia.`
      : `${session.routineName}: sesion guardada sin pesos. Completa pesos por serie para recomendaciones de carga.`;
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

  const analyzeRoutine = () => {
    const analysis = buildIntelligence(buildDraftSession());
    setIntelligence(analysis);
    window.requestAnimationFrame(() => {
      document.querySelector(".gym-intelligence-card")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
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
    session.intelligence = buildIntelligence(session);

    const withoutCurrent = history.filter((item) => item.id !== session.id);
    const nextHistory = sortSessions([session, ...withoutCurrent]);
    setHistory(nextHistory);
    safeSaveGymLocal(nextHistory);
    saveCloudCollection("/gym/sessions", "sessions", nextHistory).catch(() => undefined);
    localStorage.removeItem(DRAFT_KEY);
    setIntelligence(session.intelligence);
    setBuilderOpen(false);
    setEditingId("");
  };

  const saveExercise = (exerciseId: string) => {
    const exercise = exercises.find((item) => item.id === exerciseId);
    if (!exercise) return;
    const session: GymSession = { ...buildDraftSession(), id: editingId || `gym-draft-${Date.now()}` };
    session.intelligence = buildIntelligence(session);
    setEditingId(session.id);
    localStorage.setItem(DRAFT_KEY, JSON.stringify(session));
    setIntelligence(`${exercise.name} guardado en la rutina actual. La sesion completa se guarda solo con "Guardar sesion".`);
  };

  const editSession = (session: GymSession) => {
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
    setIntelligence(session.intelligence || buildIntelligence(session));
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
              return { ...exercise, sets, weights: Array.from({ length: sets }, (_, index) => exercise.weights[index] ?? "") };
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
      intelligence: buildIntelligence(inlineDraft),
      updatedAt: Date.now(),
    };
    const nextHistory = sortSessions(history.map((item) => (item.id === session.id ? session : item)));
    setHistory(nextHistory);
    safeSaveGymLocal(nextHistory);
    saveCloudCollection("/gym/sessions", "sessions", nextHistory).catch(() => undefined);
    setIntelligence(session.intelligence);
    setInlineEditingId("");
    setInlineDraft(null);
  };

  const deleteSession = (id: string) => {
    const nextHistory = history.filter((session) => session.id !== id);
    setHistory(nextHistory);
    safeSaveGymLocal(nextHistory);
    saveCloudCollection("/gym/sessions", "sessions", nextHistory).catch(() => undefined);
  };

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
                      ["↗", `${stats.volumeDelta > 0 ? "+" : ""}${stats.volumeDelta}%`, "Volumen", "text-violet-600", "bg-violet-50"],
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
              <button className="flex w-full items-center justify-between gap-4 text-left" type="button" onClick={toggleBuilder}>
                <div>
                  <span className="text-xs font-black uppercase tracking-wide text-slate-500">Iniciar rutina</span>
                  <strong className="mt-1 block text-xl font-black text-slate-900">{routineName}</strong>
                  <small className="mt-1 block text-sm text-slate-500">{latest ? `Ultima guardada: ${latest.date}` : "Rutina base cargada desde HTML v21"}</small>
                </div>
                <span className="rounded-lg bg-blue-50 px-3 py-2 text-sm font-black text-blue-600">
                  {builderOpen ? "Cerrar rutina" : "Iniciar rutina"}
                </span>
              </button>

              {builderOpen ? (
                <>
                  <div className="gym-toolbar mt-4 grid grid-cols-1 items-end gap-3 lg:grid-cols-[minmax(220px,1fr)_auto_150px_130px_130px]">
                    <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500">Rutina<select className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-800" value={routine} onChange={(event) => changeRoutine(event.target.value as RoutineKey)}>{Object.entries(routines).map(([key, value]) => <option key={key} value={key}>{value.name}</option>)}</select></label>
                    <div className="unit-switch flex h-10 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">{(["kg", "lbs"] as const).map((value) => <button className={`min-w-12 px-3 text-sm font-black ${unit === value ? "bg-blue-600 text-white" : "text-slate-500"}`} key={value} type="button" onClick={() => setUnit(value)}>{value}</button>)}</div>
                    <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500">Fecha<input className="h-10 rounded-lg border border-slate-200 px-3 text-sm text-slate-800" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
                    <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500">Duracion HH:MM<input className="h-10 rounded-lg border border-slate-200 px-3 text-sm text-slate-800" value={duration} onChange={(event) => setDuration(event.target.value)} /></label>
                    <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500">Calorias<input className="h-10 rounded-lg border border-slate-200 px-3 text-sm text-slate-800" type="number" value={calories} placeholder="Opcional" onChange={(event) => setCalories(event.target.value)} /></label>
                  </div>

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

                  <div className="gym-exercise-head mt-4 hidden grid-cols-[minmax(170px,1fr)_92px_54px_minmax(280px,1.5fr)_72px_108px] gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-black uppercase tracking-wide text-blue-100 min-[900px]:grid">
                    <span>Ejercicio</span><span>Series</span><span>Reps</span><span>Peso por serie ({unit})</span><span>Descanso</span><span>Acciones</span>
                  </div>

                  <div className="gym-exercise-list mt-3 grid gap-2">
                    {exercises.map((exercise, index) => (
                      <article className="gym-exercise-row grid items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 min-[900px]:grid-cols-[minmax(170px,1fr)_92px_54px_minmax(280px,1.5fr)_72px_108px]" key={exercise.id}>
                        <div className="gym-exercise-name grid grid-cols-[30px_minmax(0,1fr)] items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-lg bg-green-500 text-sm font-black text-white">{index + 1}</span><input className="h-9 rounded-lg border border-slate-200 px-2 text-sm font-semibold text-slate-900" value={exercise.name} onChange={(event) => updateExercise(exercise.id, { name: event.target.value })} /></div>
                        <div className="series-ctrl"><button type="button" onClick={() => changeSets(exercise.id, -1)}>-</button><strong>{exercise.sets}</strong><button type="button" onClick={() => changeSets(exercise.id, 1)}>+</button></div>
                        <input className="compact-input reps-input h-9 rounded-lg border border-slate-200 px-2 text-center text-sm text-slate-800" value={exercise.reps} onChange={(event) => updateExercise(exercise.id, { reps: event.target.value })} />
                        <div className="weight-chips">{exercise.weights.map((weight, setIndex) => <label key={`${exercise.id}-${setIndex}`}>S{setIndex + 1}<input type="number" value={weight} onChange={(event) => updateWeight(exercise.id, setIndex, event.target.value)} /></label>)}</div>
                        <input className="compact-input rest-input h-9 rounded-lg border border-slate-200 px-2 text-center text-sm text-slate-800" value={secondsToMMSS(exercise.rest)} onChange={(event) => updateExercise(exercise.id, { rest: mmssToSeconds(event.target.value) })} />
                        <div className="gym-row-actions">
                          <button type="button" title="Guardar ejercicio" onClick={() => saveExercise(exercise.id)}><Icon name="save" /></button>
                          <button type="button" title="Editar"><Icon name="edit" /></button>
                          <button type="button" title="Eliminar" onClick={() => deleteExercise(exercise.id)}><Icon name="trash" /></button>
                        </div>
                      </article>
                    ))}
                  </div>

                  <button className="add-exercise-btn mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-blue-200 bg-blue-50 p-3 font-black text-blue-600" type="button" onClick={addExercise}><Icon name="plus" /> Agregar ejercicio</button>
                  <div className="gym-form-actions mt-3 flex justify-end gap-3">
                    <button className="ai-main-btn inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-3 font-black text-white" type="button" onClick={analyzeRoutine}>
                      <Icon name="spark" /> Analizar rutina
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
                    <p className="text-[10px] font-black uppercase text-slate-400">Volumen</p>
                    <p className="mt-1 text-lg font-black text-slate-900">{stats.volume.toFixed(0)}</p>
                  </div>
                  <div className="rounded-lg bg-white px-3 py-2">
                    <p className="text-[10px] font-black uppercase text-slate-400">Intensidad</p>
                    <p className="mt-1 text-lg font-black text-slate-900">{intensity}/10</p>
                  </div>
                </div>
              </div>
            </section>
            ) : null}

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
                  const volume = session.exercises.reduce((sum, exercise) => sum + exercise.weights.reduce((acc, weight) => acc + (Number(weight) || 0), 0), 0);
                  const date = parseLocalDate(session.date);
                  const day = date.getDate().toString().padStart(2, "0");
                  const setCount = session.exercises.reduce((sum, exercise) => sum + exercise.sets, 0);
                  const selected = selectedSessionId === session.id;
                  const isInlineEditing = inlineEditingId === session.id && inlineDraft?.id === session.id;
                  const detailSession = isInlineEditing && inlineDraft ? inlineDraft : session;
                  const detailVolume = detailSession.exercises.reduce((sum, exercise) => sum + exercise.weights.reduce((acc, weight) => acc + (Number(weight) || 0), 0), 0);
                  const detailSetCount = detailSession.exercises.reduce((sum, exercise) => sum + exercise.sets, 0);
                  return (
                    <Fragment key={session.id}>
                      <article className={`grid grid-cols-1 items-start gap-3 rounded-lg border bg-white p-4 shadow-sm min-[1100px]:grid-cols-[58px_minmax(180px,1fr)_110px_100px_100px_minmax(90px,1fr)_132px] min-[1100px]:items-center min-[1100px]:gap-4 ${selected ? "border-blue-200" : "border-slate-200"}`}>
                        <div className="border-l-4 border-emerald-500 pl-4">
                          <strong className="block text-2xl font-black leading-none text-slate-900">{day}</strong>
                          <span className="mt-1 block text-xs font-black uppercase text-slate-500">{shortMonth(session.date)}</span>
                        </div>
                        <div className="min-w-0">
                          <strong className="block text-base font-black text-slate-900">{session.routineName}</strong>
                          <span className="mt-1 block text-sm font-semibold text-slate-500">{session.exercises.length} ejercicios - {setCount} series</span>
                        </div>
                        <div><strong className="block text-base font-black text-slate-900">{volume.toFixed(0)} {unit}</strong><span className="text-xs font-semibold text-slate-500">Volumen</span></div>
                        <div><strong className="block text-base font-black text-slate-900">{session.intensity * 10}%</strong><span className="text-xs font-semibold text-slate-500">Intensidad</span></div>
                        <div><strong className="block text-base font-black text-slate-900">{minutesToHHMM(session.duration)}</strong><span className="text-xs font-semibold text-slate-500">Duracion</span></div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-blue-600" style={{ width: `${session.intensity * 10}%` }} /></div>
                        <div className="flex justify-start gap-2 min-[1100px]:justify-end">
                          <button className="grid h-10 w-10 place-items-center rounded-lg border border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100" type="button" title={selected ? "Cerrar sesion" : "Ver sesion"} onClick={() => viewSession(session)}><Icon name="eye" /></button>
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
                              <p className="text-[10px] font-black uppercase text-slate-400">Volumen</p>
                              <p className="mt-1 text-lg font-black text-slate-900">{detailVolume.toFixed(0)} {unit}</p>
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
                            <div className="flex gap-3">
                              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-blue-600 text-white"><Icon name="spark" /></span>
                              <div>
                                <p className="text-xs font-black uppercase tracking-wide text-blue-700">Analisis IA de la rutina</p>
                                <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">{buildIntelligence(detailSession)}</p>
                              </div>
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
                                  <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 xl:grid-cols-[34px_minmax(170px,1fr)_92px_90px_minmax(280px,1.4fr)_88px]" key={`${detailSession.id}-${exercise.id}`}>
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
                                    <label>
                                      <p className="mb-1 text-[10px] font-black uppercase text-slate-400">Reps</p>
                                      {isInlineEditing ? (
                                        <input className="h-9 w-full rounded-lg border border-slate-200 px-2 text-center text-sm font-black text-slate-900" value={exercise.reps} onChange={(event) => updateInlineExercise(exercise.id, { reps: event.target.value })} />
                                      ) : (
                                        <p className="text-sm font-black text-slate-900">{exercise.reps}</p>
                                      )}
                                    </label>
                                    <div>
                                      <p className="mb-1 text-[10px] font-black uppercase text-slate-400">Peso por serie</p>
                                      <div className="weight-chips">
                                        {exercise.weights.map((weight, setIndex) => (
                                          <label key={`${exercise.id}-${setIndex}`}>
                                            S{setIndex + 1}
                                            {isInlineEditing ? (
                                              <input type="number" value={weight} onChange={(event) => updateInlineWeight(exercise.id, setIndex, event.target.value)} />
                                            ) : (
                                              <span className="px-1 font-black text-slate-900">{weight || "--"}</span>
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
