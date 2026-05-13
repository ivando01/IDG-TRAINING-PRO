export const metadata = {
  title: "Terminos de servicio | IDG Training Pro",
  description: "Terminos de servicio de IDG Training Pro.",
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#F8FAFC] px-5 py-10 text-slate-900">
      <section className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-black uppercase tracking-wide text-blue-600">IDG Training Pro</p>
        <h1 className="mt-2 text-3xl font-black">Terminos de servicio</h1>
        <p className="mt-2 text-sm font-semibold text-slate-500">Ultima actualizacion: mayo de 2026</p>

        <div className="mt-6 grid gap-5 text-sm font-semibold leading-7 text-slate-600">
          <p>
            Al usar IDG Training Pro aceptas utilizar la aplicacion para registrar, consultar y analizar informacion
            relacionada con entrenamiento, salud deportiva y rendimiento personal.
          </p>
          <p>
            Las recomendaciones de la aplicacion son informativas y no sustituyen la evaluacion de un profesional de
            salud, entrenador certificado o medico. Debes ajustar cualquier plan segun tu condicion fisica y detener
            la actividad ante dolor, mareo o sintomas de riesgo.
          </p>
          <p>
            Eres responsable de la exactitud de los datos que registras y de las cuentas externas que decides conectar,
            incluyendo Google y Strava.
          </p>
          <p>
            Nos reservamos el derecho de modificar, suspender o mejorar funcionalidades de la aplicacion para mantener
            seguridad, estabilidad y calidad del servicio.
          </p>
          <p>
            Si no estas de acuerdo con estos terminos, debes dejar de usar la aplicacion y revocar los accesos externos
            conectados.
          </p>
        </div>
      </section>
    </main>
  );
}
