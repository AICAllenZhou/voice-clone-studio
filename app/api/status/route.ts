import { NextResponse } from "next/server";

// Never leaks the key — only reports whether it is configured.
export async function GET() {
  return NextResponse.json({
    ok: true,
    keyConfigured: !!process.env.ELEVENLABS_API_KEY,
    passwordProtected: !!process.env.SITE_PASSWORD,
  });
}
