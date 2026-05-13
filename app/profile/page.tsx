"use client";

import TopNav from "@/components/TopNav";
import { getCloudProfile, saveCloudProfile } from "@/lib/cloud-sync";
import { useEffect, useMemo, useState } from "react";

type Zone = { name: string; min: number; max: number; color: string };

type AthleteProfile = {
  name: string;
  email: string;
  gender: string;
  dob: string;
  weight: string;
  height: string;
  weightGoal: string;
  weightGoalDate: string;
  fcmax: string;
  fcrest: string;
  diseases: string;
  meds: string;
  injuries: string;
  lvlRun: string;
  lvlBike: string;
  lvlGym: string;
  goal: string;
  gymDaysPerWeek: string;
  runDaysPerWeek: string;
  bikeDaysPerWeek: string;
  restDaysPerWeek: string;
  zones: Zone[];
};

const PROFILE_KEY = "idg_profile_json";
const LEGACY_PROFILE_KEY = "iv_profile";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

const zoneMeta = [
  { name: "Z1 Calentamiento", range: [0.5, 0.6], color: "#94A3B8" },
  { name: "Z2 Quema grasa", range: [0.6, 0.7], color: "#22C55E" },
  { name: "Z3 Aerobico", range: [0.7, 0.8], color: "#FACC15" },
  { name: "Z4 Anaerobico", range: [0.8, 0.9], color: "#F97316" },
  { name: "Z5 Extremo", range: [0.9, 1], color: "#EF4444" },
];

const seedProfile: AthleteProfile = {
  name: "Ivan Dominguez",
  email: "",
  gender: "masculino",
  dob: "1979-09-05",
  weight: "68",
  height: "165",
  weightGoal: "66",
  weightGoalDate: "2026-06-01",
  fcmax: "190",
  fcrest: "54",
  diseases: "HTA",
  meds: "NEBIVOLOL",
  injuries: "RUPTURA FIBRAS HOMBRO DERECHO",
  lvlRun: "intermedio",
  lvlBike: "intermedio",
  lvlGym: "intermedio",
  goal: "rendimiento",
  gymDaysPerWeek: "4",
  runDaysPerWeek: "2",
  bikeDaysPerWeek: "2",
  restDaysPerWeek: "1",
  zones: [],
};

function calculateZones(fcmaxText: string) {
  const fcmax = Number(fcmaxText) || 190;
  return zoneMeta.map((zone) => ({
    name: zone.name,
    min: Math.round(fcmax * zone.range[0]),
    max: Math.round(fcmax * zone.range[1]),
    color: zone.color,
  }));
}

function normalizeZones(zones: Zone[] | undefined, fcmax: string) {
  const calculated = calculateZones(fcmax);
  if (!zones?.length) return calculated;
  return calculated.map((zone, index) => ({
    ...zone,
    min: Number(zones[index]?.min) || zone.min,
    max: Number(zones[index]?.max) || zone.max,
  }));
}

function ageFromDob(dob: string) {
  if (!dob) return "";
  const birth = new Date(`${dob}T00:00:00`);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDelta = today.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age ? `${age} años` : "";
}

function isTrainingActivity(item: Record<string, unknown>) {
  if (item.countsTowardTraining === false || item.activityKind === "support") return false;
  const text = `${String(item.activitySubType || "")} ${String(item.name || "")}`.toLowerCase();
  return !/walk|hike|caminar|caminata|senderismo/.test(text);
}

function levelLabel(value: string) {
  const map: Record<string, string> = {
    principiante: "Principiante",
    intermedio: "Intermedio",
    avanzado: "Avanzado",
    elite: "Elite",
  };
  return map[value] || value || "--";
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<AthleteProfile>(() => ({
    ...seedProfile,
    zones: calculateZones(seedProfile.fcmax),
  }));
  const [status, setStatus] = useState("");
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [stravaBusy, setStravaBusy] = useState(false);
  const [analysis, setAnalysis] = useState("Guarda tu perfil para habilitar recomendaciones consistentes en todos los modulos.");

  useEffect(() => {
    let alive = true;
    const userData = localStorage.getItem("user");
    const saved = localStorage.getItem(PROFILE_KEY) || localStorage.getItem(LEGACY_PROFILE_KEY);
    const user = userData ? JSON.parse(userData) : null;
    const parsed = saved ? JSON.parse(saved) : {};
    const merged = {
      ...seedProfile,
      ...parsed,
      name: parsed.name || user?.name || seedProfile.name,
      email: parsed.email || user?.email || "",
    };
    const nextProfile = {
      ...merged,
      zones: normalizeZones(parsed.zones, merged.fcmax),
    };
    setProfile(nextProfile);
    getCloudProfile<AthleteProfile>()
      .then((cloudProfile) => {
        if (!alive || !cloudProfile) return;
        const synced = { ...seedProfile, ...cloudProfile, zones: normalizeZones(cloudProfile.zones, cloudProfile.fcmax || seedProfile.fcmax) };
        setProfile(synced);
        localStorage.setItem(PROFILE_KEY, JSON.stringify(synced));
        localStorage.setItem(LEGACY_PROFILE_KEY, JSON.stringify(synced));
      })
      .catch(() => {
        if (alive) setStatus("Perfil local cargado. La nube se sincronizara cuando el backend este disponible.");
      });
    return () => {
      alive = false;
    };
  }, []);

  const bmi = useMemo(() => {
    const weight = Number(profile.weight);
    const height = Number(profile.height) / 100;
    return weight && height ? (weight / (height * height)).toFixed(1) : "--";
  }, [profile.height, profile.weight]);

  const completion = useMemo(() => {
    const keys: (keyof AthleteProfile)[] = ["name", "gender", "dob", "weight", "height", "fcmax", "fcrest", "lvlRun", "lvlBike", "lvlGym", "goal", "gymDaysPerWeek"];
    const done = keys.filter((key) => String(profile[key] || "").trim()).length;
    const zonesOk = profile.zones.every((zone, index) => zone.min < zone.max && (index === 0 || zone.min > profile.zones[index - 1].min));
    return Math.round(((done + (zonesOk ? 1 : 0)) / (keys.length + 1)) * 100);
  }, [profile]);

  const zoneError = useMemo(() => {
    const fcmax = Number(profile.fcmax) || 0;
    for (let index = 0; index < profile.zones.length; index += 1) {
      const zone = profile.zones[index];
      if (zone.min >= zone.max) return `${zone.name}: el minimo debe ser menor al maximo.`;
      if (index > 0 && zone.min <= profile.zones[index - 1].min) return "Las zonas deben aumentar de forma progresiva.";
      if (fcmax && zone.max > fcmax) return `${zone.name}: el maximo supera tu FC maxima.`;
    }
    return "";
  }, [profile.fcmax, profile.zones]);

  const setField = (key: keyof AthleteProfile, value: string) => {
    setProfile((current) => ({ ...current, [key]: value }));
  };

  const updateZone = (index: number, key: "min" | "max", value: string) => {
    setProfile((current) => ({
      ...current,
      zones: current.zones.map((zone, zoneIndex) =>
        zoneIndex === index ? { ...zone, [key]: Number(value) || 0 } : zone,
      ),
    }));
  };

  const recalculateZones = () => {
    setProfile((current) => ({ ...current, zones: calculateZones(current.fcmax) }));
    setStatus("Zonas recalculadas desde FC maxima.");
  };

  const saveProfile = async () => {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    localStorage.setItem(LEGACY_PROFILE_KEY, JSON.stringify(profile));
    setStatus("Perfil guardado localmente. Sincronizando nube...");
    try {
      await saveCloudProfile(profile);
      setStatus("Perfil guardado y sincronizado. Gym usara tus dias por semana para el progreso semanal.");
    } catch {
      setStatus("Perfil guardado localmente. No se pudo sincronizar con la nube.");
    }
  };

  const analyzeProfile = async () => {
    setAnalysisLoading(true);
    setAnalysis("IDG Intelligence esta leyendo tu perfil, zonas FC, salud y frecuencia semanal...");
    try {
      const gymSessions = JSON.parse(localStorage.getItem("idg_gym_sessions_json") || localStorage.getItem("iv_gym") || "[]");
      const runSessions = JSON.parse(localStorage.getItem("idg_running_activities_json") || localStorage.getItem("iv_run") || "[]").filter(isTrainingActivity);
      const bikeSessions = JSON.parse(localStorage.getItem("idg_cycling_activities_json") || localStorage.getItem("iv_bike") || "[]");
      const response = await fetch("/api/profile-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile,
          metrics: { age: ageFromDob(profile.dob), bmi },
          sessions: {
            gym: gymSessions.slice(0, 8),
            running: runSessions.slice(0, 8),
            cycling: bikeSessions.slice(0, 8),
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo generar el analisis.");
      setAnalysis(data.analysis || "Sin respuesta de IDG Intelligence.");
      setStatus("Analisis generado por IDG Intelligence.");
    } catch (error) {
      setAnalysis(error instanceof Error ? error.message : "No se pudo conectar con IDG Intelligence.");
    } finally {
      setAnalysisLoading(false);
    }
  };

  const connectStrava = () => {
    const token = localStorage.getItem("token");
    if (!token) {
      setStatus("Inicia sesion con Google antes de conectar Strava.");
      return;
    }
    window.location.href = `${API_URL}/auth/strava?token=${encodeURIComponent(token)}`;
  };

  const disconnectStrava = async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      setStatus("Inicia sesion con Google antes de desconectar Strava.");
      return;
    }
    setStravaBusy(true);
    try {
      const response = await fetch(`${API_URL}/strava/disconnect`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(data.error || "No se pudo desconectar Strava.");
      setStatus("Strava desconectado. Ahora conecta la cuenta personal correcta.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No se pudo desconectar Strava.");
    } finally {
      setStravaBusy(false);
    }
  };

  const inputClass = "h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
  const labelClass = "grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500";

  return (
    <>
      <TopNav title="Mi Perfil" />
      <main className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
        <div className="mb-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h1 className="text-2xl font-black text-slate-900">Perfil del Atleta</h1>
              <p className="mt-1 text-sm font-semibold text-slate-500">Configura tus datos deportivos, zonas cardiacas y frecuencia semanal.</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(220px,280px)_minmax(260px,360px)] xl:min-w-[660px]">
              <div>
                <div className="mb-2 flex justify-between text-xs font-black text-slate-500">
                  <span>Completitud</span>
                  <span>{completion}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-blue-600" style={{ width: `${completion}%` }} />
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="flex items-center justify-between rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2">
                  <div className="flex items-center gap-3">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-white text-base font-black text-blue-600 shadow-sm">G</span>
                    <div>
                      <p className="text-xs font-black text-slate-900">Google</p>
                      <p className="text-[11px] font-bold text-slate-500">Conectado</p>
                    </div>
                  </div>
                  <span className="rounded-full bg-emerald-500 px-2 py-1 text-xs font-black text-white">OK</span>
                </div>

                <div className="grid gap-2">
                  <button className="flex min-h-14 items-center justify-center gap-4 rounded-lg bg-[#fc4c02] px-4 py-3 text-sm font-black text-white shadow-[0_16px_30px_rgba(252,76,2,0.24)] transition hover:-translate-y-px" type="button" onClick={connectStrava}>
                    <span className="text-[1.2rem] font-black tracking-tight">STRAVA</span>
                    <span>Conectar</span>
                  </button>
                  <button className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-600 disabled:opacity-60" type="button" onClick={disconnectStrava} disabled={stravaBusy}>
                    {stravaBusy ? "Desconectando..." : "Desconectar Strava"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="grid gap-5">
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-black text-slate-900">Identidad</h2>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label className={labelClass}>Nombre<input className={inputClass} value={profile.name} onChange={(event) => setField("name", event.target.value)} /></label>
                <label className={labelClass}>Email<input className={`${inputClass} bg-slate-50`} value={profile.email} readOnly /></label>
                <label className={labelClass}>Fecha de nacimiento<input className={inputClass} type="date" value={profile.dob} onChange={(event) => setField("dob", event.target.value)} /></label>
                <label className={labelClass}>Edad<input className={`${inputClass} bg-slate-50`} value={ageFromDob(profile.dob)} readOnly /></label>
                <label className={labelClass}>Sexo / genero<select className={inputClass} value={profile.gender} onChange={(event) => setField("gender", event.target.value)}><option value="masculino">Masculino</option><option value="femenino">Femenino</option><option value="otro">Otro / prefiero no decir</option></select></label>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-black text-slate-900">Composicion corporal</h2>
              <div className="mt-5 grid gap-4 md:grid-cols-3">
                <label className={labelClass}>Peso actual kg<input className={inputClass} type="number" value={profile.weight} onChange={(event) => setField("weight", event.target.value)} /></label>
                <label className={labelClass}>Altura cm<input className={inputClass} type="number" value={profile.height} onChange={(event) => setField("height", event.target.value)} /></label>
                <label className={labelClass}>IMC<input className={`${inputClass} bg-slate-50`} value={bmi} readOnly /></label>
                <label className={labelClass}>Peso objetivo kg<input className={inputClass} type="number" value={profile.weightGoal} onChange={(event) => setField("weightGoal", event.target.value)} /></label>
                <label className={labelClass}>Fecha meta<input className={inputClass} type="date" value={profile.weightGoalDate} onChange={(event) => setField("weightGoalDate", event.target.value)} /></label>
              </div>
            </div>

            <div className="rounded-lg border border-blue-100 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="text-lg font-black text-slate-900">Fisiologia y zonas FC</h2>
                  <p className="mt-1 text-sm font-semibold text-slate-500">Puedes calcularlas desde FC maxima y luego editarlas segun tus pruebas reales.</p>
                </div>
                <button className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-black text-slate-600" type="button" onClick={recalculateZones}>Calcular zonas</button>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label className={labelClass}>FC maxima bpm<input className={inputClass} type="number" value={profile.fcmax} onChange={(event) => setField("fcmax", event.target.value)} /></label>
                <label className={labelClass}>FC reposo<input className={inputClass} type="number" value={profile.fcrest} onChange={(event) => setField("fcrest", event.target.value)} /></label>
              </div>

              <div className="mt-5 grid gap-3">
                {profile.zones.map((zone, index) => (
                  <div className="grid items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-[170px_82px_14px_82px_1fr_38px]" key={zone.name}>
                    <div className="flex items-center gap-3">
                      <span className="h-3 w-3 rounded" style={{ background: zone.color }} />
                      <strong className="text-sm font-black text-slate-800">{zone.name}</strong>
                    </div>
                    <input className={`${inputClass} px-2 text-center font-mono font-black`} type="number" value={zone.min} onChange={(event) => updateZone(index, "min", event.target.value)} />
                    <span className="text-center text-slate-400">-</span>
                    <input className={`${inputClass} px-2 text-center font-mono font-black`} type="number" value={zone.max} onChange={(event) => updateZone(index, "max", event.target.value)} />
                    <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                      <div className="h-full rounded-full" style={{ width: `${(index + 1) * 20}%`, background: zone.color }} />
                    </div>
                    <span className="text-xs font-black text-slate-400">bpm</span>
                  </div>
                ))}
              </div>
              {zoneError ? <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-600">{zoneError}</p> : null}
              <p className="mt-3 text-xs font-semibold text-slate-500">Las zonas alimentan Running, Ciclismo, recuperacion e IDG Intelligence. Si haces prueba de campo o laboratorio, edita los rangos manualmente.</p>
            </div>
          </section>

          <aside className="grid content-start gap-5">
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-black text-slate-900">Resumen del perfil</h2>
              <div className="mt-4 grid gap-3">
                {[
                  ["Edad", ageFromDob(profile.dob) || "--"],
                  ["Sexo / genero", profile.gender || "--"],
                  ["Peso actual", profile.weight ? `${profile.weight} kg` : "--"],
                  ["Objetivo", profile.weightGoal ? `${profile.weightGoal} kg` : "--"],
                  ["Altura", profile.height ? `${profile.height} cm` : "--"],
                  ["IMC", bmi],
                  ["FC maxima", profile.fcmax ? `${profile.fcmax} bpm` : "--"],
                  ["FC reposo", profile.fcrest ? `${profile.fcrest} bpm` : "--"],
                ].map(([label, value]) => (
                  <div className="flex justify-between border-b border-slate-100 pb-2 text-sm" key={label}>
                    <span className="font-bold text-slate-500">{label}</span>
                    <strong className="text-right font-black text-slate-900">{value}</strong>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-black text-slate-900">Nivel y plan semanal</h2>
              <div className="mt-5 grid gap-4">
                <label className={labelClass}>Running<select className={inputClass} value={profile.lvlRun} onChange={(event) => setField("lvlRun", event.target.value)}><option value="principiante">Principiante</option><option value="intermedio">Intermedio</option><option value="avanzado">Avanzado</option><option value="elite">Elite</option></select></label>
                <label className={labelClass}>Ciclismo<select className={inputClass} value={profile.lvlBike} onChange={(event) => setField("lvlBike", event.target.value)}><option value="principiante">Principiante</option><option value="intermedio">Intermedio</option><option value="avanzado">Avanzado</option><option value="elite">Elite</option></select></label>
                <label className={labelClass}>Gym<select className={inputClass} value={profile.lvlGym} onChange={(event) => setField("lvlGym", event.target.value)}><option value="principiante">Principiante</option><option value="intermedio">Intermedio</option><option value="avanzado">Avanzado</option><option value="elite">Elite</option></select></label>
                <label className={labelClass}>Objetivo<select className={inputClass} value={profile.goal} onChange={(event) => setField("goal", event.target.value)}><option value="rendimiento">Mejorar rendimiento</option><option value="masa">Ganar masa muscular</option><option value="perdida">Bajar peso</option><option value="resistencia">Aumentar resistencia</option><option value="rehab">Rehabilitacion</option></select></label>
                <label className={labelClass}>Dias Gym/semana<input className={inputClass} type="number" min="0" max="7" value={profile.gymDaysPerWeek} onChange={(event) => setField("gymDaysPerWeek", event.target.value)} /></label>
                <label className={labelClass}>Dias Running/semana<input className={inputClass} type="number" min="0" max="7" value={profile.runDaysPerWeek} onChange={(event) => setField("runDaysPerWeek", event.target.value)} /></label>
                <label className={labelClass}>Dias Ciclismo/semana<input className={inputClass} type="number" min="0" max="7" value={profile.bikeDaysPerWeek} onChange={(event) => setField("bikeDaysPerWeek", event.target.value)} /></label>
                <label className={labelClass}>Descanso objetivo<input className={inputClass} type="number" min="0" max="7" value={profile.restDaysPerWeek} onChange={(event) => setField("restDaysPerWeek", event.target.value)} /></label>
              </div>
            </div>
          </aside>
        </div>

        <section className="mt-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-lg font-black text-slate-900">Salud</h2>
              <p className="mt-1 text-sm font-semibold text-slate-500">Condiciones, medicamentos y lesiones que IDG Intelligence debe considerar en todos los modulos.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button className="rounded-lg border border-slate-200 px-4 py-3 text-sm font-black text-slate-700" type="button" onClick={recalculateZones}>Recalcular zonas</button>
              <button className="rounded-lg bg-green-600 px-4 py-3 text-sm font-black text-white" type="button" onClick={saveProfile}>Guardar perfil</button>
            </div>
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <label className={labelClass}>Enfermedades diagnosticadas<textarea className={`${inputClass} min-h-28 py-3`} value={profile.diseases} onChange={(event) => setField("diseases", event.target.value)} /></label>
            <label className={labelClass}>Medicamentos actuales<textarea className={`${inputClass} min-h-28 py-3`} value={profile.meds} onChange={(event) => setField("meds", event.target.value)} /></label>
            <label className={labelClass}>Historial de lesiones<textarea className={`${inputClass} min-h-28 py-3`} value={profile.injuries} onChange={(event) => setField("injuries", event.target.value)} /></label>
          </div>
          {status ? <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{status}</p> : null}
        </section>

        <section className="mt-5 rounded-lg border border-blue-100 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-blue-600">IDG Intelligence</p>
              <h2 className="mt-1 text-xl font-black text-slate-900">IDG Intelligence</h2>
              <p className="mt-1 max-w-3xl text-sm font-semibold text-slate-500">Analiza identidad, composicion corporal, zonas FC, salud, lesiones, frecuencia semanal y sesiones recientes para producir recomendaciones accionables.</p>
            </div>
            <button className="rounded-lg bg-blue-600 px-4 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-blue-300" type="button" onClick={analyzeProfile} disabled={analysisLoading}>
              {analysisLoading ? "Analizando..." : "Generar analisis completo"}
            </button>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-4">
            {[
              ["Zonas FC", zoneError ? "Revisar rangos" : "Completas"],
              ["Plan semanal", `${profile.gymDaysPerWeek || 0} gym / ${profile.runDaysPerWeek || 0} run / ${profile.bikeDaysPerWeek || 0} bici`],
              ["Salud", profile.diseases || profile.injuries ? "Contexto registrado" : "Sin alertas"],
              ["Objetivo", profile.goal || "--"],
            ].map(([label, value]) => (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4" key={label}>
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p>
                <p className="mt-2 text-sm font-black text-slate-900">{value}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="whitespace-pre-wrap text-sm font-semibold leading-7 text-slate-700">{analysis}</p>
          </div>
        </section>
      </main>
    </>
  );
}
