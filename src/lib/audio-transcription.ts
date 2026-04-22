import { GoogleGenerativeAI } from "@google/generative-ai";

type AudioSourceKind = "data_url" | "remote_url";

type AudioTranscriptionStatus =
  | "transcribed"
  | "skipped_missing_api_key"
  | "skipped_missing_audio"
  | "failed_fetch_audio"
  | "failed_gemini_request"
  | "failed_invalid_response"
  | "failed_timeout"
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
  apiKeyOverride?: string | null;
  modelOverride?: string | null;
  languageOverride?: string | null;
}

interface ResolvedAudioSource {
  base64: string;
  mimeType: string;
  source: AudioSourceKind;
}

const DEFAULT_TRANSCRIPTION_MODEL = "gemini-2.0-flash";
const DEFAULT_TRANSCRIPTION_TIMEOUT_MS = 20_000;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function getTranscriptionModel(modelOverride?: string | null): string {
  return (
    modelOverride?.trim() ||
    process.env.GEMINI_AUDIO_TRANSCRIPTION_MODEL?.trim() ||
    DEFAULT_TRANSCRIPTION_MODEL
  );
}

function getTranscriptionLanguage(languageOverride?: string | null): string | null {
  const language =
    languageOverride?.trim() ||
    process.env.GEMINI_AUDIO_TRANSCRIPTION_LANGUAGE?.trim();
  return language ? language : null;
}

function getTranscriptionTimeoutMs(): number {
  const raw = Number(process.env.GEMINI_AUDIO_TRANSCRIPTION_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 2_000 && raw <= 120_000) {
    return Math.floor(raw);
  }
  return DEFAULT_TRANSCRIPTION_TIMEOUT_MS;
}

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  return {
    mimeType: match[1] || "audio/ogg",
    base64: match[2] || "",
  };
}

async function resolveAudioSource(
  mediaUrl: string,
  mimeType: string | null | undefined,
  timeoutMs: number
): Promise<ResolvedAudioSource | null> {
  const fallbackMimeType = mimeType?.trim() || "audio/ogg";

  if (mediaUrl.startsWith("data:")) {
    const parsed = parseDataUrl(mediaUrl);
    if (!parsed || !parsed.base64) return null;
    return {
      base64: parsed.base64,
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
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    if (!base64) return null;

    return {
      base64,
      mimeType: remoteMimeType,
      source: "remote_url",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | null = null;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error("Gemini transcription timeout"));
      }, timeoutMs);
    });
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

export async function transcribeInboundAudio(
  input: TranscribeInboundAudioInput
): Promise<AudioTranscriptionResult> {
  const model = getTranscriptionModel(input.modelOverride);
  const language = getTranscriptionLanguage(input.languageOverride);
  const apiKey =
    input.apiKeyOverride?.trim() || process.env.GEMINI_API_KEY?.trim() || "";
  const timeoutMs = getTranscriptionTimeoutMs();

  if (!apiKey) {
    return {
      status: "skipped_missing_api_key",
      text: null,
      model,
      language,
      source: null,
      error: "GEMINI_API_KEY não configurada",
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

    const genAI = new GoogleGenerativeAI(apiKey);
    const transcriptionModel = genAI.getGenerativeModel({ model });
    const languageInstruction = language
      ? `Responda no idioma ${language}.`
      : "Responda no mesmo idioma do áudio.";
    const prompt =
      "Transcreva o áudio de forma literal. Retorne somente a transcrição, sem explicações, sem formatação e sem prefixos. " +
      languageInstruction;

    const result = await withTimeout(
      transcriptionModel.generateContent({
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: resolvedSource.mimeType,
                  data: resolvedSource.base64,
                },
              },
            ],
          },
        ],
      }),
      timeoutMs
    );

    const text = normalizeWhitespace(result.response.text() ?? "");
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
    const message = String(error);
    if (message.toLowerCase().includes("timeout")) {
      return {
        status: "failed_timeout",
        text: null,
        model,
        language,
        source: null,
        error: message,
      };
    }

    if (
      message.toLowerCase().includes("api key") ||
      message.toLowerCase().includes("permission") ||
      message.toLowerCase().includes("quota")
    ) {
      return {
        status: "failed_gemini_request",
        text: null,
        model,
        language,
        source: null,
        error: message,
      };
    }

    return {
      status: "failed_unexpected",
      text: null,
      model,
      language,
      source: null,
      error: message,
    };
  }
}
