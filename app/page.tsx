"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

const MAX_UPLOAD_BYTES = 3.5 * 1024 * 1024; // stay under Vercel's ~4.5MB serverless payload limit
const MAX_TEXT = 1500;

const MODELS = [
  { id: "eleven_multilingual_v2", label: "Multilingual v2 · 多语言（默认）" },
  { id: "eleven_turbo_v2_5", label: "Turbo v2.5 · 更快更便宜" },
  { id: "eleven_v3", label: "Eleven v3 · 最新" },
];

type Status = {
  ok: boolean;
  keyConfigured: boolean;
  passwordProtected: boolean;
};

type CloneResult = {
  voice_id: string;
  requires_verification: boolean;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Files over 3.5MB are decoded and re-encoded client-side to mono 64kbps MP3
 * so the upload stays under Vercel's serverless request-body limit (~4.5MB).
 */
async function compressAudio(file: File): Promise<File> {
  if (file.size <= MAX_UPLOAD_BYTES) return file;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new AC();
  try {
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    const len = decoded.length;
    const channels = decoded.numberOfChannels;
    const mono = new Float32Array(len);
    for (let c = 0; c < channels; c++) {
      const data = decoded.getChannelData(c);
      for (let i = 0; i < len; i++) mono[i] += data[i] / channels;
    }
    const pcm = new Int16Array(len);
    for (let i = 0; i < len; i++) {
      const s = Math.max(-1, Math.min(1, mono[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    const lamejs = await import("lamejs");
    // lamejs@1.2.1's src/js modules reference MPEGMode (in Lame.js), Lame (in
    // BitStream.js) and BitStream (in QuantizePVT.js) as bare globals. Those
    // only exist in the prebuilt lame.all.js script bundle; in a
    // webpack/Next.js module bundle they are undefined and `new Mp3Encoder()`
    // throws "MPEGMode is not defined". Provide them on globalThis first.
    const g = globalThis as unknown as {
      MPEGMode?: unknown;
      Lame?: unknown;
      BitStream?: unknown;
    };
    if (!g.MPEGMode || !g.Lame || !g.BitStream) {
      // NOTE: these must be literal specifiers so webpack can resolve and
      // bundle them at build time; import(variable) fails at runtime.
      const mpegModeMod = await import("lamejs/src/js/MPEGMode.js");
      const lameMod = await import("lamejs/src/js/Lame.js");
      const bitStreamMod = await import("lamejs/src/js/BitStream.js");
      const unwrap = (m: unknown) =>
        (m as { default?: unknown }).default ?? m;
      g.MPEGMode = unwrap(mpegModeMod);
      g.Lame = unwrap(lameMod);
      g.BitStream = unwrap(bitStreamMod);
    }
    const encoder = new lamejs.Mp3Encoder(1, decoded.sampleRate, 64);
    const chunks: Int8Array[] = [];
    const BLOCK = 1152;
    for (let i = 0; i < pcm.length; i += BLOCK) {
      const out = encoder.encodeBuffer(pcm.subarray(i, i + BLOCK));
      if (out.length > 0) chunks.push(out);
    }
    const tail = encoder.flush();
    if (tail.length > 0) chunks.push(tail);
    const blob = new Blob(chunks as BlobPart[], { type: "audio/mpeg" });
    const base = file.name.replace(/\.[^.]+$/, "") || "sample";
    return new File([blob], `${base}.mp3`, { type: "audio/mpeg" });
  } finally {
    void ctx.close();
  }
}

// Pre-cloned voice: "Stefanie Sun" (cloned 2026-10-05 from the 2014 interview
// sample). Prefilled in the TTS section; a voice cloned in the UI overwrites it.
const DEFAULT_VOICE_ID = "ym4g8Bf0cwANMRzy2vMC";

export default function Home() {  const [status, setStatus] = useState<Status | null>(null);
  const [password, setPassword] = useState("");

  // --- clone state ---
  const [voiceName, setVoiceName] = useState("My Voice");
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [removeNoise, setRemoveNoise] = useState(false);
  const [optimizing, setOptimizing] = useState<string | null>(null);
  const [cloning, setCloning] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [cloneResult, setCloneResult] = useState<CloneResult | null>(null);
  const [copied, setCopied] = useState(false);

  // --- tts state ---
  const [ttsVoiceId, setTtsVoiceId] = useState(DEFAULT_VOICE_ID);
  const [text, setText] = useState("");
  const [model, setModel] = useState(MODELS[0].id);
  const [stability, setStability] = useState(0.5);
  const [similarity, setSimilarity] = useState(0.75);
  const [style, setStyle] = useState(0);
  const [speakerBoost, setSpeakerBoost] = useState(true);
  const [synthesizing, setSynthesizing] = useState(false);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const ttsRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((d: Status) => setStatus(d))
      .catch(() => setStatus(null));
    const savedPw = sessionStorage.getItem("vcs_password") ?? "";
    setPassword(savedPw);
    const savedVoice = localStorage.getItem("vcs_voice_id") ?? "";
    if (savedVoice) setTtsVoiceId(savedVoice);
  }, []);

  const authHeaders = (): HeadersInit =>
    password ? { "x-site-password": password } : {};

  const onPasswordChange = (v: string) => {
    setPassword(v);
    sessionStorage.setItem("vcs_password", v);
  };

  const addFiles = (list: FileList | File[]) => {
    const incoming = Array.from(list).filter(
      (f) => f.type.startsWith("audio/") || /\.(mp3|wav|m4a|ogg|flac)$/i.test(f.name)
    );
    if (incoming.length > 0) setFiles((prev) => [...prev, ...incoming]);
  };

  const handleClone = async () => {
    setCloneError(null);
    setCloneResult(null);
    setCopied(false);
    if (files.length === 0) {
      setCloneError("请先选择音频文件 · Please select audio files first");
      return;
    }
    setCloning(true);
    try {
      const prepared: File[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        if (f.size > MAX_UPLOAD_BYTES) {
          setOptimizing(`Optimizing audio… 正在优化音频 ${i + 1}/${files.length}`);
          prepared.push(await compressAudio(f));
        } else {
          prepared.push(f);
        }
      }
      setOptimizing(null);

      const fd = new FormData();
      fd.append("name", voiceName.trim() || "My Voice");
      for (const f of prepared) fd.append("files", f, f.name);
      fd.append("remove_background_noise", removeNoise ? "true" : "false");

      const res = await fetch("/api/clone", {
        method: "POST",
        headers: authHeaders(),
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : `克隆失败 · Clone failed (HTTP ${res.status})`
        );
      }
      const result: CloneResult = {
        voice_id: data.voice_id,
        requires_verification: !!data.requires_verification,
      };
      setCloneResult(result);
      if (result.voice_id) {
        localStorage.setItem("vcs_voice_id", result.voice_id);
        setTtsVoiceId(result.voice_id);
      }
    } catch (e) {
      setCloneError(e instanceof Error ? e.message : String(e));
    } finally {
      setCloning(false);
      setOptimizing(null);
    }
  };

  const handleCopy = async () => {
    if (!cloneResult?.voice_id) return;
    try {
      await navigator.clipboard.writeText(cloneResult.voice_id);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = cloneResult.voice_id;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleSpeak = async () => {
    setTtsError(null);
    if (!ttsVoiceId.trim()) {
      setTtsError("请填写 voice_id · Please enter a voice_id");
      return;
    }
    if (!text.trim()) {
      setTtsError("请填写要合成的文本 · Please enter some text");
      return;
    }
    setSynthesizing(true);
    try {
      const res = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          voice_id: ttsVoiceId.trim(),
          text,
          model_id: model,
          voice_settings: {
            stability,
            similarity_boost: similarity,
            style,
            use_speaker_boost: speakerBoost,
          },
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : `合成失败 · Synthesis failed (HTTP ${res.status})`
        );
      }
      const blob = await res.blob();
      setAudioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
    } catch (e) {
      setTtsError(e instanceof Error ? e.message : String(e));
    } finally {
      setSynthesizing(false);
    }
  };

  const busy = cloning || optimizing !== null;

  return (
    <main className={styles.page}>
      <div className={styles.bgGlow} aria-hidden="true" />
      <header className={styles.header}>
        <div className={styles.logo}>◉</div>
        <div>
          <h1>Voice Clone Studio</h1>
          <p>声音克隆工作台 · Powered by ElevenLabs</p>
        </div>
      </header>

      {status && !status.keyConfigured && (
        <div className={styles.banner} role="alert">
          <strong>ELEVENLABS_API_KEY not set on the server</strong>
          <span>
            请在 Vercel → Settings → Environment Variables 添加后重新部署 · Add it
            in Vercel → Settings → Environment Variables and redeploy.
          </span>
        </div>
      )}

      {status?.passwordProtected && (
        <div className={styles.card}>
          <label className={styles.field}>
            <span className={styles.label}>站点密码 · Site password</span>
            <input
              type="password"
              className={styles.input}
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              placeholder="输入访问密码 / Enter the site password"
              autoComplete="off"
            />
          </label>
        </div>
      )}

      {/* ---------- Section 1: Clone ---------- */}
      <section className={styles.card}>
        <h2>
          <span className={styles.step}>1</span> 克隆声音 · Clone voice
        </h2>
        <p className={styles.hint}>
          上传清晰的单人人声（总时长建议 1 分钟以上）。音频只经过「浏览器 → 本服务器 →
          ElevenLabs」，API key 始终保留在服务器端。
        </p>

        <label className={styles.field}>
          <span className={styles.label}>声音名称 · Voice name</span>
          <input
            className={styles.input}
            value={voiceName}
            onChange={(e) => setVoiceName(e.target.value)}
            placeholder="My Voice"
          />
        </label>

        <div
          className={`${styles.dropzone} ${dragOver ? styles.dropzoneActive : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            addFiles(e.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
          }}
        >
          <div className={styles.dropIcon}>＋</div>
          <div>拖拽音频到这里，或点击选择 · Drop audio here or click to browse</div>
          <div className={styles.dropSub}>支持 mp3 / wav / m4a · 可多选</div>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {files.length > 0 && (
          <ul className={styles.fileList}>
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className={styles.fileItem}>
                <span className={styles.fileName}>🎵 {f.name}</span>
                <span className={styles.fileMeta}>
                  {formatBytes(f.size)}
                  {f.size > MAX_UPLOAD_BYTES && (
                    <em className={styles.compressTag}>将自动压缩</em>
                  )}
                </span>
                <button
                  className={styles.removeBtn}
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                  aria-label="remove file"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={removeNoise}
            onChange={(e) => setRemoveNoise(e.target.checked)}
          />
          <span>去除背景噪音 · Remove background noise（录音干净时建议关闭）</span>
        </label>

        <button
          className={styles.primaryBtn}
          onClick={handleClone}
          disabled={busy || (status !== null && !status.keyConfigured)}
        >
          {optimizing
            ? optimizing
            : cloning
              ? "克隆中… · Cloning…"
              : "开始克隆 · Clone voice"}
        </button>

        {cloneError && <div className={styles.error}>{cloneError}</div>}

        {cloneResult && (
          <div className={styles.result}>
            <div className={styles.resultTitle}>✅ 克隆成功 · Voice cloned</div>
            <div className={styles.voiceIdRow}>
              <code className={styles.voiceId}>{cloneResult.voice_id}</code>
              <button className={styles.ghostBtn} onClick={handleCopy}>
                {copied ? "已复制 ✓" : "复制 · Copy"}
              </button>
            </div>
            {cloneResult.requires_verification && (
              <div className={styles.note}>
                ⚠️ ElevenLabs 要求额外的身份验证后才能使用此声音
                (requires_verification=true)，请去 ElevenLabs 后台完成验证。
              </div>
            )}
            <button
              className={styles.ghostBtn}
              onClick={() =>
                ttsRef.current?.scrollIntoView({ behavior: "smooth" })
              }
            >
              用于合成 → · Use for TTS →
            </button>
          </div>
        )}
      </section>

      {/* ---------- Section 2: TTS ---------- */}
      <section className={styles.card} ref={ttsRef}>
        <h2>
          <span className={styles.step}>2</span> 文本转语音 · Text to speech
        </h2>

        <label className={styles.field}>
          <span className={styles.label}>voice_id</span>
          <input
            className={styles.input}
            value={ttsVoiceId}
            onChange={(e) => setTtsVoiceId(e.target.value)}
            placeholder="粘贴 voice_id / paste voice_id"
            spellCheck={false}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>
            文本 · Text
            <span className={styles.counter}>
              {text.length}/{MAX_TEXT}
            </span>
          </span>
          <textarea
            className={styles.textarea}
            value={text}
            maxLength={MAX_TEXT}
            rows={5}
            onChange={(e) => setText(e.target.value)}
            placeholder="输入要合成的文本… / Type the text to synthesize…"
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>模型 · Model</span>
          <select
            className={styles.select}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <div className={styles.sliders}>
          <label className={styles.sliderRow}>
            <span>
              Stability · 稳定度 <b>{stability.toFixed(2)}</b>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={stability}
              onChange={(e) => setStability(Number(e.target.value))}
            />
          </label>
          <label className={styles.sliderRow}>
            <span>
              Similarity boost · 相似度 <b>{similarity.toFixed(2)}</b>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={similarity}
              onChange={(e) => setSimilarity(Number(e.target.value))}
            />
          </label>
          <label className={styles.sliderRow}>
            <span>
              Style · 风格 <b>{style.toFixed(2)}</b>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={style}
              onChange={(e) => setStyle(Number(e.target.value))}
            />
          </label>
        </div>

        <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={speakerBoost}
            onChange={(e) => setSpeakerBoost(e.target.checked)}
          />
          <span>Speaker boost · 说话人增强（克隆声音建议开启）</span>
        </label>

        <button
          className={styles.primaryBtn}
          onClick={handleSpeak}
          disabled={synthesizing || (status !== null && !status.keyConfigured)}
        >
          {synthesizing ? "合成中… · Synthesizing…" : "合成 · Synthesize"}
        </button>

        {ttsError && <div className={styles.error}>{ttsError}</div>}

        {audioUrl && (
          <div className={styles.result}>
            <div className={styles.resultTitle}>🔊 合成完成 · Done</div>
            <audio className={styles.audio} controls src={audioUrl} />
            <a
              className={styles.ghostBtn}
              href={audioUrl}
              download={`tts-${Date.now()}.mp3`}
            >
              下载 MP3 · Download
            </a>
          </div>
        )}
      </section>

      <footer className={styles.footer}>
        音频传输路径：浏览器 → 本服务器 → ElevenLabs，API key
        始终保留在服务器端，不会进入浏览器。
        <br />
        Audio travels browser → this server → ElevenLabs; the API key stays
        server-side and never reaches the browser.
      </footer>
    </main>
  );
}
