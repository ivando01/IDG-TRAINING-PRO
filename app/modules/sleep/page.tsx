"use client";

import { AppIcon } from "@/components/Brand";
import TopNav from "@/components/TopNav";
import { getCloudCollection, saveCloudCollection } from "@/lib/cloud-sync";
import { ChangeEvent, useEffect, useMemo, useState } from "react";

type SleepRecord = {
  id: string;
  date: string;
  source: "manual" | "image" | "json";
  fileName?: string;
  bedtime?: string;
  wakeTime?: string;
  hours?: number | null;
  minutes?: number | null;
  score?: number | null;
  qualityScore?: number | null;
  deepMinutes?: number | null;
  lightMinutes?: number | null;
  remMinutes?: number | null;
  awakeMinutes?: number | null;
  deepPct?: number | null;
  lightPct?: number | null;
  remPct?: number | null;
  deepContinuityScore?: number | null;
  awakenings?: number | null;
  hrv?: number | null;
  restingHr?: number | null;
  spo2?: number | null;
  respiratoryRate?: number | null;
  notes?: string;
  rawText?: string;
};

const SLEEP_KEY = "idg_sleep_records_json";

const emptyDraft = {
  date: "",
  bedtime: "",
  wakeTime: "",
  hours: "",
  score: "",
  deepMinutes: "",
  lightMinutes: "",
  remMinutes: "",
  awakeMinutes: "",
  hrv: "",
  restingHr: "",
  spo2: "",
  respiratoryRate: "",
  qualityScore: "",
  deepContinuityScore: "",
  awakenings: "",
  notes: "",
};

function localISODate(date = new Date()) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function num(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function fileToDataURL(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(file);
  });
}

function sleepHours(record: Partial<SleepRecord>) {
  const direct = num(record.hours);
  if (direct !== null) return direct;
  const minutes = num(record.minutes);
  return minutes !== null ? Number((minutes / 60).toFixed(2)) : null;
}

function formatSleep(hours: number | null) {
  if (hours === null) return "--";
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  return `${whole}h ${String(minutes).padStart(2, "0")}m`;
}

function formatMinutes(minutes?: number | null) {
  if (!Number.isFinite(minutes)) return "--";
  const value = Number(minutes);
  return `${Math.floor(value / 60)}h ${String(value % 60).padStart(2, "0")}m`;
}

function normalizeTime(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/(\d{1,2})[:.](\d{2})/);
  if (!match) return text;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function normalizeSleepRecord(values: Record<string, unknown>, source: SleepRecord["source"], fileName?: string): SleepRecord {
  const totalMinutes = num(values.minutes) ?? num(values.totalMinutes) ?? num(values.durationMinutes);
  const hours = num(values.hours) ?? num(values.sleep) ?? num(values.totalHours) ?? (totalMinutes !== null ? Number((totalMinutes / 60).toFixed(2)) : null);
  return {
    id: String(values.id || crypto.randomUUID()),
    date: String(values.date || localISODate()).slice(0, 10),
    source,
    fileName,
    bedtime: normalizeTime(values.bedtime),
    wakeTime: normalizeTime(values.wakeTime),
    hours,
    minutes: totalMinutes ?? (hours !== null ? Math.round(hours * 60) : null),
    score: num(values.score) ?? num(values.points),
    qualityScore: num(values.qualityScore) ?? num(values.breathingQuality),
    deepMinutes: num(values.deepMinutes),
    lightMinutes: num(values.lightMinutes),
    remMinutes: num(values.remMinutes),
    awakeMinutes: num(values.awakeMinutes),
    deepPct: num(values.deepPct),
    lightPct: num(values.lightPct),
    remPct: num(values.remPct),
    deepContinuityScore: num(values.deepContinuityScore),
    awakenings: num(values.awakenings),
    hrv: num(values.hrv) ?? num(values.hrvMs),
    restingHr: num(values.restingHr) ?? num(values.restingHeartRate),
    spo2: num(values.spo2),
    respiratoryRate: num(values.respiratoryRate),
    notes: String(values.notes || ""),
    rawText: typeof values.rawText === "string" ? values.rawText : undefined,
  };
}

function recoveryScore(record: SleepRecord | undefined) {
  if (!record) return 0;
  const hours = sleepHours(record);
  let score = record.score ?? 70;
  if (hours !== null) score += hours >= 7 ? 6 : hours < 6.3 ? -10 : 0;
  if (record.hrv && record.hrv >= 35) score += 4;
  if (record.restingHr && record.restingHr <= 62) score += 3;
  if (record.spo2 && record.spo2 >= 95) score += 3;
  if (record.awakenings !== null && record.awakenings !== undefined && record.awakenings <= 1) score += 2;
  return Math.max(35, Math.min(100, Math.round(score)));
}

function recommendation(record: SleepRecord | undefined) {
  if (!record) return "Registra sueno para ajustar la carga diaria.";
  const score = recoveryScore(record);
  const hours = sleepHours(record);
  if (score >= 82 && (hours || 0) >= 6.5) return "Recuperacion buena: puedes entrenar normal, cuidando no acumular demasiada intensidad.";
  if (score >= 68) return "Recuperacion media: prioriza tecnica, Z2 o fuerza controlada.";
  return "Recuperacion baja: baja intensidad, movilidad y sueno temprano hoy.";
}

function safeSaveLocal(records: SleepRecord[]) {
  try {
    localStorage.setItem(SLEEP_KEY, JSON.stringify(records.slice(0, 180)));
  } catch {
    // Cloud remains the source of truth when local storage is full.
  }
}

export default function SleepRecoveryModule() {
  const [records, setRecords] = useState<SleepRecord[]>([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [status, setStatus] = useState("");
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    let alive = true;
    const local = readJSON<SleepRecord[]>(SLEEP_KEY, []);
    setRecords(local);
    setDraft((current) => ({ ...current, date: localISODate() }));
    getCloudCollection<SleepRecord>("/sleep", "records")
      .then((cloudRecords) => {
        if (!alive || !cloudRecords.length) return;
        const sorted = [...cloudRecords].sort((a, b) => String(b.date).localeCompare(String(a.date)));
        setRecords(sorted);
        safeSaveLocal(sorted);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const latest = records[0];
  const latestHours = latest ? sleepHours(latest) : null;
  const readiness = recoveryScore(latest);
  const last7 = records.slice(0, 7);
  const avgHours = last7.length ? Number((last7.reduce((sum, item) => sum + (sleepHours(item) || 0), 0) / last7.length).toFixed(2)) : null;
  const avgHrv = useMemo(() => {
    const values = last7.map((item) => item.hrv).filter((item): item is number => Number.isFinite(item));
    return values.length ? Math.round(values.reduce((sum, item) => sum + item, 0) / values.length) : null;
  }, [last7]);

  const saveRecords = (next: SleepRecord[], message: string) => {
    const sorted = next
      .filter((record) => sleepHours(record) !== null || record.score !== null || record.hrv !== null || record.restingHr !== null)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 180);
    setRecords(sorted);
    safeSaveLocal(sorted);
    saveCloudCollection("/sleep", "records", sorted).catch(() => undefined);
    setStatus(message);
  };

  const importSleepAnalysis = async (file?: File) => {
    if (!file) return;
    setImporting(true);
    setStatus("IDG esta interpretando el informe de sueno...");
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
        if (!response.ok) throw new Error(data.error || "No se pudo interpretar la imagen.");
        record = normalizeSleepRecord({ ...(data.values || {}), rawText: data.raw }, "image", file.name);
      } else {
        const text = await file.text();
        const parsed = file.name.toLowerCase().endsWith(".json") ? JSON.parse(text) : { notes: text };
        record = normalizeSleepRecord(parsed, file.name.toLowerCase().endsWith(".json") ? "json" : "manual", file.name);
      }
      saveRecords([record, ...records.filter((item) => item.date !== record.date)], `Sueno registrado: ${formatSleep(sleepHours(record))}, score ${record.score ?? "--"}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No se pudo interpretar el informe de sueno.");
    } finally {
      setImporting(false);
    }
  };

  const saveManual = () => {
    const record = normalizeSleepRecord({
      date: draft.date || localISODate(),
      bedtime: draft.bedtime,
      wakeTime: draft.wakeTime,
      hours: draft.hours,
      score: draft.score,
      deepMinutes: draft.deepMinutes,
      lightMinutes: draft.lightMinutes,
      remMinutes: draft.remMinutes,
      awakeMinutes: draft.awakeMinutes,
      hrv: draft.hrv,
      restingHr: draft.restingHr,
      spo2: draft.spo2,
      respiratoryRate: draft.respiratoryRate,
      qualityScore: draft.qualityScore,
      deepContinuityScore: draft.deepContinuityScore,
      awakenings: draft.awakenings,
      notes: draft.notes,
    }, "manual");
    saveRecords([record, ...records.filter((item) => item.id !== record.id && item.date !== record.date)], "Registro de sueno guardado.");
    setDraft({ ...emptyDraft, date: localISODate() });
  };

  const deleteRecord = (id: string) => {
    saveRecords(records.filter((record) => record.id !== id), "Registro eliminado.");
  };

  const setField = (key: keyof typeof draft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  return (
    <>
      <TopNav title="Sueño & Recuperación" />
      <main className="min-h-0 flex-1 overflow-y-auto bg-[#F8FAFC] p-4 text-slate-900 lg:p-6">
        {status ? <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">{status}</div> : null}

        <section className="mb-5 grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
          <div className="rounded-lg border border-slate-200 bg-white p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-blue-600">Recuperacion diaria</p>
                <h1 className="mt-2 text-3xl font-black text-slate-900">{latest ? `${readiness}% listo` : "Sin registro"}</h1>
                <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-500">{recommendation(latest)}</p>
              </div>
              <label className={`grid cursor-pointer place-items-center rounded-lg bg-blue-600 px-4 py-3 text-sm font-black text-white ${importing ? "opacity-70" : ""}`}>
                {importing ? "Interpretando..." : "Importar Huawei"}
                <input className="hidden" disabled={importing} type="file" accept=".jpg,.jpeg,.png,.webp,.json,.txt" onChange={(event: ChangeEvent<HTMLInputElement>) => importSleepAnalysis(event.target.files?.[0])} />
              </label>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-4">
              {[
                ["Puntaje", latest?.score ?? "--", "pts", "bg-blue-50 text-blue-700"],
                ["Duracion", formatSleep(latestHours), "", "bg-emerald-50 text-emerald-700"],
                ["HRV", latest?.hrv ?? "--", "ms", "bg-violet-50 text-violet-700"],
                ["FC sueño", latest?.restingHr ?? "--", "bpm", "bg-rose-50 text-rose-700"],
              ].map(([label, value, unit, color]) => (
                <div className={`rounded-lg p-4 ${color}`} key={label}>
                  <p className="text-xs font-black uppercase tracking-wide">{label}</p>
                  <p className="mt-2 text-2xl font-black">{value}{unit ? ` ${unit}` : ""}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-[150px_minmax(0,1fr)]">
              <div className="grid place-items-center">
                <div className="grid h-32 w-32 place-items-center rounded-full p-2" style={{ background: `conic-gradient(#22C55E ${readiness * 3.6}deg, #E2E8F0 0deg)` }}>
                  <div className="grid h-full w-full place-items-center rounded-full bg-white">
                    <div className="text-center">
                      <p className="text-3xl font-black text-slate-900">{readiness}</p>
                      <p className="text-xs font-black text-emerald-700">Recovery</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="grid content-center gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-slate-50 p-4">
                  <p className="text-[10px] font-black uppercase text-slate-500">Promedio 7 dias</p>
                  <p className="mt-1 text-xl font-black text-slate-900">{avgHours ? formatSleep(avgHours) : "--"}</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-4">
                  <p className="text-[10px] font-black uppercase text-slate-500">HRV 7 dias</p>
                  <p className="mt-1 text-xl font-black text-slate-900">{avgHrv ?? "--"} ms</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-4">
                  <p className="text-[10px] font-black uppercase text-slate-500">Registros</p>
                  <p className="mt-1 text-xl font-black text-slate-900">{records.length}</p>
                </div>
              </div>
            </div>
          </div>

          <aside className="rounded-lg border border-slate-200 bg-white p-5">
            <p className="text-xs font-black uppercase tracking-wide text-blue-600">Registro editable</p>
            <h2 className="mt-1 text-lg font-black text-slate-900">Datos de sueño</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {[
                ["Fecha", "date", "date"],
                ["Dormir", "bedtime", "time"],
                ["Despertar", "wakeTime", "time"],
                ["Horas", "hours", "number"],
                ["Score", "score", "number"],
                ["HRV", "hrv", "number"],
                ["FC sueño", "restingHr", "number"],
                ["SpO2", "spo2", "number"],
                ["Resp/min", "respiratoryRate", "number"],
                ["Despertares", "awakenings", "number"],
              ].map(([label, key, type]) => (
                <label className={`${key === "date" ? "col-span-2" : ""} grid gap-1 text-xs font-black uppercase text-slate-500`} key={key}>
                  {label}
                  <input className="h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold normal-case text-slate-900 outline-none focus:border-blue-400" type={type} step="0.1" value={draft[key as keyof typeof draft]} onChange={(event) => setField(key as keyof typeof draft, event.target.value)} />
                </label>
              ))}
            </div>
            <details className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
              <summary className="cursor-pointer text-xs font-black uppercase text-slate-500">Fases y calidad</summary>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {[
                  ["Profundo min", "deepMinutes"],
                  ["Liviano min", "lightMinutes"],
                  ["REM min", "remMinutes"],
                  ["Vigilia min", "awakeMinutes"],
                  ["Resp. score", "qualityScore"],
                  ["Continuidad", "deepContinuityScore"],
                ].map(([label, key]) => (
                  <label className="grid gap-1 text-[10px] font-black uppercase text-slate-500" key={key}>
                    {label}
                    <input className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm font-bold text-slate-900 outline-none focus:border-blue-400" type="number" value={draft[key as keyof typeof draft]} onChange={(event) => setField(key as keyof typeof draft, event.target.value)} />
                  </label>
                ))}
              </div>
            </details>
            <textarea className="mt-3 min-h-20 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-semibold outline-none focus:border-blue-400" value={draft.notes} onChange={(event) => setField("notes", event.target.value)} placeholder="Notas, sensaciones o recomendacion de Huawei." />
            <button className="mt-3 w-full rounded-lg bg-slate-900 px-4 py-3 text-sm font-black text-white" type="button" onClick={saveManual}>
              Guardar registro
            </button>
          </aside>
        </section>

        <section className="mb-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-black text-slate-900">Fases del ultimo sueño</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              {[
                ["Profundo", latest?.deepMinutes, latest?.deepPct, "bg-violet-50 text-violet-700"],
                ["Liviano", latest?.lightMinutes, latest?.lightPct, "bg-fuchsia-50 text-fuchsia-700"],
                ["REM", latest?.remMinutes, latest?.remPct, "bg-rose-50 text-rose-700"],
                ["Vigilia", latest?.awakeMinutes, null, "bg-amber-50 text-amber-700"],
              ].map(([label, minutes, pct, color]) => (
                <div className={`rounded-lg p-4 ${color}`} key={String(label)}>
                  <p className="text-xs font-black uppercase tracking-wide">{label}</p>
                  <p className="mt-2 text-xl font-black">{formatMinutes(minutes as number | null)}</p>
                  <p className="mt-1 text-xs font-bold opacity-80">{pct ? `${pct}%` : "fase"}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-lg bg-slate-50 p-4">
                <p className="text-[10px] font-black uppercase text-slate-500">Respiracion</p>
                <p className="mt-1 text-xl font-black text-slate-900">{latest?.qualityScore ?? "--"} pts</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-4">
                <p className="text-[10px] font-black uppercase text-slate-500">Continuidad profundo</p>
                <p className="mt-1 text-xl font-black text-slate-900">{latest?.deepContinuityScore ?? "--"} pts</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-4">
                <p className="text-[10px] font-black uppercase text-slate-500">Respiratoria</p>
                <p className="mt-1 text-xl font-black text-slate-900">{latest?.respiratoryRate ?? "--"} rpm</p>
              </div>
            </div>
          </div>

          <aside className="rounded-lg border border-emerald-100 bg-emerald-50 p-5">
            <div className="flex items-center gap-2">
              <AppIcon name="sleep" className="h-8 w-8" />
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-emerald-700">Lectura IDG</p>
                <h2 className="text-lg font-black text-slate-900">Impacto deportivo</h2>
              </div>
            </div>
            <p className="mt-4 text-sm font-semibold leading-6 text-slate-700">{recommendation(latest)}</p>
            <div className="mt-4 grid gap-2 text-xs font-black text-slate-600">
              <p className="rounded-lg bg-white/80 p-3">Score alto + HRV en rango: carga normal con control.</p>
              <p className="rounded-lg bg-white/80 p-3">Sueno bajo: reduce Z4/Z5 y prioriza movilidad.</p>
              <p className="rounded-lg bg-white/80 p-3">La tendencia se cruzara con gym, running, ciclismo y metas.</p>
            </div>
          </aside>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-blue-600">Historial</p>
              <h2 className="text-lg font-black text-slate-900">Registros de sueño</h2>
            </div>
            <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{records.length} registros</span>
          </div>
          <div className="mt-4 grid gap-2">
            {records.map((record) => (
              <div className="grid gap-3 rounded-lg border border-slate-100 bg-white p-3 md:grid-cols-[120px_1fr_90px_90px_90px_96px]" key={record.id}>
                <div>
                  <p className="font-black text-slate-900">{record.date}</p>
                  <p className="text-xs font-bold text-slate-400">{record.source === "image" ? "Imagen" : record.source}</p>
                </div>
                <div>
                  <p className="font-black text-slate-900">{formatSleep(sleepHours(record))} · {record.score ?? "--"} pts</p>
                  <p className="text-xs font-bold text-slate-500">{record.bedtime || "--"} - {record.wakeTime || "--"} · {record.notes || "Sin notas"}</p>
                </div>
                <span className="font-bold text-violet-700">HRV {record.hrv ?? "--"}</span>
                <span className="font-bold text-rose-700">FC {record.restingHr ?? "--"}</span>
                <span className="font-bold text-blue-700">SpO2 {record.spo2 ?? "--"}</span>
                <button className="rounded-lg bg-red-50 px-3 py-2 text-xs font-black text-red-600" type="button" onClick={() => deleteRecord(record.id)}>Eliminar</button>
              </div>
            ))}
            {!records.length ? <p className="rounded-lg bg-slate-50 p-6 text-center text-sm font-bold text-slate-400">Aun no hay registros de sueño.</p> : null}
          </div>
        </section>
      </main>
    </>
  );
}
