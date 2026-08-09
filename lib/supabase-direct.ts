"use client";

type SupabaseSession = {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  user?: SupabaseUser;
};

export type SupabaseUser = {
  id: string;
  email?: string;
  user_metadata?: {
    name?: string;
    full_name?: string;
    avatar_url?: string;
    picture?: string;
  };
};

const SESSION_KEY = "idg_supabase_session_json";

function supabaseUrl() {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
}

function supabaseAnonKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
}

export function hasSupabaseConfig() {
  return Boolean(supabaseUrl() && supabaseAnonKey());
}

export function getSupabaseSession(): SupabaseSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) as SupabaseSession : null;
  } catch {
    return null;
  }
}

export function getSupabaseAccessToken() {
  return getSupabaseSession()?.access_token || "";
}

export function getSupabaseUser() {
  return getSupabaseSession()?.user || null;
}

export function storeSupabaseSession(session: SupabaseSession) {
  if (typeof window === "undefined") return;
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  if (session.access_token) localStorage.setItem("token", session.access_token);
  if (session.user) {
    const metadata = session.user.user_metadata || {};
    localStorage.setItem("user", JSON.stringify({
      id: session.user.id,
      email: session.user.email || "",
      name: metadata.name || metadata.full_name || session.user.email || "Atleta IDG",
      picture: metadata.avatar_url || metadata.picture || "",
    }));
  }
}

export function clearSupabaseSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem("token");
  localStorage.removeItem("user");
}

export async function signInWithGoogleIdToken(googleIdToken: string) {
  if (!hasSupabaseConfig()) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  const response = await fetch(`${supabaseUrl()}/auth/v1/token?grant_type=id_token`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ provider: "google", token: googleIdToken }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data.msg || data.error_description || data.error || "No se pudo iniciar sesion con Supabase.");
  }
  storeSupabaseSession(data as SupabaseSession);
  return data as SupabaseSession;
}

type RestOptions = {
  method?: string;
  query?: string;
  body?: unknown;
  prefer?: string;
};

export async function supabaseRest<T>(table: string, options: RestOptions = {}) {
  const token = getSupabaseAccessToken();
  if (!hasSupabaseConfig()) throw new Error("Supabase no esta configurado.");
  if (!token) throw new Error("Sesion de Supabase no disponible.");
  const query = options.query ? `?${options.query}` : "";
  const response = await fetch(`${supabaseUrl()}/rest/v1/${table}${query}`, {
    method: options.method || "GET",
    headers: {
      apikey: supabaseAnonKey(),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = data?.message || data?.hint || data?.details || `Error Supabase ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

