import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Voice Clone Studio · 声音克隆工作台",
  description:
    "Clone voices and synthesize speech with the ElevenLabs API — the API key never leaves the server.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
