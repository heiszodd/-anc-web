import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "ANC Web — Anti-Noise Experiment", description: "Experimental browser anti-noise processing.", manifest: "/manifest.webmanifest" };
export const viewport: Viewport = { themeColor: "#0b0d0c" };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
