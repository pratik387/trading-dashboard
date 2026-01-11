import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Navbar } from "@/components/Navbar";
import { ConfigProvider } from "@/lib/ConfigContext";
import { AdminProvider } from "@/lib/AdminContext";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Trading Dashboard",
  description: "Live trading monitoring dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-gray-50 dark:bg-gray-950 min-h-screen`}>
        <ConfigProvider>
          <AdminProvider>
            <Navbar />
            <main className="max-w-7xl mx-auto px-4 py-6">
              {children}
            </main>
          </AdminProvider>
        </ConfigProvider>
      </body>
    </html>
  );
}
