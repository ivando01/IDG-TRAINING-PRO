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
    time: pick(data, ["time", "hora"]),
    kg: pick(data, ["kg", "peso", "weight", "pesoactual"]),
    imc: pick(data, ["imc", "bmi"]),
    fat: pick(data, ["fat", "grasacorporal", "porcentajegrasa", "bodyfat", "grasa"]),
    musclemass: pick(data, ["musclemass", "masamuscular", "musclemasskg", "skeletalmuscle", "muscle", "muscular"]),
    water: pick(data, ["water", "aguacorporal", "bodywater", "agua"]),
    visceral: pick(data, ["visceral", "grasavisceral", "visceralfat"]),
    bone: pick(data, ["bone", "masaosea", "bonemass", "osea"]),
    protein: pick(data, ["protein", "proteinas", "proteins"]),
    bmr: pick(data, ["bmr", "tasametabolica", "tasametabolicabasal", "metabolismobasal"]),
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
Esta es una captura de Huawei Health / Salud de Huawei u otra app de composicion corporal.
Extrae todos los valores visibles y responde SOLO un JSON valido con estas claves:
date, time, kg, imc, fat, musclemass, water, visceral, bone, protein, bmr.
IMPORTANTE: "Masa muscular" debe ir en la clave musclemass y normalmente esta en kg.
Usa numeros sin unidades. Si un dato no aparece, omite la clave.
No inventes datos. No agregues explicaciones.
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
      model: process.env.OPENROUTER_VISION_MODEL || process.env.OPENROUTER_MODEL || "openrouter/auto",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
      max_tokens: 500,
      temperature: 0,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json({ error: data?.error?.message || `IDG Intelligence respondio ${response.status}.` }, { status: response.status });
  }

  const content = data?.choices?.[0]?.message?.content || "{}";
  try {
    const parsed = parseJSON(content);
    return NextResponse.json({ values: normalizeValues(parsed), raw: content, parsed });
  } catch {
    return NextResponse.json({ error: "La IA no devolvio JSON valido.", raw: content }, { status: 502 });
  }
}
