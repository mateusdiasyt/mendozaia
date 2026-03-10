const WORD_PATTERN = /[A-Za-zÀ-ÖØ-öø-ÿ]+/g;

function toTitleCaseToken(token: string): string {
  return token.replace(
    WORD_PATTERN,
    (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  );
}

export function normalizeContactName(
  value: string | null | undefined
): string | null {
  const trimmed = (value ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed
    .split(" ")
    .map((token) => toTitleCaseToken(token))
    .join(" ");
}
