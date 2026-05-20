import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { GoogleOAuthProvider } from "@react-oauth/google";

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
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
  return (
    <html lang="es">
      <body>
        <GoogleOAuthProvider clientId={googleClientId}>
          {children}
        </GoogleOAuthProvider>
      </body>
    </html>
  );
}
