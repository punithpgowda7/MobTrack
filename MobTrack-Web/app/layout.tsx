import type { Metadata, Viewport } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MobTrack — Find and Protect My Phone",
  description: "Find your phone, see live location, camera, sound, and photos.",
  icons: {
    icon: "/favicon.ico",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#070a10",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} h-full antialiased dark font-sans`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                localStorage.removeItem('mobtrack_theme');
                document.documentElement.classList.remove('light');
                document.documentElement.classList.add('dark');
              } catch(e) {}
            `,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col cyber-bg text-slate-100 selection:bg-emerald-500/30 selection:text-emerald-200" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
