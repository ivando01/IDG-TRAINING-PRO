"use client";

import TopNav from "@/components/TopNav";
import { useEffect } from "react";

export default function PlanError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Plan semanal fallo", error);
  }, [error]);

  return (
    <>
      <TopNav title="Plan Semanal" />
      <main className="min-h-0 flex-1 overflow-y-auto bg-[#F8FAFC] p-4 text-[#0F172A] lg:p-6">
        <section className="rounded-lg border border-red-100 bg-white p-6">
          <p className="text-xs font-black uppercase tracking-wide text-red-600">No se pudo abrir el plan</p>
          <h1 className="mt-2 text-2xl font-black text-slate-900">Recuperemos la vista semanal</h1>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
            El plan sigue guardado. La app encontro un error al preparar la vista en este dispositivo.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button className="rounded-lg bg-slate-900 px-4 py-3 text-sm font-black text-white" type="button" onClick={reset}>
              Reintentar
            </button>
            <button className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700" type="button" onClick={() => window.location.assign("/dashboard")}>
              Ir al dashboard
            </button>
          </div>
          {error.message ? <p className="mt-4 text-xs font-bold text-slate-400">{error.message}</p> : null}
        </section>
      </main>
    </>
  );
}
