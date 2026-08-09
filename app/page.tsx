"use client";

import { GoogleLogin, type CredentialResponse } from "@react-oauth/google";
import { storeAccess } from "@/lib/access";
import { signInWithGoogleIdToken } from "@/lib/supabase-direct";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

const highlights = [
  ["3 MODULOS", "Gimnasio, Running y Ciclismo", "/icons/idg/muscle.png"],
  ["SINCRONIZACION TOTAL", "Tus datos contigo en todos tus dispositivos", "/icons/idg/progress.png"],
  ["TUS DATOS SEGUROS", "Privados, respaldados y 100% tuyos", "/icons/idg/settings.png"],
];

const stats = [
  ["FUERZA", "+24%", "Progreso promedio", "/icons/GYM.png"],
  ["RESISTENCIA", "+18%", "En tus tiempos", "/icons/RUNER.png"],
  ["DISTANCIA", "+32%", "En tus rutas", "/icons/BIKE.png"],
];

const workflow = [
  ["PLANIFICA", "tus entrenamientos", "/icons/idg/calendar.png"],
  ["REGISTRA", "cada sesion", "/icons/idg/add-session.png"],
  ["ANALIZA", "tu rendimiento", "/icons/idg/analytics.png"],
  ["MEJORA", "cada dia", "/icons/idg/achievement.png"],
];

const benefits = [
  ["AHORRA TIEMPO", "Todo tu entrenamiento en un solo lugar", "/icons/idg/timer.png"],
  ["ENFOCADO EN TI", "Planes y metricas adaptados a tus objetivos", "/icons/idg/route.png"],
  ["MIDE TU PROGRESO", "Estadisticas claras para tomar decisiones", "/icons/idg/trophy.png"],
  ["VIDA EN EQUILIBRIO", "Entrena, recupera y mejora tu estilo de vida", "/icons/idg/recovery.png"],
];

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <img
      src="/brand/idg-training-pro-logo-cropped.png"
      alt="IDG Training Pro"
      className={`${compact ? "h-16" : "h-36"} w-auto object-contain`}
    />
  );
}

export default function Home() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
    if (localStorage.getItem("token")) router.replace("/dashboard");
  }, [router]);

  const handleSuccess = async (credentialResponse: CredentialResponse) => {
    try {
      setLoading(true);
      setError("");
      if (!credentialResponse.credential) throw new Error("Google no devolvio credencial de inicio de sesion.");
      await signInWithGoogleIdToken(credentialResponse.credential);
      fetch(`${API_URL}/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: credentialResponse.credential }),
      })
        .then(async (response) => {
          const data = await response.json().catch(() => ({}));
          if (!response.ok || !data.token) return;
          localStorage.setItem("render_token", data.token);
          storeAccess(data.access);
        })
        .catch(() => undefined);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al iniciar sesion.");
    } finally {
      setLoading(false);
    }
  };

  const connectStrava = async () => {
    const token = localStorage.getItem("render_token");
    if (!token) {
      setError("Strava usa Render como funcion secundaria. Inicia sesion de nuevo cuando Render este disponible para vincularlo.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/access`, { headers: { Authorization: `Bearer ${token}` } });
      if (response.status === 401) {
        localStorage.removeItem("token");
        throw new Error("Tu sesion expiro. Inicia sesion de nuevo con Google y vuelve a conectar Strava.");
      }
      window.location.href = `${API_URL}/auth/strava?token=${encodeURIComponent(token)}`;
    } catch (error) {
      setLoading(false);
      setError(error instanceof Error ? error.message : "No se pudo validar tu sesion antes de conectar Strava.");
    }
  };

  const handleEmailLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("El acceso por email aun no esta activo. Usa Google para entrar a IDG Training Pro.");
  };

  if (!ready) return <main className="login-screen" />;

  return (
    <main className="login-screen">
      <div className="login-layout">
        <section className="product-side" aria-label="IDG Training Pro">
          <header className="login-nav" aria-label="Navegacion principal">
            <BrandMark />
            <nav>
              {["Inicio", "App", "Planes", "Caracteristicas", "Premium", "Contacto"].map((item, index) => (
                <a className={index === 0 ? "active" : ""} href="#" key={item}>{item}</a>
              ))}
            </nav>
            <button type="button">Modo claro</button>
          </header>

          <div className="hero-grid">
            <section className="hero-copy">
              <p className="hero-kicker">Tu plataforma integral</p>
              <h1>
                Entrena.
                <br />
                Registra.
                <br />
                <span>Evoluciona.</span>
              </h1>
              <p>Planifica, registra y analiza tu entrenamiento de gimnasio, running y ciclismo en un solo lugar.</p>

              <div className="hero-highlights">
                {highlights.map(([title, text, icon]) => (
                  <article key={title}>
                    <span><img src={icon} alt="" aria-hidden="true" /></span>
                    <div>
                      <strong>{title}</strong>
                      <p>{text}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="hero-athlete" aria-label="Entrenamiento integrado">
              <div className="hero-ring" />
              <Image className="athlete-main" src="/login-runner.png" alt="" fill sizes="(max-width: 1180px) 90vw, 42vw" priority />
              <Image className="athlete-card athlete-gym" src="/sport-gym.png" alt="" width={168} height={132} />
              <Image className="athlete-card athlete-bike" src="/sport-cycling.png" alt="" width={196} height={140} />
            </section>
          </div>

          <div className="stat-cards" aria-label="Metricas destacadas">
            {stats.map(([label, value, text, icon]) => (
              <article key={label}>
                <span><img src={icon} alt="" aria-hidden="true" /></span>
                <div>
                  <p>{label}</p>
                  <strong>{value}</strong>
                  <small>{text}</small>
                </div>
                <i aria-hidden="true" />
              </article>
            ))}
          </div>

          <div className="workflow-strip" aria-label="Flujo de uso">
            {workflow.map(([title, text, icon]) => (
              <article key={title}>
                <img src={icon} alt="" aria-hidden="true" />
                <strong>{title}</strong>
                <span>{text}</span>
              </article>
            ))}
          </div>

          <div className="benefit-strip" aria-label="Beneficios">
            {benefits.map(([title, text, icon]) => (
              <article key={title}>
                <img src={icon} alt="" aria-hidden="true" />
                <div>
                  <strong>{title}</strong>
                  <span>{text}</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="auth-card" aria-label="Inicio de sesion">
          <BrandMark compact />

          <div className="auth-heading">
            <span>Acceso privado</span>
            <h2>Bienvenido de nuevo</h2>
            <p>Entra a tu panel y manten tus datos deportivos sincronizados.</p>
          </div>

          {error ? <p className="status-message error">{error}</p> : null}

          <div className="social-actions">
            <div className="google-frame">
              <GoogleLogin onSuccess={handleSuccess} onError={() => setError("Error al iniciar con Google.")} width="100%" theme="outline" />
            </div>
            <button className="strava-button" type="button" onClick={connectStrava} disabled={loading}>
              <span>STRAVA</span>
              Conectar con Strava
            </button>
          </div>

          <div className="divider">o continuar con email</div>

          <form className="email-form" onSubmit={handleEmailLogin}>
            <label>
              <span aria-hidden="true">@</span>
              <input type="email" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label>
              <span aria-hidden="true">#</span>
              <input type={showPassword ? "text" : "password"} placeholder="Contrasena" value={password} onChange={(event) => setPassword(event.target.value)} />
              <button type="button" aria-label="Mostrar contrasena" onClick={() => setShowPassword((current) => !current)}>
                {showPassword ? "Ocultar" : "Ver"}
              </button>
            </label>
            <div className="form-meta">
              <label className="remember">
                <input type="checkbox" />
                Recordarme
              </label>
              <button type="button" onClick={() => setError("Recuperacion de contrasena pendiente de activar.")}>Olvidaste tu contrasena?</button>
            </div>
            <button className="login-button" type="submit" disabled={loading}>
              {loading ? "Iniciando..." : "Iniciar sesion"}
            </button>
          </form>

          <p className="create-account">
            No tienes una cuenta? <button type="button" onClick={() => setError("Crea tu cuenta entrando con Google.")}>Crear cuenta</button>
          </p>
          <p className="legal-links">
            <a href="/privacy">Politica de privacidad</a>
            <span aria-hidden="true">-</span>
            <a href="/term">Terminos de servicio</a>
          </p>
          <div className="device-sync">
            <div>
              <span>PC</span>
              <span>Movil</span>
              <span>Tablet</span>
              <span>Smartwatch</span>
            </div>
            <p>Sincronizado en todos tus dispositivos</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
