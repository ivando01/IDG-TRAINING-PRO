"use client";

import { GoogleLogin, type CredentialResponse } from "@react-oauth/google";
import { storeAccess } from "@/lib/access";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

const sports = [
  {
    key: "gym",
    title: "GYM",
    icon: "/icons/GYM.png",
    image: "/sport-gym.png",
    items: ["Fuerza", "Hipertrofia", "Movilidad"],
  },
  {
    key: "cycling",
    title: "CICLISMO",
    icon: "/icons/BIKE.png",
    image: "/sport-cycling.png",
    items: ["Resistencia", "Potencia", "Velocidad"],
  },
  {
    key: "running",
    title: "RUNNING",
    icon: "/icons/RUNER.png",
    image: "/sport-running.png",
    items: ["Resistencia", "Ritmo", "Recuperacion"],
  },
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
      const response = await fetch(`${API_URL}/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: credentialResponse.credential }),
      });
      const data = await response.json();
      if (!response.ok || !data.token) throw new Error(data.error || "No se pudo iniciar sesion.");
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      storeAccess(data.access);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al iniciar sesion.");
    } finally {
      setLoading(false);
    }
  };

  const connectStrava = async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      setError("Primero inicia sesion con Google para vincular Strava.");
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
          <div className="intro-row">
            <BrandMark />
            <div className="hero-copy">
              <h1>
                Entrena como un <span>sistema completo.</span>
              </h1>
              <p>Running, ciclismo y gimnasio en un solo ecosistema inteligente.</p>
            </div>
          </div>

          <div className="sport-cards" aria-label="Modulos deportivos">
            {sports.map((sport) => (
              <article className={`sport-card sport-${sport.key}`} key={sport.key}>
                <Image src={sport.image} alt="" fill sizes="(max-width: 1180px) 290px, 25vw" priority={sport.key === "gym"} />
                <div className="sport-title">
                  <span>
                    <img src={sport.icon} alt="" aria-hidden="true" className="h-8 w-8 rounded-md object-cover" />
                  </span>
                  <h2>{sport.title}</h2>
                </div>
                <ul>
                  {sport.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <aside className="auth-card" aria-label="Inicio de sesion">
          <BrandMark compact />

          <div className="auth-heading">
            <h2>Bienvenido de nuevo</h2>
            <p>Inicia sesion para continuar optimizando tu rendimiento.</p>
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
              <span aria-hidden="true">✉</span>
              <input type="email" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label>
              <span aria-hidden="true">▢</span>
              <input type={showPassword ? "text" : "password"} placeholder="Contraseña" value={password} onChange={(event) => setPassword(event.target.value)} />
              <button type="button" aria-label="Mostrar contrasena" onClick={() => setShowPassword((current) => !current)}>
                ◉
              </button>
            </label>
            <div className="form-meta">
              <label className="remember">
                <input type="checkbox" />
                Recordarme
              </label>
              <button type="button" onClick={() => setError("Recuperacion de contrasena pendiente de activar.")}>Olvidaste tu contraseña?</button>
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
            <span aria-hidden="true">·</span>
            <a href="/term">Terminos de servicio</a>
          </p>
        </aside>
      </div>
    </main>
  );
}
