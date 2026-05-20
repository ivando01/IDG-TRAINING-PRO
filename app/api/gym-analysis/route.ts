import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Falta OPENROUTER_API_KEY." }, { status: 400 });
  }

  const { session, unit, load, context, history } = await request.json();
  const prompt = `
Eres IDG Coach, entrenador de fuerza e hipertrofia. Analiza la sesion de gimnasio como coach personalizado.

Contexto ya normalizado:
${JSON.stringify(context || { session, load, unit }, null, 2).slice(0, 7000)}

Historial reciente:
${JSON.stringify(history || []).slice(0, 2500)}

Reglas:
- Maximo 120 palabras.
- Usa solo datos presentes. No inventes objetivos, pesos ni molestias.
- La carga es la suma del peso registrado por serie; unidad: ${unit || "lbs"}.
- Si existe previousSameRoutine, compara carga, intensidad, dolor y ejercicios que subieron o bajaron.
- Si no hay historial comparable, dilo en una frase y analiza coherencia interna.
- Menciona 1 punto fuerte, 1 alerta concreta y 1 ajuste para la proxima sesion.
- Evita frases genericas como "mantener tecnica limpia" salvo que expliques donde.
- No inventes datos.
- Responde en 3 bullets cortos con este formato:
  - Lectura:
  - Alerta:
  - Proxima:
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
      max_tokens: 280,
      temperature: 0.55,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json({ error: data?.error?.message || `IDG Coach respondio ${response.status}.` }, { status: response.status });
  }

  return NextResponse.json({ analysis: data?.choices?.[0]?.message?.content || "IDG Coach no devolvio contenido." });
}
