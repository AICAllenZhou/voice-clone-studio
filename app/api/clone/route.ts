import { NextResponse } from "next/server";
import { checkGate, keyMissing } from "@/lib/gate";

export const maxDuration = 60;

const ELEVENLABS_ADD_VOICE_URL = "https://api.elevenlabs.io/v1/voices/add";

/**
 * POST multipart/form-data:
 *   name: string
 *   files: one or more audio files
 *   remove_background_noise?: "true" | "false"
 *   labels?: JSON string
 * Forwards as multipart to ElevenLabs and returns { voice_id, requires_verification }.
 */
export async function POST(req: Request) {
  const gate = checkGate(req);
  if (gate) return gate;

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return keyMissing();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid multipart body" }, { status: 400 });
  }

  const name = String(form.get("name") ?? "").trim() || "My Voice";
  const files = form
    .getAll("files")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return NextResponse.json({ error: "no audio files provided" }, { status: 400 });
  }

  const outgoing = new FormData();
  outgoing.append("name", name);
  for (const file of files) {
    // Re-append so the original filename is preserved for ElevenLabs.
    outgoing.append("files", file, file.name || "sample.mp3");
  }
  const rbn = form.get("remove_background_noise");
  if (rbn === "true" || rbn === "false") {
    outgoing.append("remove_background_noise", String(rbn));
  }
  const labels = form.get("labels");
  if (typeof labels === "string" && labels.trim()) {
    outgoing.append("labels", labels);
  }

  let upstream: Response;
  try {
    upstream = await fetch(ELEVENLABS_ADD_VOICE_URL, {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: outgoing,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "failed to reach ElevenLabs", detail: String(e) },
      { status: 502 }
    );
  }

  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return NextResponse.json(
      { error: "ElevenLabs rejected the request", detail: data },
      { status: upstream.status }
    );
  }

  return NextResponse.json({
    voice_id: data.voice_id,
    requires_verification: !!data.requires_verification,
  });
}
