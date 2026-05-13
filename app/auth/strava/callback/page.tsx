"use client";

import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export default function StravaCallbackPage() {
  const [message, setMessage] = useState("Conectando Strava...");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");

    if (!code || !state) {
      setMessage("Strava no devolvio codigo de autorizacion.");
      return;
    }

    fetch(`${API_URL}/auth/strava/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`)
      .then(async (response) => {
        const text = await response.text();
        if (!response.ok) throw new Error(text || "No se pudo conectar Strava.");
        setMessage("Strava conectado. Volviendo al perfil...");
        window.setTimeout(() => {
          window.location.href = "/profile";
        }, 1200);
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "Error conectando Strava.");
      });
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
        <p className="text-xs font-black uppercase tracking-wide text-[#fc4c02]">Strava</p>
        <h1 className="mt-2 text-2xl font-black text-slate-900">Conexion deportiva</h1>
        <p className="mt-3 text-sm font-semibold text-slate-500">{message}</p>
      </section>
    </main>
  );
}
