import { NextResponse } from "next/server";

function parseJSON(text: string) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : cleaned);
}

function pick(data: Record<string, unknown>, keys: string[]) {
  const normalized = Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key.toLowerCase().replace(/[\s_-]/g, ""), value]),
  );
  for (const key of keys) {
    const value = normalized[key.toLowerCase().replace(/[\s_-]/g, "")];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function normalizeValues(data: Record<string, unknown>) {
  return {
    date: pick(data, ["date", "fecha"]),
    bedtime: pick(data, ["bedtime", "horaDormir", "horaDeDormir", "sleepStart"]),
    wakeTime: pick(data, ["wakeTime", "horaDespertar", "teDespertaste", "sleepEnd"]),
    hours: pick(data, ["hours", "horas", "sleepHours", "totalHours", "horasSueno"]),
    minutes: pick(data, ["minutes", "minutos", "totalMinutes", "durationMinutes", "duracionMinutos"]),
    score: pick(data, ["score", "points", "puntos", "sleepScore", "puntuacion"]),
    qualityScore: pick(data, ["qualityScore", "breathingQuality", "calidadRespiracion", "breathingQualityScore"]),
    deepMinutes: pick(data, ["deepMinutes", "suenoProfundoMin", "deepSleepMinutes"]),
    lightMinutes: pick(data, ["lightMinutes", "suenoLivianoMin", "lightSleepMinutes"]),
    remMinutes: pick(data, ["remMinutes", "suenoRemMin", "remSleepMinutes"]),
    awakeMinutes: pick(data, ["awakeMinutes", "vigiliaMin", "awake"]),
    deepPct: pick(data, ["deepPct", "suenoProfundoPct", "deepPercent"]),
    lightPct: pick(data, ["lightPct", "suenoLivianoPct", "lightPercent"]),
    remPct: pick(data, ["remPct", "suenoRemPct", "remPercent"]),
    deepContinuityScore: pick(data, ["deepContinuityScore", "continuidadSuenoProfundo", "continuidad"]),
    awakenings: pick(data, ["awakenings", "despertares", "vecesDespertaste"]),
    hrv: pick(data, ["hrv", "vfc", "vfcProm", "hrvMs"]),
    restingHr: pick(data, ["restingHr", "fcReposo", "fcProm", "restingHeartRate"]),
    spo2: pick(data, ["spo2", "spO2", "oxygen"]),
    respiratoryRate: pick(data, ["respiratoryRate", "frecuenciaRespiratoria"]),
    notes: pick(data, ["notes", "analysis", "recomendacion", "recommendation"]),
  };
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Falta OPENROUTER_API_KEY en frontend/.env.local." }, { status: 400 });
  }

  const { image } = await request.json();
  if (!image) {
    return NextResponse.json({ error: "No se recibio imagen." }, { status: 400 });
  }

  const prompt = `
Esta es una captura de Huawei Health / Salud de Huawei u otra app de sueno.
Extrae SOLO los datos visibles y responde SOLO un JSON valido con estas claves:
date, bedtime, wakeTime, hours, minutes, score, qualityScore, deepMinutes, lightMinutes, remMinutes, awakeMinutes, deepPct, lightPct, remPct, deepContinuityScore, awakenings, hrv, restingHr, spo2, respiratoryRate, notes.

Reglas:
- hours debe ser decimal si aparece duracion total, por ejemplo 4h 38m = 4.63.
- minutes debe ser la duracion total en minutos si aparece.
- deepMinutes, lightMinutes, remMinutes y awakeMinutes deben ir en minutos.
- deepPct, lightPct y remPct deben ser porcentajes visibles de fases.
- bedtime y wakeTime deben quedar en formato HH:mm si se ven.
- score son puntos de sueno.
- qualityScore es calidad de respiracion si aparece.
- deepContinuityScore es continuidad de sueno profundo si aparece.
- awakenings son las veces que desperto.
- hrv corresponde a VFC.
- restingHr o fcProm si solo aparece FC promedio durante sueno.
- No inventes datos.
- No agregues explicaciones fuera del JSON.
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
      model: process.env.OPENROUTER_VISION_MODEL || process.env.OPENROUTER_MODEL || "google/gemini-2.0-flash-001",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
      max_tokens: 650,
      temperature: 0,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json({ error: data?.error?.message || `IDG Intelligence vision respondio ${response.status}. Revisa OPENROUTER_API_KEY y OPENROUTER_VISION_MODEL en Vercel Production.` }, { status: response.status });
  }

  const content = data?.choices?.[0]?.message?.content || "{}";
  try {
    const parsed = parseJSON(content);
    return NextResponse.json({ values: normalizeValues(parsed), raw: content, parsed });
  } catch {
    return NextResponse.json({ error: "La IA no devolvio JSON valido.", raw: content }, { status: 502 });
  }
}
