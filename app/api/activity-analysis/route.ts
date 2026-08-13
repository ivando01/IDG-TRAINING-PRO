import { NextResponse } from "next/server";

function textFromContent(content: unknown) {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const record = part as Record<string, unknown>;
          return String(record.text || record.content || "");
        }
        return "";
      })
      .join("\n")
      .trim();
  }
  return "";
}

function modelAnalysisText(data: Record<string, any>) {
  const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
  const message = choice?.message || {};
  return (
    textFromContent(message.content) ||
    textFromContent(message.reasoning) ||
    textFromContent(choice?.text) ||
    ""
  );
}

function localFallbackAnalysis(activity: any, profile: any, zones: string, timeline: string) {
  const metrics = activity?.metrics || {};
  const sport = activity?.sport === "cycling" ? "ciclismo" : "running";
  const durationMin = metrics.durationSec ? Math.round(metrics.durationSec / 60) : null;
  const distance = metrics.distanceKm ? `${metrics.distanceKm} km` : "distancia sin dato";
  const hr = metrics.avgHr ? `${metrics.avgHr} bpm promedio${metrics.maxHr ? `, max ${metrics.maxHr}` : ""}` : "FC sin dato suficiente";
  const intensity = metrics.tss ? `TSS ${metrics.tss}` : metrics.avgHr ? `carga cardiaca basada en ${metrics.avgHr} bpm` : "carga estimada con datos incompletos";
  const technique = activity?.sport === "cycling"
    ? `Cadencia ${metrics.avgCadence || "sin dato"} rpm, potencia media ${metrics.avgPower || "sin dato"} W y NP ${metrics.normalizedPower || "sin dato"} W.`
    : `Cadencia ${metrics.avgCadence || "sin dato"} ppm, zancada ${metrics.strideMeters || "sin dato"} m y ritmo ${metrics.pace || "sin dato"}.`;

  return [
    `Estado fisiologico de la sesion: ${activity?.name || "Actividad"} (${sport}) registro ${distance}${durationMin ? ` en ${durationMin} min` : ""}. La lectura disponible indica ${intensity}.`,
    `Lectura cardiaca y zonas: ${hr}. Distribucion: ${zones || "sin zonas consolidadas"}. Cronologia: ${timeline || "sin timeline suficiente"}.`,
    `${activity?.sport === "cycling" ? "Eficiencia de cadencia/potencia" : "Tecnica de carrera"}: ${technique} Usa esta lectura como referencia tecnica, especialmente si hubo cambios bruscos de ritmo o terreno.`,
    `Alertas: no es diagnostico medico. Si hubo dolor, fatiga inusual, mareo o molestia reportada, reduce intensidad y prioriza recuperacion. Perfil registrado: lesiones ${profile?.injuries || "sin registro"}.`,
    `Proxima sesion recomendada: realiza una sesion controlada de 35-50 min en zona facil/media, cuidando tecnica y estabilidad. Sube carga solo si recuperaste bien y la FC responde normal.`,
  ].join("\n\n");
}

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

  const analysis = modelAnalysisText(data) || localFallbackAnalysis(activity, profile, zones, timeline);

  return NextResponse.json({
    analysis,
    model: data?.model,
    fallback: !modelAnalysisText(data),
  });
}
