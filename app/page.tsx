"use client";

import { GoogleLogin } from "@react-oauth/google";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function Home() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSuccess = async (credentialResponse: any) => {
    try {
      setLoading(true);
      const res = await fetch("http://localhost:3001/auth/google", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: credentialResponse.credential,
        }),
      });

      const data = await res.json();

      if (!data.token) {
        setError("Error en la autenticación");
        return;
      }

      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      router.push("/dashboard");
    } catch (error) {
      setError("Error al iniciar sesión");
      console.error("Error login:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      setError("");
      const res = await fetch("http://localhost:3001/auth/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!data.token) {
        setError(data.message || "Error en la autenticación");
        return;
      }

      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      router.push("/dashboard");
    } catch (error) {
      setError("Error al iniciar sesión");
      console.error("Error login:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-slate-50 to-slate-100">

      {/* LADO IZQUIERDO - INFORMACIÓN */}
      <div className="w-1/2 hidden lg:flex flex-col justify-center px-20 py-12">
        <div className="max-w-md">
          <div className="mb-8">
            <h1 className="text-5xl font-black text-slate-900 leading-tight mb-3">
              Entrena como un <span className="text-green-500">sistema completo.</span>
            </h1>
            <p className="text-slate-600 text-lg">
              Running, ciclismo y gimnasia en un solo ecosistema inteligente.
            </p>
          </div>

          {/* CARDS DE DEPORTES */}
          <div className="space-y-4 mt-12">
            <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-2xl p-6 text-white">
              <div className="text-2xl mb-3">🏋️</div>
              <h3 className="font-bold text-lg mb-2">GYM</h3>
              <ul className="text-sm space-y-1 text-purple-100">
                <li>• Fuerza</li>
                <li>• Hipertrofia</li>
                <li>• Movilidad</li>
              </ul>
            </div>

            <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl p-6 text-white">
              <div className="text-2xl mb-3">🚴</div>
              <h3 className="font-bold text-lg mb-2">CICLISMO</h3>
              <ul className="text-sm space-y-1 text-blue-100">
                <li>• Resistencia</li>
                <li>• Potencia</li>
                <li>• Velocidad</li>
              </ul>
            </div>

            <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-2xl p-6 text-white">
              <div className="text-2xl mb-3">🏃</div>
              <h3 className="font-bold text-lg mb-2">RUNNING</h3>
              <ul className="text-sm space-y-1 text-green-100">
                <li>• Resistencia</li>
                <li>• Ritmo</li>
                <li>• Recuperación</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* LADO DERECHO - LOGIN */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">
          {/* HEADER */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 mb-6">
              <span className="text-2xl font-black">🎯</span>
              <span className="text-xl font-black text-slate-900">IDG</span>
              <span className="text-xl font-black text-green-500">TRAINING</span>
              <span className="text-xs font-bold text-slate-500 ml-2">PRO</span>
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">
              ¡Bienvenido de nuevo!
            </h2>
            <p className="text-slate-600 text-sm">
              Inicia sesión para continuar optimizando tu rendimiento.
            </p>
          </div>

          {/* ERROR MESSAGE */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 text-sm">
              {error}
            </div>
          )}

          {/* GOOGLE LOGIN */}
          <div className="mb-6">
            <GoogleLogin
              onSuccess={handleSuccess}
              onError={() => setError("Error al iniciar con Google")}
              width="100%"
              theme="outline"
            />
          </div>

          {/* STRAVA LOGIN */}
          <button className="w-full bg-gradient-to-r from-orange-500 to-orange-600 text-white font-bold py-3 px-4 rounded-lg hover:shadow-lg transition mb-4">
            <span className="inline-flex items-center gap-2">
              <span>🔗</span> Conectar con Strava
            </span>
          </button>

          {/* DIVIDER */}
          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200"></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="px-3 bg-gradient-to-br from-slate-50 to-slate-100 text-slate-500 font-semibold">
                o continuar con email
              </span>
            </div>
          </div>

          {/* EMAIL FORM */}
          <form onSubmit={handleEmailLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-2">
                Contraseña
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-3 text-slate-500 hover:text-slate-700"
                >
                  {showPassword ? "👁️" : "👁️‍🗨️"}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="remember"
                className="w-4 h-4 rounded border-slate-300 cursor-pointer"
              />
              <label htmlFor="remember" className="text-sm text-slate-600 cursor-pointer">
                Recuérdame
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Iniciando sesión..." : "Iniciar sesión"}
            </button>
          </form>

          {/* FOOTER */}
          <div className="mt-8 text-center">
            <p className="text-slate-600 text-sm mb-4">
              ¿No tienes una cuenta?{" "}
              <button className="text-blue-600 font-bold hover:underline">
                Crear cuenta
              </button>
            </p>
            <div className="flex gap-4 justify-center text-xs">
              <button className="text-slate-500 hover:text-slate-700 flex items-center gap-1">
                🔒 Tus datos están seguros
              </button>
              <button className="text-slate-500 hover:text-slate-700">
                Privacidad garantizada
              </button>
            </div>
            <div className="mt-4 flex justify-center">
              <span className="text-xs text-slate-500">Powered by</span>
              <span className="text-sm font-bold text-slate-900 ml-1">✨ Gemini</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}