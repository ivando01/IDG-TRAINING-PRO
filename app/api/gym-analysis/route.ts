import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Falta OPENROUTER_API_KEY." }, { status: 400 });
  }

  const { session, unit, volume, history } = await request.json();
  const prompt = `
Eres IDG Coach, entrenador de fuerza. Analiza esta rutina de gimnasio de forma concreta.

Rutina actual:
${JSON.stringify({ ...session, volume, unit }, null, 2).slice(0, 5000)}

Historial reciente:
${JSON.stringify(history || []).slice(0, 3000)}

Reglas:
- Maximo 90 palabras.
- Explica si el volumen parece alto/bajo y por que.
- El volumen se calcula como peso x repeticiones por serie; la unidad es ${unit || "lbs"}.
- No inventes datos.
- Da una sola accion practica para la proxima sesion.
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
      max_tokens: 220,
      temperature: 0.35,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json({ error: data?.error?.message || `IDG Coach respondio ${response.status}.` }, { status: response.status });
  }

  return NextResponse.json({ analysis: data?.choices?.[0]?.message?.content || "IDG Coach no devolvio contenido." });
}
