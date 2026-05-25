"use client";

import { AppIcon } from "@/components/Brand";
import { clearStoredAccess } from "@/lib/access";
import { getSyncStatus } from "@/lib/cloud-sync";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface User {
  name: string;
  email: string;
  avatar?: string;
}

export default function TopNav({ title }: { title: string }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [syncStatus, setSyncStatus] = useState(() => getSyncStatus());

  useEffect(() => {
    const userData = localStorage.getItem("user");
    if (userData) setUser(JSON.parse(userData));
    const refreshSyncStatus = () => setSyncStatus(getSyncStatus());
    refreshSyncStatus();
    window.addEventListener("idg-sync-status", refreshSyncStatus);
    window.addEventListener("storage", refreshSyncStatus);
    return () => {
      window.removeEventListener("idg-sync-status", refreshSyncStatus);
      window.removeEventListener("storage", refreshSyncStatus);
    };
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    clearStoredAccess();
    router.push("/");
  };

  const getInitials = (name: string) =>
    name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

  return (
    <div className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
      <h1 className="text-xl font-black text-slate-900">{title}</h1>

      <div className="flex items-center gap-2 sm:gap-3">
        <div
          className={`hidden rounded-lg border px-3 py-2 text-[11px] font-black sm:block ${
            syncStatus.lastError
              ? "border-red-100 bg-red-50 text-red-600"
              : syncStatus.cloud
                ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                : "border-slate-200 bg-slate-50 text-slate-500"
          }`}
          title={syncStatus.lastError || (syncStatus.lastSyncAt ? `Ultima sincronizacion: ${new Date(syncStatus.lastSyncAt).toLocaleString("es-CO")}` : "Sin sincronizacion reciente")}
        >
          {syncStatus.lastError ? "Nube con alerta" : syncStatus.cloud ? "Nube activa" : "Solo local"}
        </div>
        <button className="relative rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900" aria-label="Notificaciones">
          <AppIcon name="bell" className="h-5 w-5" />
        </button>

        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 transition hover:border-blue-200 hover:bg-blue-50/60"
          >
            <div className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-[#0F172A] text-xs font-black text-white shadow-[0_0_0_2px_rgba(29,78,216,0.18)]">
              <span className="absolute inset-x-0 bottom-0 h-3 bg-[#00C853]" />
              <span className="relative">
              {user ? getInitials(user.name) : "U"}
              </span>
            </div>
            <span className="hidden text-sm font-black text-[#0F172A] sm:inline">
              {user?.name || "Usuario"}
            </span>
            <AppIcon name="chevronDown" className="h-4 w-4 text-[#1D4ED8]" />
          </button>

          {showMenu ? (
            <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
              <div className="border-b border-slate-100 p-3">
                <p className="text-sm font-black text-slate-900">{user?.name}</p>
                <p className="text-xs font-semibold text-slate-500">{user?.email}</p>
                <p className={`mt-2 text-xs font-black ${syncStatus.lastError ? "text-red-600" : "text-emerald-700"}`}>
                  {syncStatus.lastError
                    ? `Alerta: ${syncStatus.lastPath || "nube"}`
                    : syncStatus.lastSyncAt
                      ? `Sync: ${new Date(syncStatus.lastSyncAt).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}`
                      : "Sync pendiente"}
                </p>
              </div>
              <button
                onClick={() => {
                  router.push("/profile");
                  setShowMenu(false);
                }}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-bold text-slate-700 transition hover:bg-slate-50"
              >
                <AppIcon name="profile" className="h-4 w-4" />
                Mi Perfil
              </button>
              <button
                onClick={() => {
                  handleLogout();
                  setShowMenu(false);
                }}
                className="flex w-full items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-left text-sm font-bold text-red-600 transition hover:bg-red-50"
              >
                <AppIcon name="logout" className="h-4 w-4" />
                Cerrar sesion
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
