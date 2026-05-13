import type { ReactNode } from "react";

interface KPICardProps {
  label: string;
  value: string | number;
  icon: ReactNode;
  trend?: {
    value: number;
    direction: "up" | "down";
  };
  color?: "blue" | "green" | "purple" | "orange" | "red";
}

const colorMap = {
  blue: "bg-blue-50 border-blue-100",
  green: "bg-green-50 border-green-100",
  purple: "bg-purple-50 border-purple-100",
  orange: "bg-orange-50 border-orange-100",
  red: "bg-red-50 border-red-100",
};

const iconBgMap = {
  blue: "bg-blue-100 text-blue-600",
  green: "bg-green-100 text-green-600",
  purple: "bg-purple-100 text-purple-600",
  orange: "bg-orange-100 text-orange-600",
  red: "bg-red-100 text-red-600",
};

export default function KPICard({
  label,
  value,
  icon,
  trend,
  color = "blue",
}: KPICardProps) {
  return (
    <div className={`p-4 rounded-lg border ${colorMap[color]}`}>
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="text-xs font-bold text-slate-600 uppercase tracking-wide mb-1">
            {label}
          </div>
          <div className="text-2xl font-bold text-slate-900">{value}</div>
        </div>
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg ${iconBgMap[color]}`}>
          {icon}
        </div>
      </div>

      {trend && (
        <div
          className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${
            trend.direction === "up"
              ? "bg-green-100 text-green-700"
              : "bg-red-100 text-red-700"
          }`}
        >
          <span>{trend.direction === "up" ? "↑" : "↓"}</span>
          <span>{Math.abs(trend.value)}% vs semana anterior</span>
        </div>
      )}
    </div>
  );
}
