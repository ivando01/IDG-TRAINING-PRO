const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const SYNC_STATUS_KEY = "idg_sync_status_json";
const SYNC_PENDING_KEY = "idg_sync_pending_json";

type SyncStatus = {
  cloud: boolean;
  lastSyncAt: string | null;
  lastErrorAt: string | null;
  lastPath: string;
  lastError: string;
  pendingCount: number;
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
  const status = { ...current, pendingCount: getPendingSyncCount(), ...next };
  localStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(status));
  window.dispatchEvent(new CustomEvent("idg-sync-status", { detail: status }));
}

export function getSyncStatus(): SyncStatus {
  if (typeof window === "undefined") {
    return { cloud: false, lastSyncAt: null, lastErrorAt: null, lastPath: "", lastError: "", pendingCount: 0 };
  }
  try {
    const raw = localStorage.getItem(SYNC_STATUS_KEY);
    if (raw) return { cloud: canSyncCloud(), lastSyncAt: null, lastErrorAt: null, lastPath: "", lastError: "", ...JSON.parse(raw), pendingCount: getPendingSyncCount() };
  } catch {
    // Ignore broken cache and rebuild the sync state on the next request.
  }
  return { cloud: canSyncCloud(), lastSyncAt: null, lastErrorAt: null, lastPath: "", lastError: "", pendingCount: getPendingSyncCount() };
}

function readCache<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeCache<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

type PendingSync = {
  id: string;
  path: string;
  key: string;
  cacheKey: string;
  createdAt: string;
};

function readPendingSyncs() {
  return readCache<PendingSync[]>(SYNC_PENDING_KEY, []);
}

function writePendingSyncs(items: PendingSync[]) {
  writeCache(SYNC_PENDING_KEY, items);
  publishSyncStatus({ pendingCount: items.length });
}

function rememberPendingSync(path: string, key: string, cacheKey: string) {
  const pending = readPendingSyncs().filter((item) => !(item.path === path && item.key === key && item.cacheKey === cacheKey));
  pending.push({ id: `${path}-${key}`, path, key, cacheKey, createdAt: new Date().toISOString() });
  writePendingSyncs(pending);
}

function clearPendingSync(path: string, key: string, cacheKey: string) {
  const pending = readPendingSyncs().filter((item) => !(item.path === path && item.key === key && item.cacheKey === cacheKey));
  writePendingSyncs(pending);
}

export function getPendingSyncCount() {
  return readPendingSyncs().length;
}

export async function retryPendingSyncs() {
  const pending = readPendingSyncs();
  for (const item of pending) {
    const cached = readCache<unknown[]>(item.cacheKey, []);
    await saveCloudCollection(item.path, item.key, cached, {}, item.cacheKey);
  }
  return getPendingSyncCount();
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

export async function saveCloudCollection<T>(path: string, key: string, items: T[], extra: Record<string, unknown> = {}, cacheKey?: string) {
  const result = await request(path, { method: "PUT", body: JSON.stringify({ [key]: items, ...extra }) });
  if (cacheKey) clearPendingSync(path, key, cacheKey);
  return result;
}

export async function loadCloudBackedCollection<T>(options: {
  path: string;
  key: string;
  cacheKey: string;
  fallback?: T[];
  onStatus?: (message: string) => void;
}) {
  const localItems = readCache<T[]>(options.cacheKey, options.fallback || []);
  if (!canSyncCloud()) {
    options.onStatus?.(localItems.length ? "Datos cargados desde este dispositivo. Inicia sesion para sincronizar en la nube." : "");
    return { items: localItems, source: "local" as const };
  }

  try {
    const cloudItems = await getCloudCollection<T>(options.path, options.key);
    if (cloudItems.length) {
      writeCache(options.cacheKey, cloudItems);
      options.onStatus?.("Datos sincronizados desde la nube.");
      return { items: cloudItems, source: "cloud" as const };
    }
    if (localItems.length) {
      await saveCloudCollection(options.path, options.key, localItems, {}, options.cacheKey);
      options.onStatus?.("Datos locales subidos a la nube.");
    }
    return { items: localItems, source: localItems.length ? "local" as const : "cloud" as const };
  } catch (error) {
    options.onStatus?.(error instanceof Error ? error.message : "No se pudo leer la nube. Se usara la copia local.");
    return { items: localItems, source: "cache" as const, error };
  }
}

export async function saveCloudBackedCollection<T>(options: {
  path: string;
  key: string;
  cacheKey: string;
  items: T[];
  extra?: Record<string, unknown>;
  onStatus?: (message: string) => void;
}) {
  writeCache(options.cacheKey, options.items);
  if (!canSyncCloud()) {
    options.onStatus?.("Guardado solo en este dispositivo. Inicia sesion para sincronizar en la nube.");
    return { synced: false, source: "local" as const };
  }

  try {
    await saveCloudCollection(options.path, options.key, options.items, options.extra || {}, options.cacheKey);
    options.onStatus?.("Cambios sincronizados en la nube.");
    return { synced: true, source: "cloud" as const };
  } catch (error) {
    rememberPendingSync(options.path, options.key, options.cacheKey);
    options.onStatus?.(error instanceof Error ? `Guardado local. Pendiente de subir: ${error.message}` : "Guardado local. Pendiente de subir a la nube.");
    return { synced: false, source: "cache" as const, error };
  }
}
