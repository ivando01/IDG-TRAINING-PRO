"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { clearSupabaseSession, getSupabaseAccessToken } from "@/lib/supabase-direct";

export function useAuth() {
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token && !getSupabaseAccessToken()) {
      router.push("/");
    }
  }, [router]);

  const getUser = () => {
    const user = localStorage.getItem("user");
    return user ? JSON.parse(user) : null;
  };

  const logout = () => {
    clearSupabaseSession();
    localStorage.removeItem("render_token");
    router.push("/");
  };

  return { getUser, logout };
}
