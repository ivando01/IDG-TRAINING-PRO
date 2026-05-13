import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Falta OPENROUTER_API_KEY en frontend/.env.local." },
      { status: 400 },
    );
  }

  const payload = await request.json();
  const { profile, metrics, sessions } = payload;
  const zones = Array.isArray(profile?.zones)
    ? profile.zones.map((zone: { name: string; min: number; max: number }) => `${zone.name}: ${zone.min}-${zone.max} bpm`).join(" | ")
    : "sin zonas registradas";

  const prompt = `
PERFIL DEL ATLETA
Nombre: ${profile?.name || "Atleta"}
Sexo/género: ${profile?.gender || "no registrado"}
Edad: ${metrics?.age || "pendiente"}
Peso: ${profile?.weight || "?"} kg
Altura: ${profile?.height || "?"} cm
IMC: ${metrics?.bmi || "?"}
FC máxima: ${profile?.fcmax || "?"} bpm
FC reposo: ${profile?.fcrest || "?"} bpm
Zonas FC: ${zones}

SALUD
Enfermedades diagnosticadas: ${profile?.diseases || "sin registro"}
Medicamentos actuales: ${profile?.meds || "sin registro"}
Lesiones: ${profile?.injuries || "sin registro"}

ENTRENAMIENTO
Nivel running: ${profile?.lvlRun || "?"}
Nivel ciclismo: ${profile?.lvlBike || "?"}
Nivel gym: ${profile?.lvlGym || "?"}
Objetivo principal: ${profile?.goal || "rendimiento"}
Frecuencia semanal objetivo: gym ${profile?.gymDaysPerWeek || 0}, running ${profile?.runDaysPerWeek || 0}, ciclismo ${profile?.bikeDaysPerWeek || 0}, descanso ${profile?.restDaysPerWeek || 0}.

SESIONES RECIENTES
Gym: ${JSON.stringify(sessions?.gym || []).slice(0, 2500)}
Running: ${JSON.stringify(sessions?.running || []).slice(0, 1600)}
Ciclismo: ${JSON.stringify(sessions?.cycling || []).slice(0, 1600)}

Como coach deportivo experto, genera un análisis profesional en español con:
1. Lectura del estado actual del atleta.
2. Riesgos o alertas por salud, medicación, lesiones y zonas FC.
3. Recomendaciones concretas para las próximas 4 semanas.
4. Distribución sugerida de carga gym/running/ciclismo según su frecuencia.
5. Métricas que debe vigilar y cuándo ajustar el plan.

Sé específico con los datos reales. No des diagnóstico médico. Máximo 450 palabras.
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
      max_tokens: 950,
      temperature: 0.55,
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
