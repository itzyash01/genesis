import { Script } from "node:vm";

/** Repair a model response that JSON-encoded the complete file content twice. */
export function normalizeGeneratedContent(path: string, content: string): string {
  if (!/\.(html|css|js)$/i.test(path) || /[\r\n]/.test(content) ||
      (content.match(/\\n/g)?.length ?? 0) < 3) return content;
  if (/\.js$/i.test(path) && !/^\s*\/\//.test(content)) {
    try {
      new Script(content, { filename: path });
      return content; // A valid single-line JS file may intentionally contain escaped newlines.
    } catch { /* Invalid original code may be a double-encoded file. */ }
  }
  let decoded: unknown;
  try {
    // Escape only unescaped quote delimiters before decoding the extra JSON layer.
    const encoded = content.replace(/\\*"/g, (match) =>
      (match.length - 1) % 2 === 0 ? match.slice(0, -1) + '\\"' : match,
    );
    decoded = JSON.parse('"' + encoded + '"');
  } catch {
    throw new Error("Generated file contains invalid escaped content.");
  }
  if (typeof decoded !== "string" || !decoded.includes("\n")) {
    throw new Error("Generated file contains invalid escaped content.");
  }
  if (/\.js$/i.test(path)) {
    try {
      new Script(decoded, { filename: path });
    } catch {
      throw new Error("Generated JavaScript could not be safely decoded.");
    }
  }
  return decoded;
}
