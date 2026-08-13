"use client";

import { storeAccess } from "@/lib/access";
import { getSupabaseAccessToken } from "@/lib/supabase-direct";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export async function getRenderToken() {
  if (typeof window === "undefined") return "";
  const existing = localStorage.getItem("render_token");
  if (existing) return existing;

  const supabaseToken = getSupabaseAccessToken();
  if (!supabaseToken) return "";

  const response = await fetch(`${API_URL}/auth/supabase`, {
    method: "POST",
    headers: { Authorization: `Bearer ${supabaseToken}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.token) {
    throw new Error(data.error || "No se pudo activar Strava con la sesion de Supabase.");
  }
  localStorage.setItem("render_token", data.token);
  storeAccess(data.access);
  return String(data.token);
}
