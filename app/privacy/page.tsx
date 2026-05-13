export const metadata = {
  title: "Politica de privacidad | IDG Training Pro",
  description: "Politica de privacidad de IDG Training Pro.",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#F8FAFC] px-5 py-10 text-slate-900">
      <section className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-black uppercase tracking-wide text-blue-600">IDG Training Pro</p>
        <h1 className="mt-2 text-3xl font-black">Politica de privacidad</h1>
        <p className="mt-2 text-sm font-semibold text-slate-500">Ultima actualizacion: mayo de 2026</p>

        <div className="mt-6 grid gap-5 text-sm font-semibold leading-7 text-slate-600">
          <p>
            IDG Training Pro usa datos de perfil, entrenamiento, actividad fisica y preferencias para mostrar
            dashboards, analisis, metas, planes y recomendaciones dentro de la aplicacion.
          </p>
          <p>
            Cuando inicias sesion con Google, usamos tu nombre, correo y foto de perfil para crear tu cuenta y
            mantener tu sesion. No vendemos tus datos personales.
          </p>
          <p>
            Si conectas Strava, la aplicacion puede leer actividades autorizadas por ti para calcular volumen,
            progreso, zonas, rutas y recomendaciones deportivas. Puedes revocar el acceso desde Strava o desde la
            aplicacion cuando la opcion este disponible.
          </p>
          <p>
            Los datos se almacenan en servicios de base de datos y hosting usados por la aplicacion, como Supabase,
            Render y Vercel. Se usan claves y tokens solo para operar las funciones autorizadas.
          </p>
          <p>
            Puedes solicitar revision, actualizacion o eliminacion de tus datos escribiendo al correo de soporte del
            proyecto.
          </p>
        </div>
      </section>
    </main>
  );
}
