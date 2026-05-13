"use client";

import { GoogleLogin, type CredentialResponse } from "@react-oauth/google";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

type User = {
  name: string;
  email: string;
  picture: string;
};

type ModuleKey =
  | "dash"
  | "plan"
  | "gym"
  | "running"
  | "cycling"
  | "weight"
  | "recovery"
  | "goals"
  | "profile"
  | "import";

type Sport = {
  key: "gym" | "cycling" | "running";
  title: string;
  icon: "gym" | "bike" | "run";
  image: string;
  attributes: string[];
};

type Profile = {
  name: string;
  email: string;
  weight: number;
  height: number;
  maxHr: number;
  restHr: number;
  goal: string;
  levels: Record<string, string>;
};

type GymRoutineKey = "quad" | "posterior" | "back" | "chest" | "arms" | "wod" | "custom";

type GymExerciseDraft = {
  id: string;
  name: string;
  sets: number;
  reps: string;
  weights: string[];
  rest: number;
  note?: string;
};

type GymSession = {
  id: string;
  date: string;
  routine: GymRoutineKey;
  routineName: string;
  duration: number;
  intensity: string;
  pain: string;
  painLevel: string;
  calories: string;
  notes: string;
  exercises: GymExerciseDraft[];
  updatedAt: number;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const PROFILE_KEY = "idg_profile_json";
const GYM_SESSION_KEY = "idg_gym_sessions_json";

const sports: Sport[] = [
  {
    key: "gym",
    title: "GYM",
    icon: "gym",
    image: "/sport-gym.png",
    attributes: ["Fuerza", "Hipertrofia", "Movilidad"],
  },
  {
    key: "cycling",
    title: "CICLISMO",
    icon: "bike",
    image: "/sport-cycling.png",
    attributes: ["Resistencia", "Potencia", "Velocidad"],
  },
  {
    key: "running",
    title: "RUNNING",
    icon: "run",
    image: "/sport-running.png",
    attributes: ["Resistencia", "Ritmo", "Recuperación"],
  },
];

const navItems: { key: ModuleKey; label: string; icon: string; section?: string }[] = [
  { key: "dash", label: "Dashboard", icon: "▦", section: "Inteligencia" },
  { key: "plan", label: "Plan Semanal", icon: "▣" },
  { key: "gym", label: "Gym", icon: "▤", section: "Entrenamiento" },
  { key: "running", label: "Running", icon: "↗" },
  { key: "cycling", label: "Ciclismo", icon: "○" },
  { key: "weight", label: "Peso & Cuerpo", icon: "◌", section: "Control" },
  { key: "recovery", label: "Recuperación", icon: "↺" },
  { key: "goals", label: "Metas y Análisis IA", icon: "✦" },
  { key: "profile", label: "Perfil", icon: "◎", section: "Sistema" },
  { key: "import", label: "Importar", icon: "⇪" },
];

const moduleNames: Record<ModuleKey, string> = {
  dash: "Dashboard",
  plan: "Plan Semanal",
  gym: "Gym",
  running: "Running",
  cycling: "Ciclismo",
  weight: "Peso & Cuerpo",
  recovery: "Recuperación",
  goals: "Metas y Análisis IA",
  profile: "Perfil",
  import: "Importar",
};

const seedProfile: Profile = {
  name: "Ivan Dominguez",
  email: "ivando01@gmail.com",
  weight: 67.5,
  height: 175,
  maxHr: 190,
  restHr: 54,
  goal: "Mejorar rendimiento integral sin sacrificar recuperación.",
  levels: {
    running: "Intermedio",
    cycling: "Intermedio alto",
    gym: "Fuerza base",
  },
};

const sessions = {
  gym: [
    { date: "2026-05-04", title: "Push + core", load: 82, volume: "12.4 t", time: "1h 18m" },
    { date: "2026-05-01", title: "Pierna fuerza", load: 76, volume: "10.8 t", time: "1h 05m" },
    { date: "2026-04-29", title: "Pull hipertrofia", load: 69, volume: "9.6 t", time: "58m" },
  ],
  running: [
    { date: "2026-05-03", title: "Tempo controlado", km: 8.6, pace: "5:08", hr: 148, load: 74 },
    { date: "2026-04-30", title: "Rodaje Z2", km: 6.2, pace: "5:42", hr: 136, load: 52 },
    { date: "2026-04-27", title: "Intervalos 6x400", km: 7.1, pace: "4:46", hr: 158, load: 81 },
  ],
  cycling: [
    { date: "2026-05-03", title: "Ruta mixta", km: 42.3, speed: 24.1, hr: 141, load: 78 },
    { date: "2026-04-29", title: "Cadencia alta", km: 31.8, speed: 26.4, hr: 137, load: 64 },
    { date: "2026-04-19", title: "Fondo C606", km: 40.8, speed: 23.5, hr: 139, load: 72 },
  ],
  weight: [
    { date: "2026-05-05", kg: 67.5, fat: 14.8, muscle: 33.2 },
    { date: "2026-04-28", kg: 67.9, fat: 15.1, muscle: 33.1 },
    { date: "2026-04-21", kg: 68.2, fat: 15.4, muscle: 32.9 },
  ],
  recovery: [
    { date: "2026-05-05", sleep: 7.4, energy: 8, mood: 8, hrv: 62 },
    { date: "2026-05-04", sleep: 6.8, energy: 7, mood: 7, hrv: 58 },
    { date: "2026-05-03", sleep: 7.9, energy: 8, mood: 9, hrv: 65 },
  ],
  goals: [
    { name: "Correr 10K sub 50", current: 82, status: "En progreso" },
    { name: "Mantener fuerza base", current: 76, status: "Estable" },
    { name: "Peso competitivo", current: 91, status: "Excelente" },
  ],
};

const gymRoutines: Record<GymRoutineKey, { name: string; exercises: Omit<GymExerciseDraft, "id" | "weights">[] }> = {
  quad: {
    name: "Dia 1 - Cuadriceps + Pantorrilla",
    exercises: [
      { name: "Prensa de piernas", sets: 4, reps: "10", rest: 90, note: "Explosivo" },
      { name: "Sentadilla bulgara", sets: 3, reps: "8", rest: 75, note: "Por lado" },
      { name: "Zancadas walking", sets: 3, reps: "16", rest: 60, note: "Pasos totales" },
      { name: "Elevacion talones de pie", sets: 4, reps: "15", rest: 45 },
    ],
  },
  posterior: {
    name: "Dia 2 - Isquios + Gluteo",
    exercises: [
      { name: "Peso muerto rumano", sets: 4, reps: "10", rest: 90, note: "Bajada 3 seg" },
      { name: "Hip thrust", sets: 3, reps: "12", rest: 75, note: "Pausa arriba" },
      { name: "Curl femoral tumbado", sets: 4, reps: "10-12", rest: 75 },
      { name: "Abduccion cadera externa", sets: 4, reps: "15", rest: 45 },
    ],
  },
  back: {
    name: "Dia 3 - Espalda + Antebrazo",
    exercises: [
      { name: "Jalon al pecho", sets: 4, reps: "10-12", rest: 90 },
      { name: "Remo con mancuerna", sets: 3, reps: "10", rest: 75, note: "Por lado" },
      { name: "Remo polea baja", sets: 3, reps: "12", rest: 75 },
      { name: "Curl inverso barra Z", sets: 3, reps: "12", rest: 60 },
    ],
  },
  chest: {
    name: "Dia 4 - Pecho + Hombro",
    exercises: [
      { name: "Press militar con mancuernas", sets: 4, reps: "10", rest: 90 },
      { name: "Press banca con mancuernas", sets: 4, reps: "10", rest: 90 },
      { name: "Press inclinado maquina", sets: 3, reps: "12", rest: 75 },
      { name: "Face pulls", sets: 4, reps: "15", rest: 60, note: "Hombro sano" },
      { name: "Vuelos laterales", sets: 4, reps: "15", rest: 45 },
    ],
  },
  arms: {
    name: "Dia 5 - Biceps + Triceps",
    exercises: [
      { name: "Curl biceps barra Z", sets: 3, reps: "10", rest: 75 },
      { name: "Curl martillo", sets: 3, reps: "12", rest: 60 },
      { name: "Copa de triceps", sets: 3, reps: "10", rest: 75 },
      { name: "Extension triceps cuerda", sets: 3, reps: "12", rest: 60 },
    ],
  },
  wod: {
    name: "WOD Ranger",
    exercises: [
      { name: "Flexiones controladas", sets: 4, reps: "10", rest: 60 },
      { name: "Burpees tacticos", sets: 4, reps: "10", rest: 60 },
      { name: "Plancha toque hombros", sets: 4, reps: "20", rest: 45 },
      { name: "Escaladores de montana", sets: 4, reps: "40s", rest: 45 },
    ],
  },
  custom: {
    name: "Personalizado",
    exercises: [],
  },
};

function getStoredUser(): User | null {
  if (typeof window === "undefined") {
    return null;
  }

  const savedUser = localStorage.getItem("user");

  if (!savedUser) {
    return null;
  }

  try {
    return JSON.parse(savedUser);
  } catch {
    localStorage.removeItem("user");
    localStorage.removeItem("token");
    return null;
  }
}

function getStoredProfile(user?: User | null): Profile {
  if (typeof window === "undefined") {
    return seedProfile;
  }

  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) {
      return { ...seedProfile, ...JSON.parse(raw) };
    }
  } catch {
    localStorage.removeItem(PROFILE_KEY);
  }

  return {
    ...seedProfile,
    name: user?.name ?? seedProfile.name,
    email: user?.email ?? seedProfile.email,
  };
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "brand-logo compact" : "brand-logo"} aria-label="IDG Training Pro">
      <span>
        ID<span>G</span>
      </span>
      <small>
        Training <b>Pro</b>
      </small>
    </div>
  );
}

function Icon({ name }: { name: "run" | "bike" | "gym" | "mail" | "lock" | "eye" | "shield" }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 2,
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`icon icon-${name}`}>
      {name === "run" ? (
        <>
          <circle cx="14" cy="4" r="2" {...common} />
          <path d="m10 21 2-5-4-3 4-5 3 3 4 1" {...common} />
          <path d="m8 13-3 3m8 0 4 5" {...common} />
        </>
      ) : null}
      {name === "bike" ? (
        <>
          <circle cx="6" cy="17" r="3" {...common} />
          <circle cx="18" cy="17" r="3" {...common} />
          <path d="m8 17 4-8 3 8m-6-4h6m-2-7h3" {...common} />
        </>
      ) : null}
      {name === "gym" ? (
        <path d="M4 8v8m16-8v8M7 7v10m10-10v10M9 12h6" {...common} />
      ) : null}
      {name === "mail" ? (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2" {...common} />
          <path d="m4 7 8 6 8-6" {...common} />
        </>
      ) : null}
      {name === "lock" ? (
        <>
          <rect x="5" y="11" width="14" height="10" rx="2" {...common} />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" {...common} />
        </>
      ) : null}
      {name === "eye" ? (
        <>
          <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" {...common} />
          <circle cx="12" cy="12" r="3" {...common} />
        </>
      ) : null}
      {name === "shield" ? (
        <>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" {...common} />
          <path d="m9 12 2 2 4-5" {...common} />
        </>
      ) : null}
    </svg>
  );
}

function MiniBars() {
  return (
    <div className="mini-bars" aria-hidden="true">
      {[34, 46, 68, 50, 58, 82, 66, 44, 74, 61, 92].map((height, index) => (
        <i key={index} style={{ height: `${height}%` }} />
      ))}
    </div>
  );
}

function SparkLine() {
  return (
    <svg className="spark-line" viewBox="0 0 260 92" aria-hidden="true">
      <path className="spark-fill" d="M10 78 L54 60 L98 46 L142 52 L186 32 L230 18 L250 28 L250 92 L10 92 Z" />
      <path d="M10 78 L54 60 L98 46 L142 52 L186 32 L230 18 L250 28" />
      {[10, 54, 98, 142, 186, 230, 250].map((x, index) => (
        <circle key={x} cx={x} cy={[78, 60, 46, 52, 32, 18, 28][index]} r="4" />
      ))}
    </svg>
  );
}

function LoginExperience({ user, setUser }: { user: User | null; setUser: (user: User | null) => void }) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingProfile, setIsCheckingProfile] = useState(false);
  const [error, setError] = useState("");
  const [profileMessage, setProfileMessage] = useState("");

  const handleSuccess = async (credentialResponse: CredentialResponse) => {
    if (!credentialResponse.credential) {
      setError("Google no devolvió un token válido.");
      return;
    }

    setIsLoading(true);
    setError("");
    setProfileMessage("");

    try {
      const response = await fetch(`${API_URL}/auth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token: credentialResponse.credential }),
      });

      if (!response.ok) {
        throw new Error("No pudimos iniciar sesión en este momento.");
      }

      const data = await response.json();

      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      setUser(data.user);
      setProfileMessage("Sesión iniciada. Sincronización lista para todos los módulos.");
      router.push("/dashboard");
    } catch (requestError) {
      console.error(requestError);
      setError("No pudimos conectar con el backend. Verifica que esté activo.");
    } finally {
      setIsLoading(false);
    }
  };

  const connectStrava = () => {
    const token = localStorage.getItem("token");

    if (!token) {
      setError("Primero inicia sesión con Google para vincular Strava.");
      return;
    }

    window.location.href = `${API_URL}/auth/strava?token=${encodeURIComponent(token)}`;
  };

  const submitEmailLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("El ingreso por email todavía no está conectado. Usa Google para entrar.");
  };

  const testProfile = async () => {
    const token = localStorage.getItem("token");

    if (!token) {
      setError("No hay una sesión activa para consultar el perfil.");
      return;
    }

    setIsCheckingProfile(true);
    setError("");

    try {
      const response = await fetch(`${API_URL}/profile`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error("No se pudo consultar el perfil.");
      }

      const data = await response.json();
      setProfileMessage(
        `Perfil verificado para ${data.email ?? data.user?.email ?? "el usuario actual"}.`,
      );
    } catch (requestError) {
      console.error(requestError);
      setError("La validación del perfil falló. Revisa el token o el backend.");
    } finally {
      setIsCheckingProfile(false);
    }
  };

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
    setError("");
    setProfileMessage("");
  };

  return (
    <main className="login-screen">
      <div className="login-layout">
        <section className="product-side" aria-label="Producto IDG Training Pro">
          <div className="intro-row">
            <Logo />
            <div className="hero-copy">
              <h1>
                Entrena como un <span>sistema completo.</span>
              </h1>
              <p>Running, ciclismo y gimnasio en un solo ecosistema inteligente.</p>
            </div>
          </div>

          <div className="sport-cards" aria-label="Módulos deportivos">
            {sports.map((sport) => (
              <article className={`sport-card sport-${sport.key}`} key={sport.key}>
                <Image
                  src={sport.image}
                  alt={`${sport.title} IDG Training Pro`}
                  fill
                  priority
                  sizes="(max-width: 780px) 78vw, 28vw"
                />
                <div className="sport-title">
                  <span>
                    <Icon name={sport.icon} />
                  </span>
                  <h2>{sport.title}</h2>
                </div>
                <ul>
                  {sport.attributes.map((attribute) => (
                    <li key={attribute}>{attribute}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>

          <div className="metrics-panel" aria-label="Métricas principales">
            <article className="load-metric">
              <p>Carga semanal</p>
              <strong>780</strong>
              <span>Óptima ↗</span>
              <MiniBars />
              <div className="metric-days">
                <small>Lun</small>
                <small>Mar</small>
                <small>Mié</small>
                <small>Jue</small>
                <small>Vie</small>
                <small>Sáb</small>
                <small>Dom</small>
              </div>
            </article>

            <article className="performance-metric">
              <div className="metric-summary">
                <p>Rendimiento</p>
                <strong>82%</strong>
                <span>Excelente</span>
              </div>
              <div className="line-chart" aria-hidden="true">
                <SparkLine />
              </div>
            </article>
          </div>
        </section>

        <aside className={user ? "auth-card auth-card-session" : "auth-card"} aria-label="Inicio de sesión">
          <Logo compact />

          {!user ? (
            <>
              <div className="auth-heading">
                <h2>¡Bienvenido de nuevo!</h2>
                <p>Inicia sesión para continuar optimizando tu rendimiento.</p>
              </div>

              <div className="social-actions">
                <div className="google-frame">
                  <GoogleLogin
                    onSuccess={handleSuccess}
                    onError={() => setError("El login con Google no se pudo completar.")}
                    width="100%"
                    text="continue_with"
                    shape="rectangular"
                  />
                </div>
                <button type="button" className="strava-button" onClick={connectStrava}>
                  <span>STRAVA</span>
                  Conectar con Strava
                </button>
              </div>

              <div className="divider">
                <span>o continuar con email</span>
              </div>

              <form className="email-form" onSubmit={submitEmailLogin}>
                <label>
                  <Icon name="mail" />
                  <input type="email" placeholder="Email" autoComplete="email" />
                </label>
                <label>
                  <Icon name="lock" />
                  <input type="password" placeholder="Contraseña" autoComplete="current-password" />
                  <Icon name="eye" />
                </label>

                <div className="form-meta">
                  <label className="remember">
                    <input type="checkbox" />
                    <span>Recordarme</span>
                  </label>
                  <button type="button">¿Olvidaste tu contraseña?</button>
                </div>

                <button className="login-button" type="submit" disabled={isLoading}>
                  {isLoading ? "Validando..." : "Iniciar sesión"}
                </button>
              </form>

              <p className="create-account">
                ¿No tienes una cuenta? <button type="button">Crear cuenta</button>
              </p>
            </>
          ) : (
            <div className="active-session">
              <div className="profile-card">
                <Image className="avatar" src={user.picture} alt={user.name} width={72} height={72} />
                <div>
                  <span>Sesión activa</span>
                  <strong>Hola, {user.name.split(" ")[0]}</strong>
                  <p>{user.email}</p>
                </div>
              </div>

              <button
                type="button"
                className="login-button"
                onClick={testProfile}
                disabled={isCheckingProfile}
              >
                {isCheckingProfile ? "Verificando..." : "Probar perfil"}
              </button>
              <button type="button" className="strava-button" onClick={connectStrava}>
                <span>STRAVA</span>
                Conectar con Strava
              </button>
              <button type="button" className="ghost-button" onClick={logout}>
                Cerrar sesión
              </button>
            </div>
          )}

          {error ? <p className="status-message error">{error}</p> : null}
          {profileMessage ? <p className="status-message success">{profileMessage}</p> : null}

          <div className="security-footer">
            <span>
              <Icon name="shield" />
              Tus datos están seguros
            </span>
            <span>
              <Icon name="lock" />
              Privacidad garantizada
            </span>
          </div>

          <p className="powered">
            Powered by <strong>✦ Gemini</strong>
          </p>
        </aside>
      </div>
    </main>
  );
}

function TrainingApp({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [activeModule, setActiveModule] = useState<ModuleKey>("dash");
  const [profile, setProfile] = useState<Profile>(() => getStoredProfile(user));

  const weeklyLoad = useMemo(
    () => sessions.gym[0].load + sessions.running[0].load + sessions.cycling[0].load,
    [],
  );

  useEffect(() => {
    const token = localStorage.getItem("token");

    if (!token) {
      return;
    }

    fetch(`${API_URL}/profile/data`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data?.profile) {
          setProfile((current) => ({ ...current, ...data.profile }));
          localStorage.setItem(PROFILE_KEY, JSON.stringify(data.profile));
        }
      })
      .catch(() => {
        // Local JSON cache remains the fallback when the backend is offline.
      });
  }, []);

  const saveProfile = (nextProfile: Profile) => {
    setProfile(nextProfile);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(nextProfile));
    const token = localStorage.getItem("token");

    if (token) {
      fetch(`${API_URL}/profile/data`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ profile: nextProfile }),
      }).catch(() => {
        // The local JSON cache already has the latest profile.
      });
    }
  };

  return (
    <main className="training-app">
      <aside className="app-sidebar">
        <div className="app-brand">
          <Logo compact />
          <span>Training Intelligence</span>
        </div>

        <div className="app-score">
          <strong>82</strong>
          <div>
            <span>Readiness</span>
            <p>Excelente para entrenar</p>
          </div>
          <i style={{ width: "82%" }} />
        </div>

        <nav className="app-nav" aria-label="Módulos">
          {navItems.map((item) => (
            <div key={item.key}>
              {item.section ? <p className="nav-section">{item.section}</p> : null}
              <button
                className={activeModule === item.key ? "active" : ""}
                type="button"
                onClick={() => setActiveModule(item.key)}
              >
                <span>{item.icon}</span>
                {item.label}
              </button>
            </div>
          ))}
        </nav>
      </aside>

      <section className="app-main">
        <header className="app-topbar">
          <div>
            <p>IDG Training Pro</p>
            <h1>{moduleNames[activeModule]}</h1>
          </div>
          <div className="user-chip">
            <Image src={user.picture} alt={user.name} width={38} height={38} />
            <span>{profile.name}</span>
            <button type="button" onClick={onLogout}>
              Salir
            </button>
          </div>
        </header>

        <div className="app-content">
          {activeModule === "dash" ? <Dashboard weeklyLoad={weeklyLoad} /> : null}
          {activeModule === "plan" ? <PlanModule /> : null}
          {activeModule === "gym" ? <GymModule /> : null}
          {activeModule === "running" ? <RunningModule /> : null}
          {activeModule === "cycling" ? <CyclingModule /> : null}
          {activeModule === "weight" ? <WeightModule /> : null}
          {activeModule === "recovery" ? <RecoveryModule /> : null}
          {activeModule === "goals" ? <GoalsModule profile={profile} /> : null}
          {activeModule === "profile" ? <ProfileModule profile={profile} onSave={saveProfile} /> : null}
          {activeModule === "import" ? <ImportModule /> : null}
        </div>
      </section>
    </main>
  );
}

function KpiCard({ label, value, sub, tone = "blue" }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <article className={`app-kpi tone-${tone}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{sub}</span>
    </article>
  );
}

function Dashboard({ weeklyLoad }: { weeklyLoad: number }) {
  return (
    <>
      <div className="app-kpi-grid">
        <KpiCard label="Carga semanal" value={`${weeklyLoad}`} sub="Óptima, +12%" tone="green" />
        <KpiCard label="Running" value="21.9 km" sub="3 sesiones" tone="green" />
        <KpiCard label="Ciclismo" value="114.9 km" sub="3 rutas" tone="blue" />
        <KpiCard label="Gym" value="3" sub="sesiones fuerza" tone="purple" />
        <KpiCard label="Recuperación" value="86%" sub="lista para carga" tone="orange" />
      </div>

      <div className="app-grid app-grid-2">
        <section className="app-card">
          <div className="card-head">
            <div>
              <h2>Carga de entrenamiento</h2>
              <p>Balance semanal por disciplina</p>
            </div>
            <span>Proyección estable</span>
          </div>
          <MiniBars />
        </section>

        <section className="app-card">
          <div className="card-head">
            <div>
              <h2>Distribución por deporte</h2>
              <p>Volumen relativo de los últimos 7 días</p>
            </div>
          </div>
          <div className="discipline-bars">
            <span>Running <b>32%</b></span>
            <i style={{ width: "32%", background: "#22c55e" }} />
            <span>Ciclismo <b>46%</b></span>
            <i style={{ width: "46%", background: "#3b82f6" }} />
            <span>Gym <b>22%</b></span>
            <i style={{ width: "22%", background: "#8b5cf6" }} />
          </div>
        </section>
      </div>

      <div className="app-grid app-grid-3">
        <SessionList title="Último Gym" items={sessions.gym.map((s) => `${s.date} · ${s.title} · ${s.time}`)} />
        <SessionList title="Último Running" items={sessions.running.map((s) => `${s.date} · ${s.title} · ${s.km} km`)} />
        <SessionList title="Último Ciclismo" items={sessions.cycling.map((s) => `${s.date} · ${s.title} · ${s.km} km`)} />
      </div>
    </>
  );
}

function SessionList({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="app-card">
      <h2>{title}</h2>
      <div className="session-list">
        {items.map((item) => (
          <article key={item}>
            <span>{item.split(" · ")[0]}</span>
            <p>{item.replace(`${item.split(" · ")[0]} · `, "")}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function PlanModule() {
  const days = [
    ["Lun", "Gym Push", "Fuerza moderada"],
    ["Mar", "Running Z2", "Base aeróbica"],
    ["Mié", "Ciclismo", "Cadencia + técnica"],
    ["Jue", "Gym Pierna", "Carga controlada"],
    ["Vie", "Descanso", "Movilidad"],
    ["Sáb", "Running Tempo", "Ritmo objetivo"],
    ["Dom", "Fondo bici", "Resistencia"],
  ];

  return (
    <section className="app-card">
      <div className="card-head">
        <div>
          <h2>Microciclo semanal</h2>
          <p>Plan generado desde tu perfil y carga reciente. No requiere conexión Google dentro del módulo.</p>
        </div>
        <button className="app-button" type="button">
          Guardar semana
        </button>
      </div>
      <div className="week-grid">
        {days.map(([day, title, desc]) => (
          <article key={day}>
            <span>{day}</span>
            <strong>{title}</strong>
            <p>{desc}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function GymModule() {
  const [routine, setRoutine] = useState<GymRoutineKey>("chest");
  const [unit, setUnit] = useState<"kg" | "lbs">("kg");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [duration, setDuration] = useState("75");
  const [intensity, setIntensity] = useState("7");
  const [pain, setPain] = useState("");
  const [painLevel, setPainLevel] = useState("");
  const [calories, setCalories] = useState("");
  const [notes, setNotes] = useState("");
  const [exercises, setExercises] = useState<GymExerciseDraft[]>([]);
  const [history, setHistory] = useState<GymSession[]>([]);
  const [message, setMessage] = useState("");

  const buildRoutineExercises = (nextRoutine: GymRoutineKey, storedHistory = history) => {
    const lastSession = storedHistory.find((session) => session.routine === nextRoutine);
    const lastByName = new Map((lastSession?.exercises ?? []).map((exercise) => [exercise.name, exercise]));

    return gymRoutines[nextRoutine].exercises.map((exercise, index) => {
      const previous = lastByName.get(exercise.name);
      const setCount = previous?.sets ?? exercise.sets;
      const previousWeights = previous?.weights ?? [];

      return {
        id: `${nextRoutine}-${index}-${exercise.name}`,
        ...exercise,
        sets: setCount,
        reps: previous?.reps ?? exercise.reps,
        rest: previous?.rest ?? exercise.rest,
        note: previous?.note ?? exercise.note,
        weights: Array.from({ length: setCount }, (_, setIndex) => previousWeights[setIndex] ?? ""),
      };
    });
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem(GYM_SESSION_KEY);
      const savedHistory: GymSession[] = saved ? JSON.parse(saved) : [];
      const sorted = savedHistory.sort((a, b) => b.updatedAt - a.updatedAt);
      setHistory(sorted);
      setExercises(buildRoutineExercises(routine, sorted));
    } catch {
      setExercises(buildRoutineExercises(routine, []));
    }
  }, []);

  const selectRoutine = (nextRoutine: GymRoutineKey) => {
    setRoutine(nextRoutine);
    setExercises(buildRoutineExercises(nextRoutine));
    const previous = history.find((session) => session.routine === nextRoutine);
    setMessage(
      previous
        ? `Cargue los pesos de tu ultima sesion: ${previous.date}.`
        : "Rutina lista. Puedes registrar pesos nuevos ejercicio por ejercicio.",
    );
  };

  const updateExercise = (id: string, patch: Partial<GymExerciseDraft>) => {
    setExercises((current) =>
      current.map((exercise) => (exercise.id === id ? { ...exercise, ...patch } : exercise)),
    );
  };

  const changeSets = (id: string, delta: number) => {
    setExercises((current) =>
      current.map((exercise) => {
        if (exercise.id !== id) {
          return exercise;
        }

        const nextSets = Math.max(1, Math.min(10, exercise.sets + delta));
        return {
          ...exercise,
          sets: nextSets,
          weights: Array.from({ length: nextSets }, (_, index) => exercise.weights[index] ?? ""),
        };
      }),
    );
  };

  const updateWeight = (id: string, setIndex: number, value: string) => {
    setExercises((current) =>
      current.map((exercise) => {
        if (exercise.id !== id) {
          return exercise;
        }

        const nextWeights = [...exercise.weights];
        nextWeights[setIndex] = value;
        return { ...exercise, weights: nextWeights };
      }),
    );
  };

  const addExercise = () => {
    const nextIndex = exercises.length + 1;
    setExercises((current) => [
      ...current,
      {
        id: `custom-${Date.now()}`,
        name: `Ejercicio ${nextIndex}`,
        sets: 3,
        reps: "10",
        weights: ["", "", ""],
        rest: 90,
        note: "Personalizado",
      },
    ]);
  };

  const deleteExercise = (id: string) => {
    setExercises((current) => {
      if (current.length <= 1) {
        setMessage("Deja al menos un ejercicio para poder guardar la sesion.");
        return current;
      }

      return current.filter((exercise) => exercise.id !== id);
    });
  };

  const saveGymSession = () => {
    const nextSession: GymSession = {
      id: `gym-${Date.now()}`,
      date,
      routine,
      routineName: gymRoutines[routine].name,
      duration: Number(duration) || 0,
      intensity,
      pain,
      painLevel,
      calories,
      notes,
      exercises,
      updatedAt: Date.now(),
    };
    const nextHistory = [nextSession, ...history].sort((a, b) => b.updatedAt - a.updatedAt);
    setHistory(nextHistory);
    localStorage.setItem(GYM_SESSION_KEY, JSON.stringify(nextHistory));
    setMessage("Sesion guardada. La proxima vez esta rutina abrira con estos pesos.");
  };

  const saveExerciseProgress = (exerciseId: string) => {
    const exercise = exercises.find((item) => item.id === exerciseId);

    if (!exercise) {
      return;
    }

    const draftSession: GymSession = {
      id: `gym-${Date.now()}`,
      date,
      routine,
      routineName: gymRoutines[routine].name,
      duration: Number(duration) || 0,
      intensity,
      pain,
      painLevel,
      calories,
      notes,
      exercises,
      updatedAt: Date.now(),
    };
    const nextHistory = [draftSession, ...history].sort((a, b) => b.updatedAt - a.updatedAt);
    setHistory(nextHistory);
    localStorage.setItem(GYM_SESSION_KEY, JSON.stringify(nextHistory));
    setMessage(`${exercise.name} guardado sin perder el resto de la rutina.`);
  };

  const latestForRoutine = history.find((session) => session.routine === routine);
  const totalVolume = exercises.reduce(
    (sum, exercise) =>
      sum +
      exercise.weights.reduce((weightSum, weight) => weightSum + (Number(weight) || 0), 0),
    0,
  );

  return (
    <div className="gym-workspace">
      <section className="app-card gym-builder">
        <div className="card-head">
          <div>
            <h2>Rutina activa</h2>
            <p>
              {latestForRoutine
                ? `Ultima guardada: ${latestForRoutine.date}. Pesos precargados.`
                : "Selecciona una rutina y registra cada ejercicio a tu ritmo."}
            </p>
          </div>
          <button className="app-button" type="button" onClick={saveGymSession}>
            Guardar sesion
          </button>
        </div>

        <div className="gym-toolbar">
          <label>
            Rutina
            <select value={routine} onChange={(event) => selectRoutine(event.target.value as GymRoutineKey)}>
              {Object.entries(gymRoutines).map(([key, value]) => (
                <option key={key} value={key}>
                  {value.name}
                </option>
              ))}
            </select>
          </label>
          <div className="unit-switch" aria-label="Unidad de peso">
            {(["kg", "lbs"] as const).map((value) => (
              <button
                className={unit === value ? "active" : ""}
                key={value}
                type="button"
                onClick={() => setUnit(value)}
              >
                {value}
              </button>
            ))}
          </div>
          <label>
            Fecha
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label>
            Duracion
            <input type="number" min="0" value={duration} onChange={(event) => setDuration(event.target.value)} />
          </label>
          <label>
            Intensidad
            <input type="number" min="1" max="10" value={intensity} onChange={(event) => setIntensity(event.target.value)} />
          </label>
          <label>
            Calorias
            <input
              type="number"
              min="0"
              placeholder="Opcional"
              value={calories}
              onChange={(event) => setCalories(event.target.value)}
            />
          </label>
        </div>

        <div className="gym-context">
          <label>
            Dolor
            <input value={pain} placeholder="Zona de dolor" onChange={(event) => setPain(event.target.value)} />
          </label>
          <label>
            Nivel dolor
            <input
              type="number"
              min="0"
              max="10"
              value={painLevel}
              placeholder="0-10"
              onChange={(event) => setPainLevel(event.target.value)}
            />
          </label>
          <label>
            Notas
            <input value={notes} placeholder="Sensaciones, tecnica o ajuste" onChange={(event) => setNotes(event.target.value)} />
          </label>
        </div>

        {message ? <p className="gym-message">{message}</p> : null}

        <div className="gym-exercise-head">
          <span>Ejercicio</span>
          <span>Series</span>
          <span>Reps</span>
          <span>Peso por serie ({unit})</span>
          <span>Descanso</span>
          <span>Acciones</span>
        </div>

        <div className="gym-exercise-list">
          {exercises.map((exercise, index) => (
            <article className="gym-exercise-row" key={exercise.id}>
              <div className="gym-exercise-name">
                <span>{index + 1}</span>
                <div>
                  <input
                    value={exercise.name}
                    onChange={(event) => updateExercise(exercise.id, { name: event.target.value })}
                  />
                  {exercise.note ? <small>{exercise.note}</small> : null}
                </div>
              </div>

              <div className="series-ctrl">
                <button type="button" onClick={() => changeSets(exercise.id, -1)} aria-label="Quitar serie">
                  -
                </button>
                <strong>{exercise.sets}</strong>
                <button type="button" onClick={() => changeSets(exercise.id, 1)} aria-label="Agregar serie">
                  +
                </button>
              </div>

              <input
                className="compact-input"
                value={exercise.reps}
                onChange={(event) => updateExercise(exercise.id, { reps: event.target.value })}
              />

              <div className="weight-chips">
                {exercise.weights.map((weight, setIndex) => (
                  <label key={`${exercise.id}-${setIndex}`}>
                    S{setIndex + 1}
                    <input
                      type="number"
                      step={unit === "kg" ? "0.5" : "2.5"}
                      value={weight}
                      onChange={(event) => updateWeight(exercise.id, setIndex, event.target.value)}
                    />
                  </label>
                ))}
              </div>

              <input
                className="compact-input"
                type="number"
                value={exercise.rest}
                onChange={(event) => updateExercise(exercise.id, { rest: Number(event.target.value) || 0 })}
              />

              <div className="gym-row-actions">
                <button type="button" title="Guardar progreso" onClick={() => saveExerciseProgress(exercise.id)}>
                  ✓
                </button>
                <button type="button" title="Eliminar ejercicio" onClick={() => deleteExercise(exercise.id)}>
                  ×
                </button>
              </div>
            </article>
          ))}
        </div>

        <button className="add-exercise-btn" type="button" onClick={addExercise}>
          + Agregar ejercicio
        </button>
      </section>

      <aside className="gym-side">
        <section className="app-card gym-ai-card">
          <div className="card-head">
            <div>
              <h2>Consejo IA</h2>
              <p>Guia local basada en tu registro actual.</p>
            </div>
          </div>
          <div className="ai-advice-list">
            <p><b>Carga:</b> {totalVolume ? `${totalVolume.toFixed(0)} ${unit} acumulados en series registradas.` : "Empieza con cargas de referencia."}</p>
            <p><b>Dolor:</b> {pain ? `Ajusta ${pain} si supera ${painLevel || "3"}/10.` : "Sin dolor reportado."}</p>
            <p><b>Smartwatch:</b> registra calorias si tu reloj las muestra; no bloquea el guardado.</p>
          </div>
        </section>

        <section className="app-card">
          <div className="card-head">
            <div>
              <h2>Historial de sesiones</h2>
              <p>{history.length ? `${history.length} sesiones guardadas` : "Aun no hay sesiones guardadas."}</p>
            </div>
          </div>
          <div className="gym-history-list">
            {history.slice(0, 6).map((session) => (
              <article key={session.id}>
                <span>{session.date}</span>
                <strong>{session.routineName}</strong>
                <p>
                  {session.exercises.length} ej. · {session.duration || 0} min · {session.intensity || "-"} /10
                  {session.calories ? ` · ${session.calories} cal` : ""}
                </p>
              </article>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}

function RunningModule() {
  return (
    <div className="app-grid app-grid-2">
      <SessionList title="Sesiones running" items={sessions.running.map((s) => `${s.date} · ${s.title} · ${s.pace}/km`)} />
      <section className="app-card">
        <h2>Zonas de carrera</h2>
        <ZoneBars zones={["Z1 Recuperación", "Z2 Base", "Z3 Tempo", "Z4 Umbral", "Z5 VO2"]} />
      </section>
    </div>
  );
}

function CyclingModule() {
  return (
    <div className="app-grid app-grid-2">
      <SessionList title="Rutas ciclismo" items={sessions.cycling.map((s) => `${s.date} · ${s.title} · ${s.speed} km/h`)} />
      <section className="app-card">
        <h2>Mapa y potencia</h2>
        <div className="map-preview">
          <span>Ruta sincronizada</span>
          <i />
        </div>
      </section>
    </div>
  );
}

function WeightModule() {
  return (
    <div className="app-grid app-grid-2">
      <section className="app-card">
        <h2>Composición corporal</h2>
        <div className="app-kpi-grid compact">
          <KpiCard label="Peso" value="67.5 kg" sub="-0.7 kg" tone="blue" />
          <KpiCard label="Grasa" value="14.8%" sub="bajando" tone="green" />
          <KpiCard label="Músculo" value="33.2 kg" sub="estable" tone="purple" />
        </div>
      </section>
      <SessionList title="Historial" items={sessions.weight.map((s) => `${s.date} · ${s.kg} kg · ${s.fat}% grasa`)} />
    </div>
  );
}

function RecoveryModule() {
  return (
    <div className="app-grid app-grid-2">
      <SessionList title="Registros de recuperación" items={sessions.recovery.map((s) => `${s.date} · sueño ${s.sleep}h · HRV ${s.hrv}`)} />
      <section className="app-card">
        <h2>Estado del sistema</h2>
        <p className="analysis-copy">
          Recuperación suficiente para trabajo moderado-alto. Prioriza sueño si acumulas dos días con HRV bajo.
        </p>
        <ZoneBars zones={["Sueño", "Energía", "Ánimo", "HRV"]} />
      </section>
    </div>
  );
}

function GoalsModule({ profile }: { profile: Profile }) {
  return (
    <div className="app-grid app-grid-2">
      <section className="app-card">
        <h2>Metas activas</h2>
        <div className="goal-list">
          {sessions.goals.map((goal) => (
            <article key={goal.name}>
              <span>{goal.current}%</span>
              <div>
                <strong>{goal.name}</strong>
                <p>{goal.status}</p>
              </div>
              <i style={{ width: `${goal.current}%` }} />
            </article>
          ))}
        </div>
      </section>
      <section className="app-card">
        <h2>Análisis IA local</h2>
        <p className="analysis-copy">
          Basado en el JSON del perfil de {profile.name}: tu mejor ventana de progreso está en combinar dos
          sesiones Z2, una sesión tempo y dos estímulos de fuerza. No se solicita API key en este módulo.
        </p>
      </section>
    </div>
  );
}

function ProfileModule({ profile, onSave }: { profile: Profile; onSave: (profile: Profile) => void }) {
  const [draft, setDraft] = useState(profile);

  const setField = (key: keyof Profile, value: string) => {
    setDraft((current) => ({
      ...current,
      [key]: ["weight", "height", "maxHr", "restHr"].includes(key)
        ? Number(value)
        : value,
    }));
  };

  return (
    <div className="app-grid app-grid-2">
      <section className="app-card">
        <div className="card-head">
          <div>
            <h2>Perfil deportivo</h2>
            <p>Datos guardados como JSON local de la aplicación. Sin API keys en cliente.</p>
          </div>
          <button className="app-button" type="button" onClick={() => onSave(draft)}>
            Guardar JSON
          </button>
        </div>
        <div className="profile-form">
          <label>Nombre<input value={draft.name} onChange={(e) => setField("name", e.target.value)} /></label>
          <label>Email<input value={draft.email} onChange={(e) => setField("email", e.target.value)} /></label>
          <label>Peso<input type="number" value={draft.weight} onChange={(e) => setField("weight", e.target.value)} /></label>
          <label>Altura<input type="number" value={draft.height} onChange={(e) => setField("height", e.target.value)} /></label>
          <label>FC máx<input type="number" value={draft.maxHr} onChange={(e) => setField("maxHr", e.target.value)} /></label>
          <label>FC reposo<input type="number" value={draft.restHr} onChange={(e) => setField("restHr", e.target.value)} /></label>
        </div>
      </section>
      <section className="app-card">
        <h2>JSON seguro de perfil</h2>
        <pre className="json-preview">{JSON.stringify(draft, null, 2)}</pre>
      </section>
    </div>
  );
}

function ImportModule() {
  return (
    <div className="app-grid app-grid-2">
      <section className="app-card import-zone-card">
        <h2>Importar archivos de actividad</h2>
        <p>GPX, FIT, TCX o CSV. La sincronización viene desde el acceso inicial; aquí no se pide Google.</p>
        <label className="import-zone">
          <input type="file" accept=".gpx,.fit,.tcx,.csv,.json" />
          <span>Arrastra o selecciona un archivo</span>
          <small>Se procesará localmente y quedará listo para persistencia JSON.</small>
        </label>
      </section>
      <section className="app-card">
        <h2>Guía rápida</h2>
        <ul className="guide-list">
          <li>Strava: exporta GPX desde actividad.</li>
          <li>Garmin/Magene: usa FIT o TCX.</li>
          <li>Datos corporales: CSV o JSON.</li>
        </ul>
      </section>
    </div>
  );
}

function ZoneBars({ zones }: { zones: string[] }) {
  return (
    <div className="zone-bars">
      {zones.map((zone, index) => (
        <article key={zone}>
          <span>{zone}</span>
          <i style={{ width: `${82 - index * 11}%` }} />
          <b>{82 - index * 11}%</b>
        </article>
      ))}
    </div>
  );
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [isSessionReady, setIsSessionReady] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const sessionCheck = window.setTimeout(() => {
      const storedUser = getStoredUser();
      setUser(storedUser);
      setIsSessionReady(true);

      if (storedUser) {
        router.replace("/dashboard");
      }
    }, 0);

    return () => window.clearTimeout(sessionCheck);
  }, [router]);

  if (isSessionReady && user) {
    return <main className="login-screen" />;
  }

  return <LoginExperience user={user} setUser={setUser} />;
}
