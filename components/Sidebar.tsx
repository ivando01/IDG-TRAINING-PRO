"use client";

import { AppIcon, AppIconName, IDGLogo } from "@/components/Brand";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface NavItem {
  icon: AppIconName;
  label: string;
  href: string;
  section: string;
}

const navItems: NavItem[] = [
  { icon: "dashboard", label: "Dashboard", href: "/dashboard", section: "PRINCIPAL" },
  { icon: "profile", label: "Perfil", href: "/profile", section: "PRINCIPAL" },
  { icon: "gym", label: "Gym", href: "/modules/gym", section: "DEPORTES" },
  { icon: "cycling", label: "Ciclismo", href: "/modules/cycling", section: "DEPORTES" },
  { icon: "running", label: "Running", href: "/modules/running", section: "DEPORTES" },
  { icon: "weight", label: "Peso & Cuerpo", href: "/modules/weight", section: "CONTROL" },
  { icon: "goals", label: "Metas", href: "/modules/goals", section: "CONTROL" },
  { icon: "intelligence", label: "IDG Intelligence", href: "/modules/analytics", section: "HERRAMIENTAS" },
  { icon: "plan", label: "Plan Semanal", href: "/modules/plan", section: "HERRAMIENTAS" },
];

type ScoreState = {
  score: number;
  label: string;
  color: string;
  barColor: string;
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

function isTrainingActivity(item: Record<string, unknown>) {
  if (item.countsTowardTraining === false || item.activityKind === "support") return false;
  const text = `${String(item.activitySubType || "")} ${String(item.name || "")}`.toLowerCase();
  return !/walk|hike|caminar|caminata|senderismo/.test(text);
}

function startOfWeek(date = new Date()) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7));
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function inCurrentWeek(dateText: unknown) {
  const date = new Date(`${String(dateText || "").slice(0, 10)}T00:00:00`);
  return Number.isFinite(date.getTime()) && date >= startOfWeek();
}

function scoreLabel(score: number) {
  if (score >= 85) return { label: "Excelente", color: "text-emerald-300", barColor: "bg-[#00C853]" };
  if (score >= 70) return { label: "Bueno", color: "text-green-300", barColor: "bg-green-500" };
  if (score >= 55) return { label: "Regular", color: "text-amber-300", barColor: "bg-amber-400" };
  return { label: "Cuidar carga", color: "text-red-300", barColor: "bg-red-500" };
}

function calculateScore(): ScoreState {
  const profile = readJSON<Record<string, unknown>>("idg_profile_json", readJSON("iv_profile", {}));
  const gym = readJSON<Array<Record<string, unknown>>>("idg_gym_sessions_json", []);
  const running = readJSON<Array<Record<string, unknown>>>("idg_running_activities_json", readJSON("iv_run", [])).filter(isTrainingActivity);
  const cycling = readJSON<Array<Record<string, unknown>>>("idg_cycling_activities_json", readJSON("iv_bike", []));
  const weight = readJSON<Array<Record<string, unknown>>>("idg_weight_records_json", []);

  const target =
    (num(profile.gymDaysPerWeek) || 4) +
    (num(profile.runDaysPerWeek) || 2) +
    (num(profile.bikeDaysPerWeek) || 2);

  const sessions: Array<Record<string, unknown> & { type: string; date: unknown }> = [
    ...gym.map((item) => ({ ...item, type: "gym", date: item.date })),
    ...running.map((item) => ({ ...item, type: "running", date: item.date || item.startTime })),
    ...cycling.map((item) => ({ ...item, type: "cycling", date: item.date || item.startTime })),
  ];
  const weekSessions = sessions.filter((item) => inCurrentWeek(item.date));
  const consistency = target ? Math.min(100, Math.round((weekSessions.length / target) * 100)) : 0;
  const hardSessions = weekSessions.filter((item) => {
    const zones = Array.isArray(item.zoneTotals) ? item.zoneTotals as Array<Record<string, unknown>> : [];
    return zones.some((zone) => ["Z4", "Z5"].includes(String(zone.zoneKey)) && num(zone.seconds) > 0);
  }).length;
  const gymPainValues = gym.filter((item) => inCurrentWeek(item.date)).map((item) => num(item.painLevel)).filter(Boolean);
  const avgPain = gymPainValues.length ? gymPainValues.reduce((sum, value) => sum + value, 0) / gymPainValues.length : 0;
  const latestWeightDate = weight[0]?.date ? new Date(`${String(weight[0].date).slice(0, 10)}T00:00:00`) : null;
  const weightDays = latestWeightDate && Number.isFinite(latestWeightDate.getTime()) ? (Date.now() - latestWeightDate.getTime()) / 86400000 : 99;

  const score = Math.round(Math.max(45, Math.min(95,
    78 +
    (consistency >= 60 ? 6 : -6) +
    (consistency >= 90 ? 4 : 0) -
    (hardSessions > 2 ? 8 : 0) -
    (avgPain > 5 ? 8 : 0) +
    (weightDays <= 14 ? 2 : -2),
  )));
  return { score, ...scoreLabel(score) };
}

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [score, setScore] = useState<ScoreState>({ score: 82, ...scoreLabel(82) });

  useEffect(() => {
    const initialScore = window.setTimeout(() => setScore(calculateScore()), 0);
    const refresh = () => setScore(calculateScore());
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearTimeout(initialScore);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [pathname]);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    router.push("/");
  };

  const sections = ["PRINCIPAL", "DEPORTES", "CONTROL", "HERRAMIENTAS"];

  const navButton = (item: NavItem, mobile = false) => {
    const active = pathname === item.href || pathname.startsWith(item.href);
    return (
      <button
        className={`mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-bold transition ${
          active
            ? "bg-blue-50 text-blue-700 ring-1 ring-blue-100"
            : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
        }`}
        key={item.href}
        onClick={() => {
          router.push(item.href);
        }}
      >
        <span className={`grid shrink-0 place-items-center rounded-lg ${mobile ? "h-9 w-9" : "h-12 w-12"} ${active ? "bg-white" : "bg-slate-50"}`}>
          <AppIcon name={item.icon} className={mobile ? "h-7 w-7" : "h-10 w-10"} />
        </span>
        {item.label}
      </button>
    );
  };

  const mobileTab = (item: NavItem) => {
    const active = pathname === item.href || pathname.startsWith(item.href);
    return (
      <button
        className={`grid min-w-0 place-items-center gap-1 rounded-lg px-1 py-2 text-[9px] font-black transition ${
          active ? "bg-blue-50 text-blue-700" : "text-slate-500"
        }`}
        key={item.href}
        onClick={() => router.push(item.href)}
        type="button"
      >
        <AppIcon name={item.icon} className="h-5 w-5" />
        <span className="line-clamp-1">{item.label.replace("Dashboard", "Inicio").replace("IDG Intelligence", "IA").replace("Peso & Cuerpo", "Peso").replace("Plan Semanal", "Plan")}</span>
      </button>
    );
  };

  return (
    <>
      <div className="hidden h-screen w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="border-b border-slate-200 p-4">
          <IDGLogo />
        </div>

        <div className="m-3 rounded-lg bg-[#0F172A] p-4 text-white">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#00C853] text-xl font-black">
              {score.score}
            </div>
            <div>
              <div className="text-xs font-black uppercase text-slate-300">Puntuacion</div>
              <div className={`text-sm font-black ${score.color}`}>{score.label}</div>
            </div>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-slate-700">
            <div className={`h-full rounded-full ${score.barColor}`} style={{ width: `${score.score}%` }} />
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          {sections.map((section) => (
            <div key={section}>
              <div className="mt-2 px-2 py-2 text-xs font-black uppercase tracking-wide text-slate-500">
                {section}
              </div>
              {navItems.filter((item) => item.section === section).map((item) => navButton(item))}
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-200 p-3">
          <div className="mb-3 flex items-center gap-3 rounded-lg border border-slate-800 bg-[#0F172A] p-3">
            <img src="/favicon.png" alt="" aria-hidden="true" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
            <p className="text-xs font-bold leading-relaxed text-slate-100">Entrena con datos. Mejora con inteligencia</p>
          </div>
          <button
            className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-red-600 transition hover:bg-red-50"
            onClick={handleLogout}
          >
            <AppIcon name="logout" className="h-4 w-4" />
            Cerrar sesion
          </button>
        </div>
      </div>

      <div className="fixed inset-x-2 bottom-2 z-40 max-w-[calc(100vw-1rem)] rounded-2xl border border-slate-200 bg-white/95 p-1.5 shadow-2xl backdrop-blur lg:hidden">
        <nav className="grid grid-cols-5 gap-1">
          {navItems.map((item) => mobileTab(item))}
        </nav>
      </div>
    </>
  );
}
