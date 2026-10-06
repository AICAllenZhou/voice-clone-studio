import { NextResponse } from "next/server";

/**
 * Optional password gate. If SITE_PASSWORD is set, /api/clone and /api/speak
 * require the request header `x-site-password` to match it.
 * Returns a 401 NextResponse when the gate fails, otherwise null.
 */
export function checkGate(req: Request): NextResponse | null {
  const sitePassword = process.env.SITE_PASSWORD;
  if (!sitePassword) return null; // open when unset
  const provided = req.headers.get("x-site-password");
  if (provided !== sitePassword) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export function keyMissing(): NextResponse {
  return NextResponse.json(
    { error: "ELEVENLABS_API_KEY not configured" },
    { status: 500 }
  );
}
