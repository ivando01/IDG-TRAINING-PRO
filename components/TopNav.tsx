"use client";

import { AppIcon } from "@/components/Brand";
import { navItems } from "@/components/Sidebar";
import { clearStoredAccess } from "@/lib/access";
import { getSyncStatus, retryPendingSyncs } from "@/lib/cloud-sync";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface User {
  name: string;
  email: string;
  avatar?: string;
}

export default function TopNav({ title }: { title: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [showModuleMenu, setShowModuleMenu] = useState(false);
  const [syncStatus, setSyncStatus] = useState({
    cloud: false,
    lastSyncAt: null as string | null,
    lastErrorAt: null as string | null,
    lastPath: "",
    lastError: "",
    pendingCount: 0,
  });
  const [retryingSync, setRetryingSync] = useState(false);

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

  const handleRetrySync = async () => {
    setRetryingSync(true);
    try {
      await retryPendingSyncs();
      setSyncStatus(getSyncStatus());
    } finally {
      setRetryingSync(false);
    }
  };

  const getInitials = (name: string) =>
    name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

  return (
    <div className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2.5 lg:px-6 lg:py-4">
      <div className="relative flex min-w-0 items-center gap-2">
        <button
          aria-label="Abrir menu de modulos"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-slate-900 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 lg:hidden"
          onClick={() => setShowModuleMenu((value) => !value)}
          type="button"
        >
          <AppIcon name="menu" className="h-5 w-5" />
        </button>
        <h1 className="min-w-0 truncate text-lg font-black text-slate-900 lg:text-xl">{title}</h1>

        {showModuleMenu ? (
          <div className="absolute left-0 top-[calc(100%+10px)] z-50 w-[calc(100vw-1.5rem)] max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-2xl backdrop-blur lg:hidden">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wide text-blue-600">Navegacion</p>
                <p className="text-sm font-black text-slate-900">Cambiar modulo</p>
              </div>
              <button
                aria-label="Cerrar menu de modulos"
                className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-sm font-black text-slate-700"
                onClick={() => setShowModuleMenu(false)}
                type="button"
              >
                x
              </button>
            </div>
            <nav className="grid max-h-[58vh] grid-cols-2 gap-2 overflow-y-auto pb-1">
              {navItems.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href);
                return (
                  <button
                    className={`flex min-w-0 items-center gap-3 rounded-xl border px-3 py-3 text-left text-sm font-black transition ${
                      active ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-100 bg-white text-slate-600"
                    }`}
                    key={item.href}
                    onClick={() => {
                      setShowModuleMenu(false);
                      router.push(item.href);
                    }}
                    type="button"
                  >
                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${active ? "bg-white" : "bg-slate-50"}`}>
                      <AppIcon name={item.icon} className="h-7 w-7" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate">{item.label.replace("Dashboard", "Inicio").replace("IDG Coach", "Coach").replace("Peso & Cuerpo", "Peso")}</span>
                      <span className="block truncate text-[10px] font-black uppercase tracking-wide text-slate-400">{item.section}</span>
                    </span>
                  </button>
                );
              })}
            </nav>
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <div
          className={`hidden rounded-lg border px-3 py-2 text-[11px] font-black sm:block ${
            syncStatus.lastError
              ? "border-red-100 bg-red-50 text-red-600"
              : syncStatus.pendingCount
                ? "border-amber-100 bg-amber-50 text-amber-700"
                : syncStatus.cloud
                ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                : "border-slate-200 bg-slate-50 text-slate-500"
          }`}
          title={syncStatus.lastError || (syncStatus.lastSyncAt ? `Ultima sincronizacion: ${new Date(syncStatus.lastSyncAt).toLocaleString("es-CO")}` : "Sin sincronizacion reciente")}
        >
          {syncStatus.lastError ? "Nube con alerta" : syncStatus.pendingCount ? `${syncStatus.pendingCount} pendientes` : syncStatus.cloud ? "Nube activa" : "Solo local"}
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
                    : syncStatus.pendingCount
                      ? `${syncStatus.pendingCount} pendiente(s) por subir`
                    : syncStatus.lastSyncAt
                      ? `Sync: ${new Date(syncStatus.lastSyncAt).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}`
                      : "Sync pendiente"}
                </p>
                {syncStatus.pendingCount || syncStatus.lastError ? (
                  <button
                    className="mt-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white disabled:opacity-60"
                    disabled={retryingSync}
                    type="button"
                    onClick={handleRetrySync}
                  >
                    {retryingSync ? "Reintentando..." : "Reintentar sync"}
                  </button>
                ) : null}
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
