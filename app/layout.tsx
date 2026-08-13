import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";

export const metadata = {
  title: "IDG Training Pro",
  description: "App de entrenamiento inteligente",
  icons: {
    icon: "/favicon.png",
    apple: "/brand/idg-app-favicon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
