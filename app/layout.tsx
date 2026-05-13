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
  return (
    <html lang="es">
      <body>
        <GoogleOAuthProvider clientId="1046758819137-ao6ablnce565uj89bifcovh2jbfltjin.apps.googleusercontent.com">
          {children}
        </GoogleOAuthProvider>
      </body>
    </html>
  );
}
