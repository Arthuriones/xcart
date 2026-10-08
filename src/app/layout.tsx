import type { Metadata } from "next";
import { Public_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";

const publicSans = Public_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  weight: ["400", "500"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "xcart",
  description:
    "Lucro estimado de cada loja Shopify, já descontado o anúncio, e as compras enviadas ao Meta e ao TikTok pelo servidor e ao Google pela tag.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${publicSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-transparent" suppressHydrationWarning>
        {/* Segue o sistema ate o lojista escolher; a escolha (Claro, Escuro ou
            Sistema) fica no seletor de tema do menu e do rodape do site. */}
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <div className="ambient-bg" />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
