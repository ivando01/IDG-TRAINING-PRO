import { getSupabaseAccessToken, getSupabaseUser, hasSupabaseConfig, supabaseRest } from "@/lib/supabase-direct";

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
  return getSupabaseAccessToken() || localStorage.getItem("token") || "";
}

export function canSyncCloud() {
  return Boolean(token());
}

function renderToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("render_token") || "";
}

type CollectionRoute = {
  table: string;
  key: string;
  dateColumn?: string;
  sport?: "running" | "cycling";
  order?: string;
};

function ownerId() {
  return getSupabaseUser()?.id || "";
}

function collectionRoute(path: string, key: string): CollectionRoute | null {
  const [pathname, queryText = ""] = path.split("?");
  const params = new URLSearchParams(queryText);
  const sport = params.get("sport") === "cycling" ? "cycling" : params.get("sport") === "running" ? "running" : undefined;
  if (pathname === "/gym/sessions") return { table: "gym_sessions", key, dateColumn: "session_date", order: "session_date.desc.nullslast,updated_at.desc" };
  if (pathname === "/gym/templates") return { table: "gym_templates", key, order: "updated_at.desc" };
  if (pathname === "/activities") return { table: "activities", key, dateColumn: "activity_date", sport, order: "activity_date.desc.nullslast,updated_at.desc" };
  if (pathname === "/weight") return { table: "weight_records", key, dateColumn: "record_date", order: "record_date.desc.nullslast,updated_at.desc" };
  if (pathname === "/sleep") return { table: "sleep_records", key, dateColumn: "record_date", order: "record_date.desc.nullslast,updated_at.desc" };
  if (pathname === "/goals") return { table: "goals", key, dateColumn: "goal_date", order: "goal_date.desc.nullslast,updated_at.desc" };
  if (pathname === "/plan") return { table: "planned_sessions", key, dateColumn: "session_date", order: "session_date.asc,type.asc" };
  if (pathname === "/intelligence") return { table: "intelligence_entries", key, order: "updated_at.desc" };
  return null;
}

function dateFromItem(item: Record<string, unknown>, fallbackKeys: string[]) {
  for (const key of fallbackKeys) {
    const value = item[key];
    if (value) return String(value).slice(0, 10);
  }
  return null;
}

function rowForCollectionItem(route: CollectionRoute, item: unknown) {
  const record = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
  const id = String(record.id || `${route.table}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const row: Record<string, unknown> = {
    id,
    owner_id: ownerId(),
    user_id: ownerId(),
    data: { ...record, id },
    updated_at: new Date().toISOString(),
  };
  if (route.sport || record.sport) row.sport = route.sport || (record.sport === "cycling" ? "cycling" : "running");
  if (route.table === "activities") {
    const metrics = (record.metrics || {}) as Record<string, unknown>;
    row.source = String(record.source || "").toLowerCase() === "strava" ? "strava" : record.source || null;
    row.external_id = row.source === "strava" ? String(record.external_id || record.externalId || id.replace(/^strava-/, "")) : record.external_id || null;
    row.type = record.activitySubType || record.type || null;
    row.name = record.name || null;
    row.activity_date = dateFromItem(record, ["date", "startTime", "start_date", "startDate", "activity_date"]);
    row.date = record.startTime || record.date || null;
    row.distance_km = metrics.distanceKm || null;
    row.duration_min = metrics.durationSec ? Math.round(Number(metrics.durationSec) / 60) : null;
    row.elapsed_min = metrics.elapsedSec ? Math.round(Number(metrics.elapsedSec) / 60) : null;
    row.elevation_m = metrics.elevationGain || null;
    row.avg_speed_kmh = metrics.avgSpeedKmh || null;
    row.max_speed_kmh = metrics.maxSpeedKmh || null;
    row.avg_hr = metrics.avgHr || null;
    row.max_hr = metrics.maxHr || null;
    row.calories = metrics.calories || null;
    row.raw_data = record.source === "STRAVA" || record.source === "strava" ? record : null;
  } else if (route.dateColumn) {
    row[route.dateColumn] = dateFromItem(record, ["date", "session_date", "record_date", "goal_date"]);
  }
  if (route.table === "intelligence_entries") row.entry_type = record.entryType || record.entry_type || "global";
  if (route.table === "planned_sessions") row.type = record.type || "gym";
  return row;
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function gymExerciseRows(session: Record<string, unknown>) {
  const exercises = Array.isArray(session.exercises) ? session.exercises as Array<Record<string, unknown>> : [];
  return exercises.map((exercise, index) => ({
    id: String(exercise.id || `exercise-${index + 1}`),
    session_id: String(session.id),
    owner_id: ownerId(),
    user_id: ownerId(),
    position: index + 1,
    name: String(exercise.name || `Ejercicio ${index + 1}`),
    sets_planned: Number(exercise.sets) || 0,
    reps: exercise.reps || null,
    rest_seconds: Number(exercise.rest) || 0,
    note: exercise.note || null,
    data: { ...exercise, weights: undefined, repsBySet: undefined },
    updated_at: new Date().toISOString(),
  }));
}

function gymSetRows(session: Record<string, unknown>) {
  const exercises = Array.isArray(session.exercises) ? session.exercises as Array<Record<string, unknown>> : [];
  return exercises.flatMap((exercise, exerciseIndex) => {
    const exerciseId = String(exercise.id || `exercise-${exerciseIndex + 1}`);
    const weights = Array.isArray(exercise.weights) ? exercise.weights : [];
    const repsBySet = Array.isArray(exercise.repsBySet) ? exercise.repsBySet : [];
    const setCount = Math.max(Number(exercise.sets) || 0, weights.length, repsBySet.length);
    return Array.from({ length: setCount }, (_, setIndex) => ({
      id: `${session.id}-${exerciseId}-${setIndex + 1}`,
      session_id: String(session.id),
      exercise_id: exerciseId,
      owner_id: ownerId(),
      user_id: ownerId(),
      set_number: setIndex + 1,
      reps: String(repsBySet[setIndex] ?? exercise.reps ?? ""),
      weight: weights[setIndex] === "" || weights[setIndex] === undefined ? null : Number(weights[setIndex]),
      completed: Boolean(weights[setIndex] || repsBySet[setIndex]),
      data: { reps: String(repsBySet[setIndex] ?? exercise.reps ?? ""), weight: weights[setIndex] ?? "" },
      updated_at: new Date().toISOString(),
    }));
  });
}

async function hydrateGymSessions<T>(sessions: T[]) {
  if (!sessions.length || !ownerId()) return sessions;
  const [exerciseRows, setRows] = await Promise.all([
    supabaseRest<Array<Record<string, unknown>>>("gym_exercises", {
      query: new URLSearchParams({ select: "*", owner_id: `eq.${ownerId()}`, order: "session_id.asc,position.asc" }).toString(),
    }).catch(() => []),
    supabaseRest<Array<Record<string, unknown>>>("gym_sets", {
      query: new URLSearchParams({ select: "*", owner_id: `eq.${ownerId()}`, order: "session_id.asc,set_number.asc" }).toString(),
    }).catch(() => []),
  ]);
  const setsBySessionExercise = new Map<string, Array<Record<string, unknown>>>();
  setRows.forEach((row) => {
    const key = `${row.session_id}-${row.exercise_id}`;
    setsBySessionExercise.set(key, [...(setsBySessionExercise.get(key) || []), row]);
  });
  const exercisesBySession = new Map<string, Array<Record<string, unknown>>>();
  exerciseRows.forEach((row) => {
    const key = String(row.session_id || "");
    const exerciseId = String(row.id || "");
    const sets = setsBySessionExercise.get(`${key}-${exerciseId}`) || [];
    const base = row.data && typeof row.data === "object" ? row.data as Record<string, unknown> : {};
    const hydrated = {
      ...base,
      id: exerciseId,
      name: row.name,
      sets: Number(row.sets_planned) || sets.length || Number(base.sets) || 1,
      reps: row.reps || base.reps || "",
      rest: Number(row.rest_seconds) || Number(base.rest) || 0,
      note: row.note || base.note,
      repsBySet: sets.map((set) => String(set.reps || "")),
      weights: sets.map((set) => set.weight === null || set.weight === undefined ? "" : String(set.weight)),
    };
    exercisesBySession.set(key, [...(exercisesBySession.get(key) || []), hydrated]);
  });
  return sessions.map((session) => {
    const record = (session && typeof session === "object" ? session : {}) as Record<string, unknown>;
    const exercises = exercisesBySession.get(String(record.id || ""));
    return exercises?.length ? { ...record, exercises } as T : session;
  });
}

async function getSupabaseProfile<T>() {
  if (!hasSupabaseConfig() || !ownerId()) return null;
  const query = new URLSearchParams({
    select: "data,updated_at",
    owner_id: `eq.${ownerId()}`,
    limit: "1",
  });
  const rows = await supabaseRest<Array<{ data: T }>>("user_profiles", { query: query.toString() });
  return rows[0]?.data || null;
}

async function saveSupabaseProfile<T>(profile: T) {
  if (!hasSupabaseConfig() || !ownerId()) return null;
  return supabaseRest("user_profiles", {
    method: "POST",
    query: "on_conflict=owner_id",
    prefer: "resolution=merge-duplicates,return=representation",
    body: [{ owner_id: ownerId(), user_id: ownerId(), data: profile, updated_at: new Date().toISOString() }],
  });
}

async function getSupabaseCollection<T>(path: string, key: string) {
  const route = collectionRoute(path, key);
  if (!route || !hasSupabaseConfig() || !ownerId()) return null;
  const query = new URLSearchParams({
    select: "data",
    owner_id: `eq.${ownerId()}`,
  });
  if (route.sport) query.set("sport", `eq.${route.sport}`);
  if (route.order) query.set("order", route.order);
  const rows = await supabaseRest<Array<{ data: T }>>(route.table, { query: query.toString() });
  const data = rows.map((row) => row.data);
  return route.table === "gym_sessions" ? hydrateGymSessions(data) : data;
}

async function saveSupabaseCollection<T>(path: string, key: string, items: T[]) {
  const route = collectionRoute(path, key);
  if (!route || !hasSupabaseConfig() || !ownerId()) return null;
  const rows = items.map((item) => rowForCollectionItem(route, item));
  if (!rows.length) return { ok: true, [key]: [] };
  const rowChunkSize = route.table === "activities" ? 3 : 50;
  for (const rowChunk of chunks(rows, rowChunkSize)) {
    await supabaseRest(route.table, {
      method: "POST",
      query: "on_conflict=user_id,id",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: rowChunk,
    });
  }
  if (route.table === "gym_sessions") {
    const sessionRecords = items.map((item) => item && typeof item === "object" ? item as Record<string, unknown> : {});
    const exerciseRows = sessionRecords.flatMap(gymExerciseRows);
    const setRows = sessionRecords.flatMap(gymSetRows);
    if (exerciseRows.length) {
      await supabaseRest("gym_exercises", {
        method: "POST",
        query: "on_conflict=user_id,session_id,id",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: exerciseRows,
      });
    }
    if (setRows.length) {
      for (const setChunk of chunks(setRows, 100)) {
        await supabaseRest("gym_sets", {
          method: "POST",
          query: "on_conflict=user_id,session_id,exercise_id,set_number",
          prefer: "resolution=merge-duplicates,return=minimal",
          body: setChunk,
        });
      }
    }
  }
  return { ok: true, [key]: items };
}

async function deleteSupabaseItem(path: string) {
  if (!hasSupabaseConfig() || !ownerId()) return null;
  const match = path.match(/^\/(gym\/sessions|gym\/templates|activities)\/(.+)$/);
  if (!match) return null;
  const table = match[1] === "gym/sessions" ? "gym_sessions" : match[1] === "gym/templates" ? "gym_templates" : "activities";
  const id = decodeURIComponent(match[2]);
  const query = new URLSearchParams({ owner_id: `eq.${ownerId()}`, id: `eq.${id}` });
  if (table === "gym_sessions") {
    await supabaseRest("gym_sets", { method: "DELETE", query: new URLSearchParams({ owner_id: `eq.${ownerId()}`, session_id: `eq.${id}` }).toString(), prefer: "return=minimal" });
    await supabaseRest("gym_exercises", { method: "DELETE", query: new URLSearchParams({ owner_id: `eq.${ownerId()}`, session_id: `eq.${id}` }).toString(), prefer: "return=minimal" });
  }
  return supabaseRest(table, { method: "DELETE", query: query.toString(), prefer: "return=minimal" });
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
  const authToken = renderToken() || token();
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
  try {
    const result = await deleteSupabaseItem(path);
    if (result !== null) {
      publishSyncStatus({ cloud: true, lastSyncAt: new Date().toISOString(), lastPath: path, lastError: "" });
      return result;
    }
  } catch (error) {
    publishSyncStatus({
      cloud: Boolean(token()),
      lastErrorAt: new Date().toISOString(),
      lastPath: path,
      lastError: error instanceof Error ? error.message : `Error sincronizando ${path}`,
    });
    throw error;
  }
  return request(path, { method: "DELETE" });
}

export async function getCloudProfile<T>() {
  try {
    const directProfile = await getSupabaseProfile<T>();
    if (directProfile) {
      publishSyncStatus({ cloud: true, lastSyncAt: new Date().toISOString(), lastPath: "/profile", lastError: "" });
      return directProfile;
    }
  } catch (error) {
    publishSyncStatus({
      cloud: Boolean(token()),
      lastErrorAt: new Date().toISOString(),
      lastPath: "/profile",
      lastError: error instanceof Error ? error.message : "Error sincronizando /profile",
    });
    throw error;
  }
  const data = await request("/profile");
  return (data?.profile || null) as T | null;
}

export async function saveCloudProfile<T>(profile: T) {
  try {
    const direct = await saveSupabaseProfile(profile);
    if (direct !== null) {
      publishSyncStatus({ cloud: true, lastSyncAt: new Date().toISOString(), lastPath: "/profile", lastError: "" });
      return direct;
    }
  } catch (error) {
    publishSyncStatus({
      cloud: Boolean(token()),
      lastErrorAt: new Date().toISOString(),
      lastPath: "/profile",
      lastError: error instanceof Error ? error.message : "Error sincronizando /profile",
    });
    throw error;
  }
  return request("/profile", { method: "PUT", body: JSON.stringify({ profile }) });
}

export async function getCloudCollection<T>(path: string, key: string) {
  try {
    const directItems = await getSupabaseCollection<T>(path, key);
    if (directItems) {
      publishSyncStatus({ cloud: true, lastSyncAt: new Date().toISOString(), lastPath: path, lastError: "" });
      return directItems;
    }
  } catch (error) {
    publishSyncStatus({
      cloud: Boolean(token()),
      lastErrorAt: new Date().toISOString(),
      lastPath: path,
      lastError: error instanceof Error ? error.message : `Error sincronizando ${path}`,
    });
    throw error;
  }
  const data = await request(path);
  const collection = data?.[key];
  return (Array.isArray(collection) ? collection : []) as T[];
}

export async function saveCloudCollection<T>(path: string, key: string, items: T[], extra: Record<string, unknown> = {}, cacheKey?: string) {
  try {
    const direct = await saveSupabaseCollection(path, key, items);
    if (direct !== null) {
      if (cacheKey) clearPendingSync(path, key, cacheKey);
      publishSyncStatus({ cloud: true, lastSyncAt: new Date().toISOString(), lastPath: path, lastError: "" });
      return direct;
    }
  } catch (error) {
    publishSyncStatus({
      cloud: Boolean(token()),
      lastErrorAt: new Date().toISOString(),
      lastPath: path,
      lastError: error instanceof Error ? error.message : `Error sincronizando ${path}`,
    });
    throw error;
  }
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
  const cachedItems = readCache<unknown>(options.cacheKey, options.fallback || []);
  const localItems = Array.isArray(cachedItems) ? cachedItems as T[] : options.fallback || [];
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
