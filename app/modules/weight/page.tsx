"use client";

import { AppIcon } from "@/components/Brand";
import TopNav from "@/components/TopNav";
import { getCloudCollection, saveCloudCollection } from "@/lib/cloud-sync";
import { calculateNutritionSuggestion } from "@/lib/performance-insights";
import { ChangeEvent, useEffect, useMemo, useState } from "react";

type WeightRecord = {
  id: string;
  date: string;
  time?: string;
  kg: string;
  imc?: string;
  fat?: string;
  musclemass?: string;
  muscle?: string;
  water?: string;
  visceral?: string;
  bone?: string;
  protein?: string;
  bmr?: string;
  notes?: string;
  imageName?: string;
  aiAnalysis?: string;
  aiAcknowledgedAt?: string;
  ts: number;
};

const WEIGHT_KEY = "idg_weight_records_json";
const PROFILE_KEY = "idg_profile_json";
const LEGACY_PROFILE_KEY = "iv_profile";

const emptyDraft: WeightRecord = {
  id: "",
  date: new Date().toISOString().slice(0, 10),
  time: "",
  kg: "",
  imc: "",
  fat: "",
  musclemass: "",
  water: "",
  visceral: "",
  bone: "",
  protein: "",
  bmr: "",
  notes: "",
  ts: Date.now(),
};

function numberValue(value?: string) {
  const parsed = Number(String(value || "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function aliasValue(data: Record<string, unknown>, keys: string[]) {
  const normalized = Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key.toLowerCase().replace(/[\s_-]/g, ""), value]),
  );
  for (const key of keys) {
    const value = normalized[key.toLowerCase().replace(/[\s_-]/g, "")];
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  return "";
}

function muscleValue(record?: WeightRecord) {
  if (!record) return "";
  return record.musclemass || record.muscle || aliasValue(record as unknown as Record<string, unknown>, ["masa_muscular", "masaMuscular", "muscleMass", "musclemasskg", "skeletalMuscle"]);
}

function statusFromBMI(bmi: number | null) {
  if (!bmi) return "Sin IMC";
  if (bmi < 18.5) return "Bajo";
  if (bmi < 25) return "Saludable";
  if (bmi < 30) return "Sobrepeso";
  return "Obeso";
}

function bmiPosition(bmi: number | null) {
  if (!bmi) return 0;
  if (bmi <= 16) return 2;
  if (bmi >= 35) return 98;
  return ((bmi - 16) / 19) * 100;
}

function calcBMI(kg: string, height: string) {
  const weight = numberValue(kg);
  const cm = numberValue(height);
  if (!weight || !cm) return "";
  return (weight / (cm / 100) ** 2).toFixed(1);
}

function readFileAsDataURL(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function MiniTrend({ records }: { records: WeightRecord[] }) {
  const ordered = records.slice().reverse();
  if (ordered.length < 2) return <div className="grid h-56 place-items-center rounded-lg bg-slate-50 text-sm font-bold text-slate-400">Registra al menos dos mediciones</div>;
  const values = ordered.map((item) => numberValue(item.kg)).filter((value): value is number => value !== null);
  const fats = ordered.map((item) => numberValue(item.fat));
  const min = Math.min(...values) - 0.5;
  const max = Math.max(...values) + 0.5;
  const w = 720;
  const h = 240;
  const pad = 28;
  const x = (index: number) => pad + (index / Math.max(1, ordered.length - 1)) * (w - pad * 2);
  const y = (value: number) => h - pad - ((value - min) / Math.max(1, max - min)) * (h - pad * 2);
  const weightCoords = ordered
    .map((item, index) => {
      const value = numberValue(item.kg);
      return value ? { x: x(index), y: y(value) } : null;
    })
    .filter((coord): coord is { x: number; y: number } => Boolean(coord));
  const path = weightCoords.map((coord, index) => `${index === 0 ? "M" : "L"} ${coord.x} ${coord.y}`).join(" ");
  const area = weightCoords.length ? `${path} L ${weightCoords.at(-1)!.x} ${h - pad} L ${weightCoords[0].x} ${h - pad} Z` : "";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-64 w-full">
      <defs>
        <linearGradient id="weight-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#1D4ED8" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#1D4ED8" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((tick) => (
        <line key={tick} x1={pad} x2={w - pad} y1={pad + tick * (h - pad * 2)} y2={pad + tick * (h - pad * 2)} stroke="#E2E8F0" strokeDasharray="4 4" />
      ))}
      <path d={area} fill="url(#weight-fill)" />
      <path d={path} fill="none" stroke="#1D4ED8" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
      {weightCoords.map((coord, index) => <circle key={index} cx={coord.x} cy={coord.y} r="4" fill="#FFFFFF" stroke="#1D4ED8" strokeWidth="2" />)}
      {fats.map((fat, index) => fat ? <circle key={`fat-${index}`} cx={x(index)} cy={h - pad - Math.min(100, fat) / 100 * (h - pad * 2)} r="3" fill="#F59E0B" /> : null)}
      <text x={pad} y={h - 4} fill="#64748B" fontSize="12">Inicio</text>
      <text x={w - pad - 42} y={h - 4} fill="#64748B" fontSize="12">Actual</text>
    </svg>
  );
}

export default function WeightModule() {
  const [records, setRecords] = useState<WeightRecord[]>([]);
  const [draft, setDraft] = useState<WeightRecord>(emptyDraft);
  const [profile, setProfile] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [imagePreview, setImagePreview] = useState("");
  const [loadingImage, setLoadingImage] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);

  useEffect(() => {
    let alive = true;
    try {
      const saved = localStorage.getItem(WEIGHT_KEY);
      const parsed = saved ? JSON.parse(saved) : [];
      setRecords(parsed);
      const rawProfile = localStorage.getItem(PROFILE_KEY) || localStorage.getItem(LEGACY_PROFILE_KEY);
      const parsedProfile = rawProfile ? JSON.parse(rawProfile) : {};
      setProfile(parsedProfile);
      setDraft((current) => ({ ...current, kg: parsedProfile.weight || "", imc: calcBMI(parsedProfile.weight || "", parsedProfile.height || "") }));
    } catch {
      setRecords([]);
    }
    getCloudCollection<WeightRecord>("/weight", "records")
      .then((cloudRecords) => {
        if (!alive || !cloudRecords.length) return;
        setRecords(cloudRecords);
        localStorage.setItem(WEIGHT_KEY, JSON.stringify(cloudRecords));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const latest = records[0];
  const bmi = numberValue(latest?.imc) || numberValue(calcBMI(latest?.kg || "", profile.height || ""));
  const goalKg = numberValue(profile.weightGoal) || 66;
  const currentKg = numberValue(latest?.kg);
  const firstKg = numberValue(records.at(-1)?.kg);
  const weightDelta = currentKg && firstKg ? Number((currentKg - firstKg).toFixed(1)) : null;
  const goalProgress = currentKg && firstKg && firstKg !== goalKg ? Math.max(0, Math.min(100, ((firstKg - currentKg) / (firstKg - goalKg)) * 100)) : 0;
  const nutrition = useMemo(() => calculateNutritionSuggestion(profile, currentKg), [profile, currentKg]);

  const composition = useMemo(() => {
    if (!latest || !currentKg) return [];
    const water = numberValue(latest.water);
    const fat = numberValue(latest.fat);
    const protein = numberValue(latest.protein);
    const bone = numberValue(latest.bone);
    return [
      water ? { label: "Agua", value: water, kg: (currentKg * water / 100).toFixed(1), color: "#2DD4BF" } : null,
      protein ? { label: "Proteinas", value: protein, kg: (currentKg * protein / 100).toFixed(1), color: "#1D4ED8" } : null,
      fat ? { label: "Grasa", value: fat, kg: (currentKg * fat / 100).toFixed(1), color: "#F59E0B" } : null,
      bone ? { label: "Masa osea", value: bone, kg: bone.toFixed(1), color: "#A78BFA" } : null,
    ].filter((item): item is { label: string; value: number; kg: string; color: string } => Boolean(item));
  }, [latest, currentKg]);

  const saveRecords = (next: WeightRecord[]) => {
    setRecords(next);
    localStorage.setItem(WEIGHT_KEY, JSON.stringify(next));
    saveCloudCollection("/weight", "records", next).catch(() => undefined);
  };

  const setField = (key: keyof WeightRecord, value: string) => {
    setDraft((current) => {
      const next = { ...current, [key]: value };
      if ((key === "kg" || key === "imc") && !next.imc) next.imc = calcBMI(String(next.kg), profile.height || "");
      return next;
    });
  };

  const syncProfileWeight = (kg: string) => {
    const nextProfile = { ...profile, weight: kg };
    setProfile(nextProfile);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(nextProfile));
  };

  const saveDraft = () => {
    if (!draft.kg) {
      setStatus("Ingresa o extrae el peso antes de guardar.");
      return;
    }
    const entry = { ...draft, id: draft.id || crypto.randomUUID(), imc: draft.imc || calcBMI(draft.kg, profile.height || ""), ts: Date.now() };
    const next = [entry, ...records.filter((item) => item.id !== entry.id)].sort((a, b) => b.ts - a.ts);
    saveRecords(next);
    syncProfileWeight(entry.kg);
    setDraft({ ...emptyDraft, date: new Date().toISOString().slice(0, 10), kg: entry.kg, imc: entry.imc, fat: entry.fat, musclemass: muscleValue(entry), water: entry.water, visceral: entry.visceral, bone: entry.bone, protein: entry.protein, bmr: entry.bmr });
    setImagePreview("");
    setStatus("Registro guardado y perfil actualizado.");
  };

  const onImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLoadingImage(true);
    setStatus("IDG Intelligence esta leyendo la imagen...");
    try {
      const image = await readFileAsDataURL(file);
      setImagePreview(image);
      setShowManualEntry(true);
      const response = await fetch("/api/weight-image-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo analizar la imagen.");
      const values = data.values || {};
      const extractedMuscle = aliasValue(values, ["musclemass", "masa_muscular", "masaMuscular", "muscleMass", "muscle", "masa muscular"]);
      setDraft((current) => ({
        ...current,
        date: values.date || current.date,
        time: values.time || current.time,
        kg: values.kg ? String(values.kg) : current.kg,
        imc: values.imc ? String(values.imc) : current.imc,
        fat: values.fat ? String(values.fat) : current.fat,
        musclemass: extractedMuscle || current.musclemass,
        water: values.water ? String(values.water) : current.water,
        visceral: values.visceral ? String(values.visceral) : current.visceral,
        bone: values.bone ? String(values.bone) : current.bone,
        protein: values.protein ? String(values.protein) : current.protein,
        bmr: values.bmr ? String(values.bmr) : current.bmr,
        imageName: file.name,
        notes: current.notes || "Extraido desde imagen.",
      }));
      setStatus("Datos extraidos. Revisa y guarda el registro.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No se pudo procesar la imagen.");
    } finally {
      setLoadingImage(false);
      event.target.value = "";
    }
  };

  const generateAnalysis = async () => {
    setAiLoading(true);
    setStatus("IDG Intelligence esta analizando composicion corporal...");
    try {
      const response = await fetch("/api/weight-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records, profile }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo generar el analisis.");
      const next = records.map((item, index) => index === 0 ? { ...item, aiAnalysis: data.analysis, aiAcknowledgedAt: undefined } : item);
      saveRecords(next);
      setShowAI(true);
      setStatus("Analisis guardado en el ultimo registro.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No se pudo conectar con IDG Intelligence.");
    } finally {
      setAiLoading(false);
    }
  };

  const deleteRecord = (id: string) => {
    saveRecords(records.filter((item) => item.id !== id));
  };

  return (
    <>
      <TopNav title="Peso & Cuerpo" />
      <main className="min-h-0 flex-1 overflow-y-auto bg-[#F8FAFC] p-4 text-slate-900 lg:p-6">
        {status ? <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">{status}</div> : null}

        <section className={`mb-5 grid gap-5 ${showManualEntry ? "xl:grid-cols-[minmax(0,1.3fr)_minmax(380px,0.7fr)]" : ""}`}>
          <div className="rounded-lg border border-slate-200 bg-white p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-blue-600">Composicion corporal</p>
                <h2 className="mt-2 text-3xl font-black text-slate-900">{latest ? `${latest.kg} kg` : "Sin registro"}</h2>
                <p className="mt-1 text-sm font-bold text-slate-500">{statusFromBMI(bmi)} {bmi ? `- IMC ${bmi}` : ""}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className={`rounded-lg px-4 py-3 text-sm font-black ${showManualEntry ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-700"}`}
                  type="button"
                  onClick={() => setShowManualEntry((open) => !open)}
                >
                  {showManualEntry ? "Ocultar ingreso manual" : "Ingreso manual"}
                </button>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-slate-900 px-4 py-3 text-sm font-black text-white">
                  <AppIcon name="intelligence" className="h-4 w-4" />
                  {loadingImage ? "Leyendo..." : "Foto Huawei Health"}
                  <input className="hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={onImage} />
                </label>
                {showManualEntry ? <button className="rounded-lg bg-blue-600 px-4 py-3 text-sm font-black text-white" type="button" onClick={saveDraft}>Guardar</button> : null}
              </div>
            </div>

            <div className="mt-6">
              <div className="relative h-2 overflow-hidden rounded-full bg-slate-200">
                <div className="absolute inset-y-0 left-0 w-[28%] bg-blue-500" />
                <div className="absolute inset-y-0 left-[28%] w-[34%] bg-green-500" />
                <div className="absolute inset-y-0 left-[62%] w-[20%] bg-amber-400" />
                <div className="absolute inset-y-0 left-[82%] w-[18%] bg-red-500" />
                {bmi ? (
                  <span
                    className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-slate-900 shadow"
                    style={{ left: `${bmiPosition(bmi)}%` }}
                  />
                ) : null}
              </div>
              <div className="mt-2 grid grid-cols-4 text-center text-xs font-bold text-slate-500">
                <span>Bajo</span>
                <span>Saludable</span>
                <span>Sobrepeso</span>
                <span>Obeso</span>
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
                <p className="text-xs font-black uppercase text-blue-700">Meta de peso</p>
                <p className="mt-2 text-xl font-black text-slate-900">{goalKg} kg</p>
                <p className="mt-1 text-xs font-bold text-slate-500">Avance {Math.round(goalProgress)}%</p>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                <p className="text-xs font-black uppercase text-slate-500">Cambio desde inicio</p>
                <p className="mt-2 text-xl font-black text-slate-900">{weightDelta !== null ? `${weightDelta > 0 ? "+" : ""}${weightDelta} kg` : "--"}</p>
                <p className="mt-1 text-xs font-bold text-slate-500">Inicio {records.at(-1)?.kg || "--"} kg</p>
              </div>
              <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4">
                <p className="text-xs font-black uppercase text-emerald-700">Estado IMC</p>
                <p className="mt-2 text-xl font-black text-slate-900">{statusFromBMI(bmi)}</p>
                <p className="mt-1 text-xs font-bold text-slate-500">IMC {bmi || "--"}</p>
              </div>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-4">
              {[
                ["Grasa corporal", latest?.fat ? `${latest.fat}%` : "--", "text-amber-600"],
                ["Masa muscular", muscleValue(latest) ? `${muscleValue(latest)} kg` : "--", "text-blue-600"],
                ["Agua corporal", latest?.water ? `${latest.water}%` : "--", "text-cyan-600"],
                ["Grasa visceral", latest?.visceral || "--", "text-slate-600"],
              ].map(([label, value, color]) => (
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-4" key={label}>
                  <p className="text-xs font-black uppercase text-slate-500">{label}</p>
                  <p className={`mt-2 text-xl font-black ${color}`}>{value}</p>
                </div>
              ))}
            </div>
          </div>

          {showManualEntry ? <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-black text-slate-900">Registro rapido</h2>
            {imagePreview ? <img src={imagePreview} alt="Captura importada" className="mt-3 max-h-44 w-full rounded-lg object-cover" /> : null}
            <div className="mt-4 grid grid-cols-2 gap-3">
              {[
                ["date", "Fecha", "date"],
                ["time", "Hora", "time"],
                ["kg", "Peso kg", "number"],
                ["imc", "IMC", "number"],
                ["fat", "% Grasa", "number"],
                ["musclemass", "Masa musc. kg", "number"],
                ["water", "% Agua", "number"],
                ["visceral", "Visceral", "number"],
                ["bone", "Masa osea kg", "number"],
                ["protein", "% Proteinas", "number"],
                ["bmr", "BMR kcal/dia", "number"],
              ].map(([key, label, type]) => (
                <label className="text-xs font-black uppercase text-slate-500" key={key}>
                  {label}
                  <input className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none focus:border-blue-500" type={type} step="0.1" value={String(draft[key as keyof WeightRecord] || "")} onChange={(event) => setField(key as keyof WeightRecord, event.target.value)} />
                </label>
              ))}
            </div>
            <textarea className="mt-3 min-h-20 w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-semibold outline-none focus:border-blue-500" placeholder="Notas del registro" value={draft.notes || ""} onChange={(event) => setField("notes", event.target.value)} />
          </div> : null}
        </section>

        <section className="mb-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-black text-slate-900">Evolucion de peso</h2>
            <MiniTrend records={records} />
            <div className="mt-2 flex gap-4 text-xs font-black text-slate-500">
              <span className="text-blue-600">Peso</span>
              <span className="text-amber-600">% Grasa</span>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-black text-slate-900">Composicion del cuerpo</h2>
            <div className="mt-5 grid gap-4">
              {composition.length ? composition.map((item) => (
                <div key={item.label}>
                  <div className="mb-2 grid grid-cols-[1fr_70px_64px] items-center gap-2 text-sm">
                    <span className="flex items-center gap-2 font-black text-slate-800">
                      <span className="h-3 w-3 rounded-full" style={{ background: item.color }} />
                      {item.label}
                    </span>
                    <span className="text-right font-black text-slate-900">{item.kg} kg</span>
                    <span className="text-right font-black text-slate-500">{item.value.toFixed(1)}%</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, item.value)}%`, background: item.color }} />
                  </div>
                </div>
              )) : (
                <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm font-bold text-slate-400">
                  Guarda agua, proteinas, grasa y masa osea para ver composicion.
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="mb-5 rounded-lg border border-emerald-100 bg-white p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-emerald-700">Objetivo nutricional</p>
              <h2 className="mt-1 text-lg font-black text-slate-900">Ingesta diaria sugerida</h2>
              <p className="mt-1 text-sm font-semibold text-slate-500">
                Calculada con peso actual, peso objetivo, objetivo deportivo y carga reciente. Ajusta con criterio profesional si hay indicacion medica.
              </p>
            </div>
            {nutrition ? (
              <span className="w-fit rounded-full bg-emerald-50 px-3 py-1 text-xs font-black uppercase text-emerald-700">{nutrition.loadLabel}</span>
            ) : null}
          </div>

          {nutrition ? (
            <>
              <div className="mt-5 grid gap-3 md:grid-cols-5">
                {[
                  ["Calorias", `${nutrition.calories} kcal`, `peso x ${nutrition.multiplier}`],
                  ["Proteina", `${nutrition.proteinG} g`, "peso objetivo x 1.8"],
                  ["Grasas", `${nutrition.fatG} g`, "peso actual x 0.8"],
                  ["Carbohidratos", `${nutrition.carbsG} g`, "calorias restantes / 4"],
                  ["Fibra", `${nutrition.fiberMinG}-${nutrition.fiberMaxG} g`, "rango diario"],
                ].map(([label, value, hint]) => (
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-4" key={label}>
                    <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</p>
                    <p className="mt-2 text-xl font-black text-slate-900">{value}</p>
                    <p className="mt-1 text-xs font-bold text-slate-400">{hint}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-lg bg-emerald-50 p-4 text-sm font-semibold leading-6 text-emerald-800">
                {nutrition.goalNote} Los carbohidratos se calculan despues de reservar calorias para proteina y grasa.
              </div>
            </>
          ) : (
            <div className="mt-5 rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm font-bold text-slate-400">
              Registra tu peso actual para calcular calorias y macronutrientes sugeridos.
            </div>
          )}
        </section>

        <section className="mb-5 rounded-lg border border-blue-100 bg-white p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-blue-600">IDG Intelligence</p>
              <h2 className="mt-1 text-lg font-black text-slate-900">Analisis de composicion corporal</h2>
              <p className="mt-1 text-sm font-semibold text-slate-500">Lee tu historial, objetivo y ultimo registro. No reemplaza criterio medico.</p>
            </div>
            <button className="rounded-lg bg-blue-600 px-4 py-3 text-sm font-black text-white disabled:bg-blue-300" type="button" disabled={!records.length || aiLoading} onClick={generateAnalysis}>
              {aiLoading ? "Analizando..." : latest?.aiAnalysis ? "Reanalizar" : "Generar analisis IA"}
            </button>
          </div>
          {latest?.aiAnalysis ? (
            !showAI ? (
              <div className="mt-4 flex flex-col gap-3 rounded-lg border border-blue-100 bg-blue-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-black text-blue-900">Hay un analisis IA guardado para el ultimo registro.</p>
                  <p className="mt-1 text-xs font-bold text-blue-700">Puedes abrirlo o generar uno nuevo cuando quieras.</p>
                </div>
                <button className="w-fit rounded-lg bg-white px-3 py-2 text-xs font-black text-blue-700" type="button" onClick={() => setShowAI(true)}>Abrir analisis</button>
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="whitespace-pre-wrap text-sm font-semibold leading-7 text-slate-700">{latest.aiAnalysis}</p>
                <div className="mt-4 flex justify-end border-t border-slate-200 pt-4">
                  <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-black text-white" type="button" onClick={() => {
                    const next = records.map((item, index) => index === 0 ? { ...item, aiAcknowledgedAt: new Date().toISOString() } : item);
                    saveRecords(next);
                    setShowAI(false);
                  }}>Enterado</button>
                </div>
              </div>
            )
          ) : null}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-black text-slate-900">Historial de registros</h2>
          <div className="mt-4 grid gap-2">
            {records.map((item) => (
              <div className="grid gap-3 rounded-lg border border-slate-100 p-4 text-sm md:grid-cols-[110px_1fr_90px_90px_90px_130px]" key={item.id}>
                <div>
                  <p className="font-black text-slate-900">{item.date}</p>
                  <p className="text-xs font-bold text-slate-400">{item.time || item.imageName || "manual"}</p>
                </div>
                <div>
                  <p className="font-black text-slate-900">{item.kg} kg</p>
                  <p className="text-xs font-bold text-slate-500">{item.aiAnalysis ? "IA disponible" : "Sin analisis IA"}</p>
                </div>
                <span className="font-bold text-slate-700">IMC {item.imc || "--"}</span>
                <span className="font-bold text-amber-600">{item.fat || "--"}%</span>
                <span className="font-bold text-blue-600">{muscleValue(item) || "--"} kg</span>
                <div className="flex justify-end gap-2">
                  <button className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700" type="button" onClick={() => setDraft(item)}>Editar</button>
                  <button className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-600" type="button" onClick={() => deleteRecord(item.id)}>Eliminar</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
