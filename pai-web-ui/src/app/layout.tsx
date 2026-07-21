import type { Metadata } from "next";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { ToastProvider } from "@/components/ui/toast";
import { KeyboardShortcuts } from "@/components/providers/KeyboardShortcuts";
import "./globals.css";

export const metadata: Metadata = {
  title: "PAI Command Center",
  description: "Personal AI Infrastructure - Command Center",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased min-h-screen">
        <ThemeProvider>
          <ToastProvider>
            <KeyboardShortcuts />
            {children}
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
