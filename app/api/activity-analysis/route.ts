import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Falta OPENROUTER_API_KEY en frontend/.env.local." },
      { status: 400 },
    );
  }

  const { activity, profile } = await request.json();
  const sport = activity?.sport === "cycling" ? "ciclismo" : "running";
  const metrics = activity?.metrics || {};
  const zones = Array.isArray(activity?.zoneTotals)
    ? activity.zoneTotals.map((zone: { label: string; seconds: number; avgHr?: number }) => `${zone.label}: ${Math.round(zone.seconds / 60)}min, FC ${zone.avgHr || "?"}`).join(" | ")
    : "sin zonas";
  const timeline = Array.isArray(activity?.zoneTimeline)
    ? activity.zoneTimeline.slice(0, 18).map((zone: { zoneKey: string; seconds: number; startKm: number; endKm: number }) => `${zone.zoneKey} ${Math.round(zone.seconds / 60)}min km ${zone.startKm?.toFixed?.(1) || 0}-${zone.endKm?.toFixed?.(1) || 0}`).join(" > ")
    : "sin timeline";

  const prompt = `
Eres IDG Intelligence, coach deportivo experto en ${sport}, fisiologia, zonas cardiacas y prevencion de lesiones.

PERFIL
Nombre: ${profile?.name || "Ivan"}
Peso: ${profile?.weight || "?"} kg
Altura: ${profile?.height || "?"} cm
FC maxima: ${profile?.fcmax || "?"} bpm
FC reposo: ${profile?.fcrest || "?"} bpm
Salud/medicamentos: ${profile?.diseases || "sin registro"} / ${profile?.meds || "sin registro"}
Lesiones: ${profile?.injuries || "sin registro"}

ACTIVIDAD
Deporte: ${sport}
Nombre: ${activity?.name || "actividad"}
Fecha: ${activity?.date || "?"}
Distancia: ${metrics.distanceKm || "?"} km
Duracion: ${metrics.durationSec ? Math.round(metrics.durationSec / 60) : "?"} min
Ritmo: ${metrics.pace || "?"}
Velocidad promedio: ${metrics.avgSpeedKmh || "?"} km/h
FC promedio/maxima: ${metrics.avgHr || "?"}/${metrics.maxHr || "?"} bpm
Cadencia: ${metrics.avgCadence || "?"} ${activity?.sport === "cycling" ? "rpm" : "ppm"}
Zancada estimada: ${metrics.strideMeters || "?"} m
VO2 estimado: ${metrics.vo2Estimate || "?"}
Elevacion +: ${metrics.elevationGain || "?"} m
Calorias: ${metrics.calories || "?"} kcal
Potencia media: ${metrics.avgPower || "no aplica"} W
Potencia NP: ${metrics.normalizedPower || "no aplica"} W
Origen potencia: ${metrics.powerSource === "estimated" ? "estimada virtualmente" : metrics.powerSource === "real" ? "sensor real" : "sin potencia"}
TSS/IF/VI: ${metrics.tss || "no aplica"} / ${metrics.intensityFactor || "no aplica"} / ${metrics.variabilityIndex || "no aplica"}
Zonas consolidadas: ${zones}
Comportamiento cronologico: ${timeline}
Notas del usuario: ${activity?.notes || "sin notas"}

Genera un analisis premium, especifico y util en espanol con estas secciones:
1. Estado fisiologico de la sesion.
2. Lectura cardiaca y distribucion por zonas.
3. ${activity?.sport === "cycling" ? "Eficiencia de cadencia/potencia y gestion de esfuerzo." : "Tecnica de carrera: cadencia, zancada y economia."}
4. Riesgos o alertas por salud/lesiones.
5. Proxima sesion recomendada con objetivo concreto.

No des diagnostico medico. Maximo 420 palabras. Usa datos reales y no rellenes metricas inexistentes.
`.trim();

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://idgtraining.app",
      "X-Title": "IDG Training Pro",
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || "openrouter/auto",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1000,
      temperature: 0.5,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json(
      { error: data?.error?.message || `IDG Intelligence respondio ${response.status}.` },
      { status: response.status },
    );
  }

  return NextResponse.json({
    analysis: data?.choices?.[0]?.message?.content || "IDG Intelligence no devolvio contenido.",
    model: data?.model,
  });
}
