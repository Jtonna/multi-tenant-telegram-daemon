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

    // Try to find the last newline within the maxLength window
    const window = remaining.slice(0, maxLength);
    const lastNewline = window.lastIndexOf("\n");

    let splitAt: number;
    if (lastNewline > 0) {
      // Split at the newline (include the newline in the current chunk)
      splitAt = lastNewline + 1;
    } else {
      // No newline found — hard split at maxLength
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  return chunks;
}
