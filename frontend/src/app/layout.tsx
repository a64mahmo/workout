import type { Metadata } from "next";
import "./globals.css";
import { Navigation } from "@/components/shared/navigation";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "Workout Tracker",
  description: "Track your workouts, manage cycles, and get suggestions",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased font-sans"
      suppressHydrationWarning
    >
      <body className="min-h-full flex-col flex">
        <Providers>
          <Navigation />
          <main className="flex-1 container mx-auto px-4 py-6">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
