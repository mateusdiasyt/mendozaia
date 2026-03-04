import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Mendoza IA - CRM WhatsApp",
  description: "Plataforma profissional de automação de WhatsApp",
  icons: {
    icon: [
      { url: "/icon_mendoza.png", sizes: "32x32", type: "image/png" },
      { url: "/icon_mendoza.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: "/icon_mendoza.png",
    apple: "/icon_mendoza.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className={`${plusJakarta.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
