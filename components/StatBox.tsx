"use client";

interface StatBoxProps {
  icon: string;
  label: string;
  value: string | number;
  trend?: {
    value: number;
    direction: "up" | "down";
  };
}

export default function StatBox({ icon, label, value, trend }: StatBoxProps) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="text-xl">{icon}</div>
      </div>
      <p className="text-xs font-bold text-slate-600 uppercase tracking-wide mb-1">
        {label}
      </p>
      <p className="text-2xl font-bold text-slate-900">{value}</p>

      {trend && (
        <div
          className={`inline-flex items-center gap-1 text-xs font-bold mt-2 px-2 py-1 rounded-full ${
            trend.direction === "up"
              ? "bg-green-100 text-green-700"
              : "bg-red-100 text-red-700"
          }`}
        >
          <span>{trend.direction === "up" ? "↑" : "↓"}</span>
          <span>{Math.abs(trend.value)}%</span>
        </div>
      )}
    </div>
  );
}
