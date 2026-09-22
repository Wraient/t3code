/**
 * Why this exists: the native parser behind SelectableMarkdownText
 * (react-native-nitro-markdown, a Nitro wrapper around MD4C) detects bare URLs
 * with MD4C's permissive-autolink scanner, which only accepts `/ . - _` inside
 * URL paths and requires every other non-alphanumeric to sit between
 * alphanumerics. A bare URL such as
 * `https://github.com/google/ax/compare/main...Wraient:patch-1?expand=1`
 * therefore links only up to `/compare/main` on mobile, while web/desktop
 * (remark-gfm) links it whole.
 *
 * Explicit `<url>` autolinks are core markdown and accept everything up to
 * whitespace, so rewriting bare URLs into that form before parsing closes the
 * gap without touching the vendored native parser. Rendering is unchanged:
 * an explicit autolink displays the URL itself, exactly like a bare autolink.
 */

// Code spans ride along untouched so `` `https://...` `` keeps rendering as
// code instead of gaining visible angle brackets.
const PROSE_OR_CODE_PATTERN = /(`+[^`]*?`+)|(https?:\/\/[^\s<>\]`"'*]+)/g;
const FENCE_PATTERN = /^\s*(`{3,}|~{3,})/;
// Trailing punctuation stripped from GFM autolinks; anything past it stays
// plain text so parity with web holds (e.g. the `.` in "see https://x/y.").
const TRAILING_PUNCTUATION_PATTERN = /[?!.,:*_~]+$/u;

/** True when `index` sits inside an unclosed `<...>` on the line: an existing
 * autolink (`<https://...>`) or an HTML tag (`<a href="...">`). */
function isInsideAngleSegment(text: string, index: number): boolean {
  return /<[^<>]*$/.test(text.slice(0, index));
}

/** Drop GFM trailing punctuation and unbalanced `)` from a matched URL. */
function trimTrailingPunctuation(url: string): { url: string; tail: string } {
  const withoutPunct = url.replace(TRAILING_PUNCTUATION_PATTERN, "");
  let open = 0;
  for (const char of withoutPunct) {
    if (char === "(") open += 1;
    else if (char === ")") open -= 1;
  }
  let end = withoutPunct.length;
  while (end > 0 && withoutPunct[end - 1] === ")" && open < 0) {
    open += 1;
    end -= 1;
  }
  return { url: withoutPunct.slice(0, end), tail: url.slice(end) };
}

function wrapBareUrlsInProse(prose: string): string {
  return prose.replace(
    PROSE_OR_CODE_PATTERN,
    (
      match: string,
      code: string | undefined,
      url: string | undefined,
      offset: number,
      whole: string,
    ) => {
      if (code !== undefined || url === undefined) return match;
      if (isInsideAngleSegment(whole, offset)) return match;
      const { url: trimmed, tail } = trimTrailingPunctuation(url);
      if (trimmed.endsWith("://")) return match;
      return `<${trimmed}>${tail}`;
    },
  );
}

/**
 * Rewrite bare `http(s)://` URLs as explicit `<url>` autolinks so the native
 * parser links them whole. Leaves fenced code blocks, inline code spans, and
 * existing `<...>` segments untouched.
 */
export function wrapBareUrlsForNativeParser(markdown: string): string {
  let inFence = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (FENCE_PATTERN.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return wrapBareUrlsInProse(line);
    })
    .join("\n");
}
