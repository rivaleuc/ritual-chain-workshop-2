import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";

import { Providers } from "./providers";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-jakarta",
});

export const metadata: Metadata = {
  title: "Ritual Predict",
  description:
    "A self-resolving binary prediction market on Ritual Chain. No resolver, no cron job.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applied before paint so the first frame is already in the right theme. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.theme==='dark')document.documentElement.classList.add('dark')}catch(e){}`,
          }}
        />
      </head>
      <body className={`${jakarta.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
