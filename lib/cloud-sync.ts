const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const SYNC_STATUS_KEY = "idg_sync_status_json";

type SyncStatus = {
  cloud: boolean;
  lastSyncAt: string | null;
  lastErrorAt: string | null;
  lastPath: string;
  lastError: string;
};

function token() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("token") || "";
}

export function canSyncCloud() {
  return Boolean(token());
}

function publishSyncStatus(next: Partial<SyncStatus>) {
  if (typeof window === "undefined") return;
  const current = getSyncStatus();
  const status = { ...current, ...next };
  localStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(status));
  window.dispatchEvent(new CustomEvent("idg-sync-status", { detail: status }));
}

export function getSyncStatus(): SyncStatus {
  if (typeof window === "undefined") {
    return { cloud: false, lastSyncAt: null, lastErrorAt: null, lastPath: "", lastError: "" };
  }
  try {
    const raw = localStorage.getItem(SYNC_STATUS_KEY);
    if (raw) return { cloud: canSyncCloud(), lastSyncAt: null, lastErrorAt: null, lastPath: "", lastError: "", ...JSON.parse(raw) };
  } catch {
    // Ignore broken cache and rebuild the sync state on the next request.
  }
  return { cloud: canSyncCloud(), lastSyncAt: null, lastErrorAt: null, lastPath: "", lastError: "" };
}

async function request(path: string, options: RequestInit = {}) {
  const authToken = token();
  if (!authToken) return null;
  try {
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
    publishSyncStatus({ cloud: true, lastSyncAt: new Date().toISOString(), lastPath: path, lastError: "" });
    return data;
  } catch (error) {
    publishSyncStatus({
      cloud: Boolean(authToken),
      lastErrorAt: new Date().toISOString(),
      lastPath: path,
      lastError: error instanceof Error ? error.message : `Error sincronizando ${path}`,
    });
    throw error;
  }
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
