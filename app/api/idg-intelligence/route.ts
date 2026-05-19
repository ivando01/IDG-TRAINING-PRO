import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Falta OPENROUTER_API_KEY en frontend/.env.local." }, { status: 400 });
  }

  const { context, mode, question, period } = await request.json();
  const profile = context?.profile || {};
  const metrics = context?.metrics || {};

  const prompt = `
Eres IDG Coach, un entrenador deportivo personalizado powered by IDG Intelligence. Actuas como coach premium para un atleta que integra gym, running, ciclismo, composicion corporal y sueno como factor de interpretacion fisiologica.

MODO: ${mode === "question" ? "responder pregunta especifica" : "analisis global"}
PERIODO: ${period || "actual"}
PREGUNTA DEL USUARIO: ${question || "sin pregunta especifica"}

PERFIL
Nombre: ${profile.name || "Atleta"}
Genero: ${profile.gender || "no registrado"}
Peso: ${profile.weight || "?"} kg
Altura: ${profile.height || "?"} cm
Objetivo: ${profile.goal || "rendimiento"}
FC max/reposo: ${profile.fcmax || "?"}/${profile.fcrest || "?"}
Salud/medicamentos: ${profile.diseases || "sin registro"} / ${profile.meds || "sin registro"}
Lesiones: ${profile.injuries || "sin registro"}
Frecuencia objetivo: gym ${profile.gymDaysPerWeek || 0}, running ${profile.runDaysPerWeek || 0}, ciclismo ${profile.bikeDaysPerWeek || 0}, descanso ${profile.restDaysPerWeek || 0}

RESUMEN CALCULADO
${JSON.stringify(metrics, null, 2)}

DATOS RECIENTES
Gym: ${JSON.stringify(context?.gym || []).slice(0, 2800)}
Running: ${JSON.stringify(context?.running || []).slice(0, 2400)}
Ciclismo: ${JSON.stringify(context?.cycling || []).slice(0, 2400)}
Peso y cuerpo: ${JSON.stringify(context?.weight || []).slice(0, 1800)}
Sueno: ${JSON.stringify(context?.sleep || []).slice(0, 1800)}

Responde en espanol con estilo claro, profesional y accionable. Habla como entrenador personal, no como panel tecnico. No des diagnostico medico.
Si es analisis global, usa estas secciones:
1. Estado de hoy: preparacion, recuperacion, riesgo de fatiga y recomendacion principal.
2. Factores analizados: sueno total/calidad, HRV, FC reposo, carga semanal, zonas FC y ultima actividad.
3. Impacto del sueno: explica si el descanso fue suficiente o bajo y como afecta intensidad, fatiga y FC.
4. Correlacion sueno-rendimiento: compara buen sueno vs bajo sueno si hay datos; si faltan datos, explica que se necesita acumular registros.
5. Indicacion del coach: tipo de entrenamiento del dia, intensidad, advertencias y motivo breve.
Si es pregunta, responde directo, usa los datos reales y cierra con una accion concreta para el usuario.
Maximo 420 palabras.
`.trim();

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://www.idgtraining.pro",
      "X-Title": "IDG Training Pro",
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || "openrouter/auto",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 950,
      temperature: 0.45,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json({ error: data?.error?.message || `IDG Coach respondio ${response.status}.` }, { status: response.status });
  }

  return NextResponse.json({ analysis: data?.choices?.[0]?.message?.content || "IDG Coach no devolvio contenido." });
}
