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
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error || `Error sincronizando ${path}`);
  return data;
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
