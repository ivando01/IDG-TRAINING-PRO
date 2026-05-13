import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Falta OPENROUTER_API_KEY en frontend/.env.local." }, { status: 400 });
  }

  const { records, profile } = await request.json();
  const latest = Array.isArray(records) ? records[0] : null;

  const prompt = `
Eres IDG Intelligence, especialista en composicion corporal para deportistas.

PERFIL
Nombre: ${profile?.name || "Atleta"}
Sexo/genero: ${profile?.gender || "no registrado"}
Altura: ${profile?.height || "?"} cm
Peso objetivo: ${profile?.weightGoal || "?"} kg
Fecha objetivo: ${profile?.weightGoalDate || "sin fecha"}
Salud/medicacion: ${profile?.diseases || "sin registro"} / ${profile?.meds || "sin registro"}

ULTIMO REGISTRO
${JSON.stringify(latest || {}, null, 2)}

HISTORIAL RECIENTE
${JSON.stringify((records || []).slice(0, 12), null, 2)}

Genera un analisis en espanol, maximo 320 palabras, con:
1. Lectura de estado corporal actual.
2. Tendencia de peso y grasa si hay historial.
3. Alertas de seguimiento, sin diagnosticar.
4. Recomendaciones concretas para entrenamiento/nutricion/hidratacion.
5. Que dato debe vigilar en el proximo registro.
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
      max_tokens: 800,
      temperature: 0.45,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json({ error: data?.error?.message || `IDG Intelligence respondio ${response.status}.` }, { status: response.status });
  }

  return NextResponse.json({ analysis: data?.choices?.[0]?.message?.content || "IDG Intelligence no devolvio contenido." });
}
