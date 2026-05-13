"use client";

interface Chart1Options {
  labels: string[];
  data: number[];
  color?: string;
}

export default function Chart1({ labels, data, color = "blue" }: Chart1Options) {
  const max = Math.max(...data);
  const colors = {
    blue: "bg-blue-500",
    green: "bg-green-500",
    purple: "bg-purple-500",
    orange: "bg-orange-500",
  };

  return (
    <div className="w-full h-full flex items-flex-end justify-around gap-2 p-4">
      {data.map((value, idx) => (
        <div key={idx} className="flex flex-col items-center flex-1">
          <div
            className={`w-full ${colors[color as keyof typeof colors]} rounded-t transition-all hover:opacity-80`}
            style={{ height: `${(value / max) * 100}%`, minHeight: "20px" }}
          />
          <p className="text-xs text-slate-600 font-bold mt-2">{labels[idx]}</p>
          <p className="text-xs text-slate-900 font-bold">{value}</p>
        </div>
      ))}
    </div>
  );
}
