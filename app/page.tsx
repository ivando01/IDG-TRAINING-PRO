"use client";

import { completeSupabaseOAuthRedirect, startSupabaseGoogleLogin } from "@/lib/supabase-direct";
import { getRenderToken } from "@/lib/render-auth";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

const highlights = [
  ["3 MODULOS", "Gimnasio, Running y Ciclismo", "/icons/GYM.png"],
  ["SINCRONIZADO", "En todos tus dispositivos", "/icons/idg/progress.png"],
  ["SEGURO", "Tus datos siempre protegidos", "/icons/idg/settings.png"],
];

const trainingOptions = [
  ["GIMNASIO", "Rutinas y registro de ejercicios", "/icons/GYM.png"],
  ["RUNNING", "Planifica y registra tus carreras", "/icons/RUNER.png"],
  ["CICLISMO", "Rutas, metricas y tus salidas", "/icons/BIKE.png"],
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
    let alive = true;
    completeSupabaseOAuthRedirect()
      .then((session) => {
        if (!alive) return;
        if (session?.access_token) {
          getRenderToken().catch(() => undefined);
          router.replace("/dashboard");
          return;
        }
        if (localStorage.getItem("token")) {
          router.replace("/dashboard");
          return;
        }
        setReady(true);
      })
      .catch((error) => {
        if (!alive) return;
        setError(error instanceof Error ? error.message : "No se pudo completar el inicio de sesion.");
        setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [router]);

  const handleGoogleLogin = () => {
    try {
      setLoading(true);
      setError("");
      startSupabaseGoogleLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al iniciar sesion.");
      setLoading(false);
    }
  };

  const connectStrava = async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getRenderToken();
      if (!token) throw new Error("Strava usa Render como funcion secundaria. Inicia sesion de nuevo cuando Render este disponible para vincularlo.");
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
            <button type="button">Modo claro</button>
          </header>

          <div className="hero-grid">
            <section className="hero-copy">
              <h1>
                Tu entrenamiento. Tu progreso. <span>Tu mejor version.</span>
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
              <Image className="athlete-main" src="/imagen_inicio.png" alt="" fill sizes="(max-width: 1180px) 92vw, 50vw" priority />
            </section>
          </div>

          <section className="training-choice" aria-label="Elige tu entrenamiento">
            <h2>Elige tu entrenamiento</h2>
            <div>
              {trainingOptions.map(([title, text, icon]) => (
                <article key={title}>
                  <span><img src={icon} alt="" aria-hidden="true" /></span>
                  <strong>{title}</strong>
                  <p>{text}</p>
                  <small aria-hidden="true">-&gt;</small>
                </article>
              ))}
            </div>
          </section>
        </section>

        <aside className="auth-card" aria-label="Inicio de sesion">
          <BrandMark compact />

          <div className="auth-heading">
            <span>Acceso privado</span>
            <h2>Bienvenido de <strong>nuevo</strong></h2>
            <p>Entra a tu panel y manten tus datos deportivos sincronizados.</p>
          </div>

          {error ? <p className="status-message error">{error}</p> : null}

          <div className="social-actions">
            <div className="google-frame">
              <button className="google-login-button" type="button" onClick={handleGoogleLogin} disabled={loading}>
                <span aria-hidden="true">G</span>
                {loading ? "Abriendo Google..." : "Continuar con Google"}
              </button>
            </div>
            <button className="strava-button" type="button" onClick={connectStrava} disabled={loading}>
              <span>STRAVA</span>
              Conectar con Strava
            </button>
          </div>

          <div className="divider">o continua con email</div>

          <form className="email-form" onSubmit={handleEmailLogin}>
            <label>
              <span aria-hidden="true">@</span>
              <input type="email" placeholder="Correo electronico" value={email} onChange={(event) => setEmail(event.target.value)} />
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
            No tienes cuenta? <button type="button" onClick={() => setError("Crea tu cuenta entrando con Google.")}>Crear cuenta</button>
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
