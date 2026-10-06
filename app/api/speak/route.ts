import { NextResponse } from "next/server";
import { checkGate, keyMissing } from "@/lib/gate";

export const maxDuration = 60;

const MAX_TEXT_LENGTH = 1500;

/**
 * POST JSON: { voice_id, text, model_id?, voice_settings? }
 * Returns the synthesized audio as audio/mpeg.
 */
export async function POST(req: Request) {
  const gate = checkGate(req);
  if (gate) return gate;

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return keyMissing();

  let body: {
    voice_id?: unknown;
    text?: unknown;
    model_id?: unknown;
    voice_settings?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const voiceId = typeof body.voice_id === "string" ? body.voice_id.trim() : "";
  const text = typeof body.text === "string" ? body.text : "";
  if (!voiceId) {
    return NextResponse.json({ error: "voice_id is required" }, { status: 400 });
  }
  if (!text.trim()) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json(
      { error: `text exceeds ${MAX_TEXT_LENGTH} characters` },
      { status: 400 }
    );
  }

  const payload: Record<string, unknown> = {
    text,
    model_id:
      typeof body.model_id === "string" && body.model_id
        ? body.model_id
        : "eleven_multilingual_v2",
  };
  if (body.voice_settings && typeof body.voice_settings === "object") {
    payload.voice_settings = body.voice_settings;
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify(payload),
      }
    );
  } catch (e) {
    return NextResponse.json(
      { error: "failed to reach ElevenLabs", detail: String(e) },
      { status: 502 }
    );
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: "ElevenLabs rejected the request", detail: detail.slice(0, 500) },
      { status: upstream.status }
    );
  }

  const audio = await upstream.arrayBuffer();
  return new NextResponse(audio, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(audio.byteLength),
      "Content-Disposition": 'attachment; filename="speech.mp3"',
    },
  });
}
