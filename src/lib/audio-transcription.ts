type AudioSourceKind = "data_url" | "remote_url";

type AudioTranscriptionStatus =
  | "transcribed"
  | "skipped_missing_api_key"
  | "skipped_missing_audio"
  | "failed_fetch_audio"
  | "failed_openai_request"
  | "failed_invalid_response"
  | "failed_unexpected";

export interface AudioTranscriptionResult {
  status: AudioTranscriptionStatus;
  text: string | null;
  model: string;
  language: string | null;
  source: AudioSourceKind | null;
  error: string | null;
}

interface TranscribeInboundAudioInput {
  mediaUrl: string | null;
  mimeType?: string | null;
}

interface ResolvedAudioSource {
  blob: Blob;
  mimeType: string;
  source: AudioSourceKind;
}

const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
const DEFAULT_TRANSCRIPTION_TIMEOUT_MS = 20_000;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function getTranscriptionModel(): string {
  return (
    process.env.OPENAI_AUDIO_TRANSCRIPTION_MODEL?.trim() ||
    DEFAULT_TRANSCRIPTION_MODEL
  );
}

function getTranscriptionLanguage(): string | null {
  const language = process.env.OPENAI_AUDIO_TRANSCRIPTION_LANGUAGE?.trim();
  return language ? language : null;
}

function getTranscriptionTimeoutMs(): number {
  const raw = Number(process.env.OPENAI_AUDIO_TRANSCRIPTION_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 2_000 && raw <= 120_000) {
    return Math.floor(raw);
  }
  return DEFAULT_TRANSCRIPTION_TIMEOUT_MS;
}

function getOpenAiBaseUrl(): string {
  return (
    process.env.OPENAI_BASE_URL?.trim().replace(/\/$/, "") ||
    "https://api.openai.com/v1"
  );
}

function mimeTypeToExtension(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("mpeg")) return "mp3";
  if (normalized.includes("mp3")) return "mp3";
  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("mp4")) return "m4a";
  if (normalized.includes("x-m4a")) return "m4a";
  if (normalized.includes("aac")) return "aac";
  return "ogg";
}

function parseDataUrl(dataUrl: string): { mimeType: string; blob: Blob } | null {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;

  const mimeType = match[1] || "audio/ogg";
  const base64Payload = match[2] || "";
  const binary = Buffer.from(base64Payload, "base64");
  const blob = new Blob([binary], { type: mimeType });
  return { mimeType, blob };
}

async function resolveAudioSource(
  mediaUrl: string,
  mimeType: string | null | undefined,
  timeoutMs: number
): Promise<ResolvedAudioSource | null> {
  const fallbackMimeType = mimeType?.trim() || "audio/ogg";

  if (mediaUrl.startsWith("data:")) {
    const parsed = parseDataUrl(mediaUrl);
    if (!parsed) return null;
    return {
      blob: parsed.blob,
      mimeType: parsed.mimeType || fallbackMimeType,
      source: "data_url",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(mediaUrl, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }

    const remoteMimeType =
      response.headers.get("content-type")?.split(";")[0]?.trim() ||
      fallbackMimeType;
    const arrayBuffer = await response.arrayBuffer();
    return {
      blob: new Blob([arrayBuffer], { type: remoteMimeType }),
      mimeType: remoteMimeType,
      source: "remote_url",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function transcribeInboundAudio(
  input: TranscribeInboundAudioInput
): Promise<AudioTranscriptionResult> {
  const model = getTranscriptionModel();
  const language = getTranscriptionLanguage();
  const openAiApiKey = process.env.OPENAI_API_KEY?.trim() || "";
  const timeoutMs = getTranscriptionTimeoutMs();

  if (!openAiApiKey) {
    return {
      status: "skipped_missing_api_key",
      text: null,
      model,
      language,
      source: null,
      error: "OPENAI_API_KEY não configurada",
    };
  }

  if (!input.mediaUrl) {
    return {
      status: "skipped_missing_audio",
      text: null,
      model,
      language,
      source: null,
      error: "Áudio sem URL/base64",
    };
  }

  try {
    const resolvedSource = await resolveAudioSource(
      input.mediaUrl,
      input.mimeType,
      timeoutMs
    );

    if (!resolvedSource) {
      return {
        status: "failed_fetch_audio",
        text: null,
        model,
        language,
        source: null,
        error: "Não foi possível carregar o áudio para transcrição",
      };
    }

    const formData = new FormData();
    const extension = mimeTypeToExtension(resolvedSource.mimeType);
    formData.append("file", resolvedSource.blob, `audio.${extension}`);
    formData.append("model", model);
    if (language) {
      formData.append("language", language);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${getOpenAiBaseUrl()}/audio/transcriptions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openAiApiKey}`,
        },
        body: formData,
        signal: controller.signal,
        cache: "no-store",
      });
    } finally {
      clearTimeout(timeout);
    }

    const payload = (await response.json().catch(() => null)) as
      | { text?: string; error?: { message?: string } }
      | null;

    if (!response.ok) {
      const errorMessage =
        payload?.error?.message ||
        `OpenAI transcription HTTP ${response.status}`;
      return {
        status: "failed_openai_request",
        text: null,
        model,
        language,
        source: resolvedSource.source,
        error: errorMessage,
      };
    }

    const text = normalizeWhitespace(payload?.text ?? "");
    if (!text) {
      return {
        status: "failed_invalid_response",
        text: null,
        model,
        language,
        source: resolvedSource.source,
        error: "Transcrição sem texto",
      };
    }

    return {
      status: "transcribed",
      text,
      model,
      language,
      source: resolvedSource.source,
      error: null,
    };
  } catch (error) {
    return {
      status: "failed_unexpected",
      text: null,
      model,
      language,
      source: null,
      error: String(error),
    };
  }
}
