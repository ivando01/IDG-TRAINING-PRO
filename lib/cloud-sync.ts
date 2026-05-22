const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

function token() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("token") || "";
}

export function canSyncCloud() {
  return Boolean(token());
}

async function request(path: string, options: RequestInit = {}) {
  const authToken = token();
  if (!authToken) return null;
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    const preview = text.replace(/\s+/g, " ").slice(0, 120);
    throw new Error(`El backend no devolvio JSON para ${path}. URL llamada: ${API_URL}${path}. Respuesta: ${preview}`);
  }
  if (response.status === 401 && typeof data.error === "string" && data.error.toLowerCase().includes("token")) {
    localStorage.removeItem("token");
    throw new Error("Sesion expirada. Vuelve a iniciar sesion con Google para reactivar la sincronizacion.");
  }
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : `Error sincronizando ${path}`);
  return data;
}

export async function deleteCloudItem(path: string) {
  return request(path, { method: "DELETE" });
}

export async function getCloudProfile<T>() {
  const data = await request("/profile");
  return (data?.profile || null) as T | null;
}

export async function saveCloudProfile<T>(profile: T) {
  return request("/profile", { method: "PUT", body: JSON.stringify({ profile }) });
}

export async function getCloudCollection<T>(path: string, key: string) {
  const data = await request(path);
  return (data?.[key] || []) as T[];
}

export async function saveCloudCollection<T>(path: string, key: string, items: T[], extra: Record<string, unknown> = {}) {
  return request(path, { method: "PUT", body: JSON.stringify({ [key]: items, ...extra }) });
}
