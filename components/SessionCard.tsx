"use client";

import { AppIcon, AppIconName } from "@/components/Brand";
import { useRouter } from "next/navigation";

interface SessionCardProps {
  id: string;
  title: string;
  date: string;
  type: "gym" | "running" | "cycling";
  duration: number;
  distance?: number;
  calories?: number;
  averageHR?: number;
  status: "completed" | "planned" | "in-progress";
}

const typeIcon: Record<SessionCardProps["type"], AppIconName> = {
  gym: "gym",
  running: "running",
  cycling: "cycling",
};

export default function SessionCard({
  id,
  title,
  date,
  type,
  duration,
  distance,
  calories,
  averageHR,
  status,
}: SessionCardProps) {
  const router = useRouter();

  const formatDate = (dateStr: string) => {
    const cleanDate = String(dateStr || "").slice(0, 10);
    const [year, month, day] = cleanDate.split("-").map(Number);
    const sessionDate = Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)
      ? new Date(year, month - 1, day)
      : new Date(dateStr);
    return sessionDate.toLocaleDateString("es-ES", {
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div
      onClick={() => router.push(`/modules/${type}`)}
      className="cursor-pointer rounded-lg border border-slate-200 bg-white p-4 transition hover:border-blue-100 hover:shadow-md"
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(240px,1.3fr)_minmax(340px,1fr)_120px] lg:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-lg bg-blue-50 text-blue-700">
            <AppIcon name={typeIcon[type]} className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate font-black text-slate-900">{title}</h3>
            <p className="text-xs font-semibold text-slate-500">{formatDate(date)}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div>
            <p className="font-semibold text-slate-500">Duracion</p>
            <p className="font-black text-slate-900">{duration} min</p>
          </div>
          {distance ? (
            <div>
              <p className="font-semibold text-slate-500">Distancia</p>
              <p className="font-black text-slate-900">{distance} km</p>
            </div>
          ) : null}
          {calories ? (
            <div>
              <p className="font-semibold text-slate-500">Calorias</p>
              <p className="font-black text-slate-900">{calories} kcal</p>
            </div>
          ) : null}
          {averageHR ? (
            <div>
              <p className="font-semibold text-slate-500">FC Promedio</p>
              <p className="font-black text-slate-900">{averageHR} bpm</p>
            </div>
          ) : null}
        </div>

        <span
          className={`w-fit rounded-full px-2 py-1 text-xs font-black lg:justify-self-end ${
            status === "completed"
              ? "bg-green-100 text-green-700"
              : status === "in-progress"
                ? "bg-blue-100 text-blue-700"
                : "bg-slate-100 text-slate-700"
          }`}
        >
          {status === "completed" ? "Completada" : status === "in-progress" ? "En progreso" : "Planificada"}
        </span>
      </div>
    </div>
  );
}
