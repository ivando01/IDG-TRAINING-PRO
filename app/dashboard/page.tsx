"use client";

import { AppIcon } from "@/components/Brand";
import KPICard from "@/components/KPICard";
import SessionCard from "@/components/SessionCard";
import TopNav from "@/components/TopNav";
import { getCloudCollection, getCloudProfile, getSyncStatus, retryPendingSyncs } from "@/lib/cloud-sync";
import { cardioTrimpFromZones } from "@/lib/training-load";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type SportType = "gym" | "running" | "cycling";

type DashboardSession = {
  id: string;
  title: string;
  date: string;
  type: SportType;
  duration: number;
  distance?: number;
  calories?: number;
  averageHR?: number;
  status: "completed" | "planned" | "in-progress";
  load: number;
  zoneTotals?: Array<{ zoneKey?: string; seconds?: number; label?: string }>;
};

type DashboardData = {
  profile: Record<string, unknown>;
  sessions: DashboardSession[];
  weight: Array<Record<string, unknown>>;
  intelligence: Array<Record<string, unknown>>;
};

type DashboardSyncStatus = ReturnType<typeof getSyncStatus>;

function readJSON(key: string, fallback: unknown = []) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function num(value: unknown) {
  const parsed = Number(String(value || "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isTrainingActivity(item: Record<string, unknown>) {
  if (item.countsTowardTraining === false || item.activityKind === "support") return false;
  const text = `${String(item.activitySubType || "")} ${String(item.name || "")}`.toLowerCase();
  return !/walk|hike|caminar|caminata|senderismo/.test(text);
}

function startOfWeek(date = new Date()) {
  const next = new Date(date);
  next.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  next.setHours(0, 0, 0, 0);
  return next;
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

function inCurrentWeek(dateText?: string) {
  if (!dateText) return false;
  const date = parseLocalDate(dateText);
  return date >= startOfWeek() && date <= new Date();
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

function loadDashboardData(): DashboardData {
  const profile = readJSON("idg_profile_json", readJSON("iv_profile", {})) as Record<string, unknown>;
  const gym = readJSON("idg_gym_sessions_json", []) as Array<Record<string, unknown>>;
  const running = (readJSON("idg_running_activities_json", readJSON("iv_run", [])) as Array<Record<string, unknown>>).filter(isTrainingActivity);
  const cycling = readJSON("idg_cycling_activities_json", readJSON("iv_bike", [])) as Array<Record<string, unknown>>;
  const weight = readJSON("idg_weight_records_json", []) as Array<Record<string, unknown>>;
  const intelligence = readJSON("idg_intelligence_history_json", []) as Array<Record<string, unknown>>;

  const gymSessions: DashboardSession[] = gym.map((item) => ({
    id: String(item.id || crypto.randomUUID()),
    title: String(item.routineName || "Gym"),
    date: String(item.date || localISODate()).slice(0, 10),
    type: "gym",
    duration: num(item.duration),
    calories: num(item.calories) || undefined,
    status: "completed",
    load: Math.round(num(item.duration) * (num(item.intensity) || 6)),
  }));

  const runSessions: DashboardSession[] = running.map((item) => {
    const metrics = (item.metrics || {}) as Record<string, unknown>;
    return {
      id: String(item.id || crypto.randomUUID()),
      title: String(item.name || "Running"),
      date: String(item.date || item.startTime || localISODate()).slice(0, 10),
      type: "running",
      duration: minutesFromActivity(item),
      distance: num(metrics.distanceKm) || undefined,
      calories: num(metrics.calories) || undefined,
      averageHR: num(metrics.avgHr) || undefined,
      status: "completed",
      load: cardioLoad(item, 150),
      zoneTotals: item.zoneTotals as DashboardSession["zoneTotals"],
    };
  });

  const bikeSessions: DashboardSession[] = cycling.map((item) => {
    const metrics = (item.metrics || {}) as Record<string, unknown>;
    return {
      id: String(item.id || crypto.randomUUID()),
      title: String(item.name || "Ciclismo"),
      date: String(item.date || item.startTime || localISODate()).slice(0, 10),
      type: "cycling",
      duration: minutesFromActivity(item),
      distance: num(metrics.distanceKm) || undefined,
      calories: num(metrics.calories) || undefined,
      averageHR: num(metrics.avgHr) || undefined,
      status: "completed",
      load: Math.round(cardioTrimpFromZones(item.zoneTotals) || num(metrics.tss) || cardioLoad(item, 145)),
      zoneTotals: item.zoneTotals as DashboardSession["zoneTotals"],
    };
  });

  return {
    profile,
    weight,
    intelligence,
    sessions: [...gymSessions, ...runSessions, ...bikeSessions].sort((a, b) => parseLocalDate(b.date).getTime() - parseLocalDate(a.date).getTime()),
  };
}

function WeeklyChart({ sessions }: { sessions: DashboardSession[] }) {
  const start = startOfWeek();
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = localISODate(date);
    const daySessions = sessions.filter((session) => session.date.slice(0, 10) === key);
    const bySport = {
      gym: daySessions.filter((session) => session.type === "gym").reduce((sum, item) => sum + item.load, 0),
      running: daySessions.filter((session) => session.type === "running").reduce((sum, item) => sum + item.load, 0),
      cycling: daySessions.filter((session) => session.type === "cycling").reduce((sum, item) => sum + item.load, 0),
    };
    return {
      label: ["L", "M", "M", "J", "V", "S", "D"][index],
      date,
      load: daySessions.reduce((sum, item) => sum + item.load, 0),
      sessions: daySessions.length,
      minutes: daySessions.reduce((sum, item) => sum + item.duration, 0),
      bySport,
    };
  });
  const max = Math.max(1, ...days.map((day) => day.load));
  const total = days.reduce((sum, day) => sum + day.load, 0);
  const activeDays = days.filter((day) => day.sessions).length;
  const sportColors = {
    gym: "bg-blue-500",
    running: "bg-emerald-500",
    cycling: "bg-slate-800",
  };
  return (
    <div className="rounded-lg bg-slate-50 p-4">
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-[11px] font-black uppercase text-slate-400">Carga acumulada</p>
          <p className="mt-1 text-xl font-black text-slate-900">{total || "--"}</p>
        </div>
        <div>
          <p className="text-[11px] font-black uppercase text-slate-400">Dias activos</p>
          <p className="mt-1 text-xl font-black text-slate-900">{activeDays}/7</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs font-bold text-slate-500">
          <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-blue-500" /> Gym</span>
          <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-emerald-500" /> Run</span>
          <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-slate-800" /> Bike</span>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-2">
        {days.map((day, index) => {
          const height = day.load ? Math.max(18, (day.load / max) * 86) : 8;
          return (
            <div className="rounded-lg border border-slate-200 bg-white p-2" key={`${day.label}-${index}`} title={`${day.sessions} sesiones · ${day.minutes} min · carga ${day.load}`}>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-black text-slate-700">{day.label}</span>
                <span className="text-[10px] font-bold text-slate-400">{day.date.getDate()}</span>
              </div>
              <div className="flex h-24 items-end">
                <div className="flex w-full flex-col justify-end overflow-hidden rounded-md bg-slate-100" style={{ height: `${height}%` }}>
                  {(["cycling", "running", "gym"] as const).map((type) => {
                    const value = day.bySport[type];
                    if (!value || !day.load) return null;
                    return <div className={sportColors[type]} key={type} style={{ height: `${Math.max(16, (value / day.load) * 100)}%` }} />;
                  })}
                </div>
              </div>
              <div className="mt-2 text-center">
                <p className="text-sm font-black text-slate-900">{day.load || 0}</p>
                <p className="text-[10px] font-bold text-slate-400">{day.sessions} ses.</p>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-xs font-semibold leading-5 text-slate-500">
        La carga combina sRPE en gym y TRIMP por zonas en cardio; ciclismo prioriza TSS cuando existe.
      </p>
    </div>
  );
}

function ZoneSummary({ sessions }: { sessions: DashboardSession[] }) {
  const totals = new Map<string, number>();
  sessions.forEach((session) => {
    session.zoneTotals?.forEach((zone) => {
      const key = zone.zoneKey || "NA";
      totals.set(key, (totals.get(key) || 0) + num(zone.seconds));
    });
  });
  const colors: Record<string, string> = { Z1: "bg-slate-400", Z2: "bg-green-500", Z3: "bg-yellow-400", Z4: "bg-orange-500", Z5: "bg-red-500", NA: "bg-slate-300" };
  const total = Array.from(totals.values()).reduce((sum, value) => sum + value, 0);
  const labels: Record<string, string> = {
    Z1: "Calentamiento",
    Z2: "Quema grasa",
    Z3: "Aerobico",
    Z4: "Anaerobico",
    Z5: "Extremo",
  };
  const rows = ["Z1", "Z2", "Z3", "Z4", "Z5"].map((zone) => ({ zone, label: labels[zone], pct: total ? Math.round(((totals.get(zone) || 0) / total) * 100) : 0 }));
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.zone}>
          <div className="mb-1 flex justify-between text-xs font-bold">
            <span>{row.zone} {row.label}</span>
            <span className="text-slate-500">{row.pct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div className={`h-full rounded-full ${colors[row.zone]}`} style={{ width: `${row.pct}%` }} />
          </div>
        </div>
      ))}
      {!total ? <p className="rounded-lg bg-slate-50 p-3 text-xs font-bold text-slate-400">Importa actividades con frecuencia cardiaca para ver zonas reales.</p> : null}
    </div>
  );
}

function formatSyncTime(value: string | null) {
  if (!value) return "Aun sin sync";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Aun sin sync";
  return date.toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" });
}

function DashboardSyncCenter({ status, onRetry }: { status: DashboardSyncStatus; onRetry: () => void }) {
  const hasError = Boolean(status.lastError);
  const isCloudReady = status.cloud && !hasError;
  const stateLabel = isCloudReady ? "Nube activa" : status.cloud ? "Nube con alerta" : "Solo local";
  const stateClass = isCloudReady
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : status.cloud
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-slate-200 bg-slate-50 text-slate-600";
  const dotClass = isCloudReady ? "bg-emerald-500" : status.cloud ? "bg-amber-500" : "bg-slate-400";

  return (
    <section className="rounded-lg border border-white/15 bg-white/10 p-4 text-white shadow-sm backdrop-blur">
      <div className="flex flex-col gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-extrabold ${stateClass}`}>
              <span className={`h-2 w-2 rounded-full ${dotClass}`} />
              {stateLabel}
            </span>
            {status.pendingCount ? (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-extrabold text-amber-700">
                {status.pendingCount} pendientes
              </span>
            ) : (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-extrabold text-slate-600">
                0 pendientes
              </span>
            )}
          </div>
          <h2 className="mt-3 text-xl font-extrabold text-white">Centro de sincronizacion</h2>
          <p className="mt-1 text-sm font-semibold leading-6 text-blue-100">
            Tu estado de nube y cache local en una sola lectura.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px]">
          <div className="rounded-lg border border-white/10 bg-white/10 px-3 py-2">
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-blue-100">Ultima sync</p>
            <p className="mt-1 text-sm font-extrabold text-white">{formatSyncTime(status.lastSyncAt)}</p>
          </div>
          <button
            className="rounded-lg bg-white px-4 py-3 text-sm font-extrabold text-slate-950 disabled:bg-white/30 disabled:text-white/60"
            disabled={!status.cloud && !status.pendingCount}
            type="button"
            onClick={onRetry}
          >
            Reintentar sync
          </button>
        </div>
      </div>

      {hasError ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-800">
          <strong className="font-extrabold">Ultima alerta:</strong> {status.lastError}
        </div>
      ) : null}
    </section>
  );
}

function DashboardExecutiveHero({
  readiness,
  consistency,
  totalMinutes,
  hardSessions,
  weekSessions,
  syncStatus,
  onRetrySync,
}: {
  readiness: number;
  consistency: number;
  totalMinutes: number;
  hardSessions: number;
  weekSessions: DashboardSession[];
  syncStatus: DashboardSyncStatus;
  onRetrySync: () => void;
}) {
  const nextRecommendation =
    hardSessions > 2
      ? "Recuperacion activa + movilidad"
      : consistency < 50
        ? "Retomar consistencia con sesion corta"
        : "Base aerobica + fuerza controlada";
  const nextDetail =
    hardSessions > 2
      ? "Hay carga alta acumulada; baja intensidad y protege articulaciones."
      : consistency < 50
        ? "Una sesion de 30-45 min mantiene el habito sin sobrecargar la semana."
        : "Mantente en zonas eficientes y evita picos innecesarios.";

  return (
    <section className="mb-6 overflow-hidden rounded-lg border border-slate-200 bg-[#06152f] text-white shadow-[0_22px_70px_rgba(15,23,42,0.18)]">
      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)] lg:p-6">
        <div className="relative overflow-hidden rounded-lg border border-white/10 bg-white/5 p-5">
          <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-emerald-400/20 blur-3xl" />
          <div className="relative">
            <p className="text-xs font-black uppercase tracking-wide text-emerald-300">IDG Coach · lectura de hoy</p>
            <h2 className="mt-3 max-w-3xl text-3xl font-black leading-tight tracking-tight sm:text-4xl lg:text-5xl">
              Entrena con una decision clara, no con ruido.
            </h2>
            <p className="mt-4 max-w-2xl text-sm font-semibold leading-6 text-blue-100 sm:text-base">
              {nextRecommendation}. {nextDetail}
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link className="rounded-lg bg-emerald-400 px-4 py-3 text-sm font-black text-slate-950" href="/modules/plan">
                Ver plan de hoy
              </Link>
              <Link className="rounded-lg border border-white/15 bg-white/10 px-4 py-3 text-sm font-black text-white" href="/modules/analytics">
                Preguntar al coach
              </Link>
            </div>
          </div>

          <div className="relative mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-white/10 bg-white/10 p-4">
              <p className="text-[10px] font-black uppercase tracking-wide text-blue-100">Readiness</p>
              <p className="mt-2 text-3xl font-black">{readiness}</p>
              <p className="mt-1 text-xs font-bold text-emerald-200">{readiness >= 75 ? "Bueno" : "Controlado"}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/10 p-4">
              <p className="text-[10px] font-black uppercase tracking-wide text-blue-100">Consistencia</p>
              <p className="mt-2 text-3xl font-black">{consistency}%</p>
              <p className="mt-1 text-xs font-bold text-blue-100">{weekSessions.length} sesiones esta semana</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/10 p-4">
              <p className="text-[10px] font-black uppercase tracking-wide text-blue-100">Tiempo</p>
              <p className="mt-2 text-3xl font-black">{Math.round(totalMinutes / 60)}h</p>
              <p className="mt-1 text-xs font-bold text-blue-100">{totalMinutes % 60} min acumulados</p>
            </div>
          </div>
        </div>

        <DashboardSyncCenter status={syncStatus} onRetry={onRetrySync} />
      </div>
    </section>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData>({ profile: {}, sessions: [], weight: [], intelligence: [] });
  const [syncStatus, setSyncStatus] = useState<DashboardSyncStatus>(() => getSyncStatus());

  useEffect(() => {
    let alive = true;
    setData(loadDashboardData());
    Promise.allSettled([
      getCloudProfile<Record<string, unknown>>(),
      getCloudCollection<Record<string, unknown>>("/gym/sessions", "sessions"),
      getCloudCollection<Record<string, unknown>>("/activities?sport=running", "activities"),
      getCloudCollection<Record<string, unknown>>("/activities?sport=cycling", "activities"),
      getCloudCollection<Record<string, unknown>>("/weight", "records"),
      getCloudCollection<Record<string, unknown>>("/intelligence", "entries"),
    ]).then((results) => {
      if (!alive) return;
      const [profileResult, gymResult, runResult, bikeResult, weightResult, intelligenceResult] = results;
      if (profileResult.status === "fulfilled" && profileResult.value) localStorage.setItem("idg_profile_json", JSON.stringify(profileResult.value));
      if (gymResult.status === "fulfilled" && gymResult.value.length) localStorage.setItem("idg_gym_sessions_json", JSON.stringify(gymResult.value));
      if (runResult.status === "fulfilled" && runResult.value.length) localStorage.setItem("idg_running_activities_json", JSON.stringify(runResult.value));
      if (bikeResult.status === "fulfilled" && bikeResult.value.length) localStorage.setItem("idg_cycling_activities_json", JSON.stringify(bikeResult.value));
      if (weightResult.status === "fulfilled" && weightResult.value.length) localStorage.setItem("idg_weight_records_json", JSON.stringify(weightResult.value));
      if (intelligenceResult.status === "fulfilled" && intelligenceResult.value.length) localStorage.setItem("idg_intelligence_history_json", JSON.stringify(intelligenceResult.value));
      setData(loadDashboardData());
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const refresh = () => setSyncStatus(getSyncStatus());
    refresh();
    window.addEventListener("idg-sync-status", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("idg-sync-status", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  async function handleRetrySync() {
    try {
      await retryPendingSyncs();
    } finally {
      setSyncStatus(getSyncStatus());
      setData(loadDashboardData());
    }
  }

  const weekSessions = useMemo(() => data.sessions.filter((session) => inCurrentWeek(session.date)), [data.sessions]);
  const totalLoad = weekSessions.reduce((sum, item) => sum + item.load, 0);
  const totalMinutes = weekSessions.reduce((sum, item) => sum + item.duration, 0);
  const target = (num(data.profile.gymDaysPerWeek) || 4) + (num(data.profile.runDaysPerWeek) || 2) + (num(data.profile.bikeDaysPerWeek) || 2);
  const consistency = target ? Math.min(100, Math.round((weekSessions.length / target) * 100)) : 0;
  const hardSessions = weekSessions.filter((item) => item.zoneTotals?.some((zone) => ["Z4", "Z5"].includes(String(zone.zoneKey)))).length;
  const readiness = Math.max(45, Math.min(95, 78 + (consistency >= 60 ? 6 : -6) - (hardSessions > 2 ? 8 : 0)));
  const latestWeight = data.weight[0];
  const recent = data.sessions.slice(0, 6);

  const bySport = {
    gym: weekSessions.filter((item) => item.type === "gym").length,
    running: weekSessions.filter((item) => item.type === "running").length,
    cycling: weekSessions.filter((item) => item.type === "cycling").length,
  };

  return (
    <>
      <TopNav title="Dashboard" />
      <main className="min-h-0 flex-1 overflow-y-auto bg-[#F8FAFC] p-4 lg:p-6">
        <DashboardExecutiveHero
          consistency={consistency}
          hardSessions={hardSessions}
          onRetrySync={handleRetrySync}
          readiness={readiness}
          syncStatus={syncStatus}
          totalMinutes={totalMinutes}
          weekSessions={weekSessions}
        />

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KPICard label="Carga Semanal" value={totalLoad || "--"} icon={<AppIcon name="analytics" className="h-5 w-5" />} trend={{ value: Math.max(0, consistency), direction: "up" }} color="blue" />
          <KPICard label="Estado Fisico" value={`${readiness}%`} icon={<AppIcon name="intelligence" className="h-5 w-5" />} trend={{ value: hardSessions, direction: hardSessions > 2 ? "down" : "up" }} color={hardSessions > 2 ? "orange" : "green"} />
          <KPICard label="Sesiones Semana" value={`${weekSessions.length}/${target}`} icon={<AppIcon name="calendar" className="h-5 w-5" />} trend={{ value: consistency, direction: "up" }} color="purple" />
          <KPICard label="Tiempo Total" value={`${Math.round(totalMinutes / 60)}h ${totalMinutes % 60}m`} icon={<AppIcon name="plan" className="h-5 w-5" />} color="orange" />
        </div>

        <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(340px,0.8fr)]">
          <section className="rounded-lg border border-slate-200 bg-white p-6">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-black text-slate-900">Semana actual</h3>
                <p className="text-sm font-semibold text-slate-500">Carga real por dia desde gym, running y ciclismo.</p>
              </div>
              <button className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-black text-white" type="button" onClick={() => setData(loadDashboardData())}>Actualizar</button>
            </div>
            <WeeklyChart sessions={weekSessions} />
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-6">
            <h3 className="mb-4 font-black text-slate-900">Zonas cardiacas</h3>
            <ZoneSummary sessions={weekSessions} />
          </section>
        </div>

        <div className="mb-6 grid gap-6 xl:grid-cols-3">
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h3 className="font-black text-slate-900">Distribucion semanal</h3>
            <div className="mt-4 grid gap-3">
              {[
                ["Gym", bySport.gym, "gym", "bg-blue-500"],
                ["Running", bySport.running, "running", "bg-emerald-500"],
                ["Ciclismo", bySport.cycling, "cycling", "bg-slate-800"],
              ].map(([label, value, icon, color]) => (
                <div className="flex items-center gap-3" key={String(label)}>
                  <div className="grid h-9 w-9 place-items-center rounded-lg bg-slate-50 text-slate-700"><AppIcon name={icon as "gym" | "running" | "cycling"} className="h-5 w-5" /></div>
                  <div className="flex-1">
                    <div className="mb-1 flex justify-between text-xs font-black"><span>{label}</span><span>{value} sesiones</span></div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full ${color}`} style={{ width: `${weekSessions.length ? (Number(value) / weekSessions.length) * 100 : 0}%` }} /></div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h3 className="font-black text-slate-900">Peso & cuerpo</h3>
            <div className="mt-4 rounded-lg bg-slate-50 p-4">
              <p className="text-xs font-black uppercase text-slate-500">Ultimo registro</p>
              <p className="mt-2 text-3xl font-black text-slate-900">{latestWeight?.kg ? `${latestWeight.kg} kg` : "--"}</p>
              <p className="mt-1 text-sm font-bold text-slate-500">Grasa {String(latestWeight?.fat || "--")}% · Musculo {String(latestWeight?.musclemass || latestWeight?.muscle || "--")}</p>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-black text-slate-900">IDG Intelligence</h3>
              <Link className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white" href="/modules/analytics">Abrir coach</Link>
            </div>
            <div className="mt-4 rounded-lg bg-blue-50 p-4">
              <p className="text-sm font-bold leading-6 text-blue-800">
                {data.intelligence[0]?.title ? String(data.intelligence[0].title) : "Genera un analisis global para ver recomendaciones cruzadas."}
              </p>
            </div>
          </section>
        </div>

        <section>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-black text-slate-900">Sesiones recientes</h3>
            <p className="text-sm font-bold text-slate-500">{data.sessions.length} registros totales</p>
          </div>
          <div className="grid grid-cols-1 gap-3">
            {recent.map((session) => <SessionCard key={`${session.type}-${session.id}`} {...session} />)}
            {!recent.length ? <div className="rounded-lg border border-dashed border-slate-200 bg-white p-8 text-center text-sm font-bold text-slate-400">Aun no hay sesiones. Guarda una rutina o importa GPX/FIT para alimentar el dashboard.</div> : null}
          </div>
        </section>
      </main>
    </>
  );
}
