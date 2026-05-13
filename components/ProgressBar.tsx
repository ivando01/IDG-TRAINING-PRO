interface ProgressBarProps {
  value: number;
  max?: number;
  label?: string;
  color?: "blue" | "green" | "purple" | "orange" | "red";
  showPercentage?: boolean;
}

const colorClasses = {
  blue: "bg-blue-500",
  green: "bg-green-500",
  purple: "bg-purple-500",
  orange: "bg-orange-500",
  red: "bg-red-500",
};

export default function ProgressBar({
  value,
  max = 100,
  label,
  color = "blue",
  showPercentage = true,
}: ProgressBarProps) {
  const percentage = (value / max) * 100;

  return (
    <div>
      {(label || showPercentage) && (
        <div className="flex justify-between mb-1">
          {label && <span className="text-sm font-bold text-slate-900">{label}</span>}
          {showPercentage && <span className="text-xs font-bold text-slate-600">{percentage.toFixed(0)}%</span>}
        </div>
      )}
      <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
        <div
          className={`h-full ${colorClasses[color]} rounded-full transition-all`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
    </div>
  );
}
