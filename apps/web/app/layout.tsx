import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "VOIDLINE · Tabletop Command",
  description:
    "Private multiplayer tabletop simulator. Original training mission based on the supplied rules source.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
