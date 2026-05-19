"use client";

type LogoProps = {
  compact?: boolean;
  className?: string;
};

export function IDGLogo({ compact = false, className = "" }: LogoProps) {
  return (
    <img
      src="/brand/idg-training-pro-logo-cropped.png"
      alt="IDG Training Pro"
      className={`${compact ? "h-8 w-auto" : "h-12 w-auto"} object-contain ${className}`}
    />
  );
}

export function ProductIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#FFFFFF" />
      <rect x="1.5" y="1.5" width="61" height="61" rx="14.5" fill="none" stroke="#E2E8F0" strokeWidth="3" />
      <path d="M13 43 20 21h7l-7 22h-7Z" fill="#0F172A" />
      <path d="M29 21h10c7 0 12 4.4 12 10.7C51 38 46 43 38.5 43H27l6.8-22Z" fill="#0F172A" />
      <path d="M38.5 27.5c3.2 0 5.3 1.8 5.3 4.5 0 3-2.4 5.2-5.9 5.2h-3.6l3-9.7h1.2Z" fill="#FFFFFF" />
      <path d="M39 32h13" stroke="#00C853" strokeWidth="5" strokeLinecap="round" />
      <path d="M47 25.5c3 1.8 5.4 4.2 7 7.2" stroke="#1D4ED8" strokeWidth="3" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export type AppIconName =
  | "dashboard"
  | "gym"
  | "cycling"
  | "running"
  | "analytics"
  | "goals"
  | "plan"
  | "sleep"
  | "profile"
  | "bell"
  | "chevronDown"
  | "menu"
  | "logout"
  | "settings"
  | "calendar"
  | "heartZones"
  | "route"
  | "intelligence"
  | "weight";

const moduleIconImages: Partial<Record<AppIconName, string>> = {
  dashboard: "/icons/INICIO.png",
  gym: "/icons/GYM.png",
  cycling: "/icons/BIKE.png",
  running: "/icons/RUNER.png",
  analytics: "/icons/IA.png",
  intelligence: "/icons/IA.png",
  profile: "/icons/PERFIL.png",
};

export function AppIcon({ name, className = "" }: { name: AppIconName; className?: string }) {
  const imageSrc = moduleIconImages[name];

  if (imageSrc) {
    return (
      <img
        src={imageSrc}
        alt=""
        aria-hidden="true"
        className={`${className || "h-5 w-5"} rounded-md object-cover`}
      />
    );
  }

  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 2.2,
  };
  const navy = "#0F172A";
  const green = "#22C55E";

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className || "h-5 w-5"}>
      {name === "dashboard" ? (
        <path d="M3 10.5L12 3L21 10.5V20H14V14H10V20H3V10.5Z" stroke={navy} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      ) : null}
      {name === "gym" ? (
        <>
          <path d="M3 10V14M7 8V16M17 8V16M21 10V14" stroke={navy} strokeWidth="2.2" strokeLinecap="round" fill="none" />
          <path d="M7 12H17" stroke={green} strokeWidth="2.2" strokeLinecap="round" fill="none" />
        </>
      ) : null}
      {name === "cycling" ? (
        <>
          <circle cx="6" cy="18" r="3" stroke={green} strokeWidth="2.2" fill="none" />
          <circle cx="18" cy="18" r="3" stroke={green} strokeWidth="2.2" fill="none" />
          <path d="M9 18L12 10L15 18M12 10H16" stroke={navy} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </>
      ) : null}
      {name === "running" ? (
        <>
          <circle cx="14" cy="5" r="2" fill={green} />
          <path d="M10 21L13 15L17 13L20 16M13 9L11 13L15 15" stroke={navy} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </>
      ) : null}
      {name === "analytics" ? (
        <>
          <path d="M5 19V10" stroke={navy} strokeWidth="2.2" strokeLinecap="round" fill="none" />
          <path d="M12 19V5" stroke={green} strokeWidth="2.2" strokeLinecap="round" fill="none" />
          <path d="M19 19V13" stroke={navy} strokeWidth="2.2" strokeLinecap="round" fill="none" />
        </>
      ) : null}
      {name === "goals" ? (
        <>
          <path d="M12 3V21" stroke={green} strokeWidth="2.2" strokeLinecap="round" fill="none" />
          <path d="M5 12H19" stroke={green} strokeWidth="2.2" strokeLinecap="round" fill="none" />
          <circle cx="12" cy="12" r="7" stroke={navy} strokeWidth="2.2" fill="none" />
          <circle cx="12" cy="12" r="2.5" stroke={navy} strokeWidth="2.2" fill="none" />
        </>
      ) : null}
      {name === "sleep" ? (
        <>
          <path d="M5 17.5C9.5 18.8 16.4 17 19 11.5C15.2 13.1 10.8 11 11 6C7.5 7.5 4.7 11.4 5 17.5Z" stroke={navy} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d="M17 5H21M19 3V7" stroke={green} strokeWidth="2.2" strokeLinecap="round" />
        </>
      ) : null}
      {name === "plan" ? (
        <>
          <rect x="4" y="5" width="16" height="15" rx="2" stroke={navy} strokeWidth="2.2" fill="none" />
          <path d="M8 3V7M16 3V7" stroke={green} strokeWidth="2.2" strokeLinecap="round" fill="none" />
          <path d="M4 10H20" stroke={navy} strokeWidth="2.2" fill="none" />
        </>
      ) : null}
      {name === "profile" ? (
        <>
          <circle cx="12" cy="8" r="4" stroke={navy} strokeWidth="2.2" fill="none" />
          <path d="M5 20C5 16.7 8.1 14 12 14C15.9 14 19 16.7 19 20" stroke={green} strokeWidth="2.2" strokeLinecap="round" fill="none" />
        </>
      ) : null}
      {name === "bell" ? (
        <>
          <path d="M6 17H18L16 14V10C16 7.8 14.2 6 12 6C9.8 6 8 7.8 8 10V14L6 17Z" stroke={navy} strokeWidth="2.2" strokeLinejoin="round" fill="none" />
          <path d="M10 19C10.5 20 11.1 20.5 12 20.5C12.9 20.5 13.5 20 14 19" stroke={green} strokeWidth="2.2" strokeLinecap="round" fill="none" />
        </>
      ) : null}
      {name === "chevronDown" ? <path d="m7 10 5 5 5-5" {...common} /> : null}
      {name === "menu" ? <path d="M4 7h16M4 12h16M4 17h16" {...common} /> : null}
      {name === "logout" ? (
        <>
          <path d="M10 6H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h4" {...common} />
          <path d="M14 16l4-4-4-4M18 12H9" {...common} />
        </>
      ) : null}
      {name === "settings" ? (
        <>
          <circle cx="12" cy="12" r="3" stroke={green} strokeWidth="2.2" fill="none" />
          <path d="M19 12C19 11.3 18.9 10.7 18.7 10.1L21 8L19 5L16.3 6C15.8 5.6 15.2 5.3 14.6 5.1L14 2H10L9.4 5.1C8.8 5.3 8.2 5.6 7.7 6L5 5L3 8L5.3 10.1C5.1 10.7 5 11.3 5 12C5 12.7 5.1 13.3 5.3 13.9L3 16L5 19L7.7 18C8.2 18.4 8.8 18.7 9.4 18.9L10 22H14L14.6 18.9C15.2 18.7 15.8 18.4 16.3 18L19 19L21 16L18.7 13.9C18.9 13.3 19 12.7 19 12Z" stroke={navy} strokeWidth="1.8" strokeLinejoin="round" fill="none" />
        </>
      ) : null}
      {name === "calendar" ? (
        <>
          <rect x="4" y="5" width="16" height="15" rx="2" stroke={navy} strokeWidth="2.2" fill="none" />
          <path d="M8 3V7M16 3V7" stroke={green} strokeWidth="2.2" strokeLinecap="round" fill="none" />
          <path d="M4 10H20" stroke={navy} strokeWidth="2.2" fill="none" />
        </>
      ) : null}
      {name === "heartZones" ? <path d="M3 12H7L10 7L14 17L17 12H21" stroke={green} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" /> : null}
      {name === "route" ? (
        <>
          <circle cx="12" cy="12" r="8" stroke={navy} strokeWidth="2.2" fill="none" />
          <circle cx="12" cy="12" r="4" stroke={green} strokeWidth="2.2" fill="none" />
          <circle cx="12" cy="12" r="1.5" fill={green} />
        </>
      ) : null}
      {name === "intelligence" ? (
        <>
          <path d="M9 4C6 4 4 6.2 4 9C4 10.7 4.7 12 6 13V16L8 15L9.5 16H15C18 16 20 13.8 20 11C20 8.2 18 6 15 6H13.5C12.7 4.8 11.4 4 9.8 4H9Z" stroke={navy} strokeWidth="2.2" strokeLinejoin="round" fill="none" />
          <circle cx="9" cy="10" r="1" fill={green} />
          <circle cx="15" cy="10" r="1" fill={green} />
        </>
      ) : null}
      {name === "weight" ? (
        <>
          <path d="M13 2L5 14H11L10 22L19 9H13L13 2Z" fill={green} />
        </>
      ) : null}
    </svg>
  );
}
