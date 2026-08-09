const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export type AccessState = {
  email?: string;
  plan: string;
  coachAccess: boolean;
  fullAccess: boolean;
  isFounder: boolean;
  betaFullAccess?: boolean;
  fullAccessUntil?: string | null;
};

export const ACCESS_KEY = "idg_access_json";

const DEFAULT_ACCESS: AccessState = {
  plan: "free",
  coachAccess: false,
  fullAccess: false,
  isFounder: false,
  betaFullAccess: false,
  fullAccessUntil: null,
};

export function storeAccess(access?: Partial<AccessState> | null) {
  if (typeof window === "undefined" || !access) return;
  localStorage.setItem(ACCESS_KEY, JSON.stringify({ ...DEFAULT_ACCESS, ...access }));
}

export function getStoredAccess(): AccessState {
  if (typeof window === "undefined") return DEFAULT_ACCESS;
  try {
    const raw = localStorage.getItem(ACCESS_KEY);
    return raw ? { ...DEFAULT_ACCESS, ...JSON.parse(raw) } : DEFAULT_ACCESS;
  } catch {
    return DEFAULT_ACCESS;
  }
}

export function clearStoredAccess() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(ACCESS_KEY);
}

export function canUseCoach(access = getStoredAccess()) {
  return Boolean(access.fullAccess || access.coachAccess || access.isFounder);
}

export async function refreshAccess() {
  if (typeof window === "undefined") return DEFAULT_ACCESS;
  const token = localStorage.getItem("render_token");
  if (!token) return DEFAULT_ACCESS;

  const response = await fetch(`${API_URL}/access`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "No se pudo validar el acceso.");
  storeAccess(data.access);
  return { ...DEFAULT_ACCESS, ...data.access } as AccessState;
}
