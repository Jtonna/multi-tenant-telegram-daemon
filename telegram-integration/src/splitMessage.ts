/**
 * Telegram's maximum message length is 4096 characters.
 * This utility splits long messages at newline boundaries when possible,
 * falling back to hard splits at maxLength when no newlines are available.
 */

const TELEGRAM_MAX_LENGTH = 4096;

/**
 * Splits a message into chunks that fit within Telegram's message size limit.
 *
 * Strategy:
 * 1. If the message fits in one chunk, return it as-is.
 * 2. Otherwise, try to split at the last newline before maxLength.
 * 3. If no newline is found, hard-split at maxLength.
 *
 * @param text - The text to split
 * @param maxLength - Maximum length per chunk (default: 4096)
 * @returns Array of message chunks
 */
export function splitMessage(
  text: string,
  maxLength: number = TELEGRAM_MAX_LENGTH
): string[] {
  if (text.length === 0) {
    return [""];
  }

  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Use Array.from to count code points, not UTF-16 code units.
    // This prevents splitting inside surrogate pairs (emoji).
    const codePoints = Array.from(remaining);

    if (codePoints.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Build the window from code points to avoid splitting surrogate pairs
    const window = codePoints.slice(0, maxLength).join("");
    const lastNewline = window.lastIndexOf("\n");

    let splitAt: number;
    if (lastNewline > 0) {
      // Split at the newline (include the newline in the current chunk)
      chunks.push(window.slice(0, lastNewline + 1));
      remaining = remaining.slice(lastNewline + 1);
    } else {
      // No newline found — hard split at maxLength code points
      chunks.push(window);
      remaining = remaining.slice(window.length);
    }
  }

  return chunks;
}
