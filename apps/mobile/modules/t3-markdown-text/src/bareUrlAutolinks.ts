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
 *
 * The rewrite errs toward leaving text alone: anything that looks like a
 * fenced code block, an indented code block, a raw HTML block, an inline code
 * span, an existing `<...>` segment, or a link label is passed through, so at
 * worst a URL keeps the old truncated behavior instead of rendering wrong.
 */

// Code spans ride along untouched (may cross soft line breaks, but never a
// blank line, mirroring CommonMark) so `` `https://...` `` keeps rendering as
// code instead of gaining visible angle brackets.
const PROSE_OR_CODE_PATTERN =
  /((?<tick>`+)(?:[^`\n]|\n(?!\n))*?(?<!`)\k<tick>(?!`))|(https?:\/\/[^\s<>\]`"'*]+)/g;
// Optional blockquote/list prefix, then the fence run and the rest of the line.
const FENCE_LINE_PATTERN =
  /^((?:\s{0,3}>\s?)*(?:\s{0,3}(?:[-*+]|\d{1,9}[.)])\s+)?\s{0,3})(`{3,}|~{3,})(.*)$/;
const INDENTED_CODE_PATTERN = /^(?:\s{0,3}>\s?)*(?: {4}|\t)/;
// Trailing punctuation stripped from GFM autolinks; anything past it stays
// plain text so parity with web holds (e.g. the `.` in "see https://x/y.").
const TRAILING_PUNCTUATION_PATTERN = /[?!.,:*_~]+$/u;
// A line opening with tag/autolink syntax passes through untouched: it is
// either already linked (`<https://...>`) or inline HTML whose destinations
// must not be rewritten (`<div>https://...</div>`).
const INLINE_HTML_LINE_PATTERN = /^\s{0,3}<(?:\/?[A-Za-z]|!|\?)/;

/**
 * True when the match at `offset` sits inside an unclosed `<...>` on the
 * line: an existing autolink (`<https://...>`) or an HTML tag
 * (`<a href="...">`). A stray `<` from prose (`value < limit`) is not a
 * segment, so URLs after one are still wrapped.
 */
function isInsideAngleSegment(whole: string, offset: number): boolean {
  const open = whole.slice(0, offset).match(/<[^<>]*$/);
  if (!open) return false;
  return /^<(\/?[A-Za-z]|!|\?)/.test(open[0] + whole[offset]);
}

/**
 * True when the match at `offset` sits inside a link label, where wrapping
 * would nest an autolink inside the outer link (`[https://...](dest)`).
 * Plain bracketed text (`[see https://...]`) still gets wrapped.
 */
function isInsideLinkLabel(whole: string, offset: number, matchLength: number): boolean {
  return (
    /\[[^[\]\n]*$/.test(whole.slice(0, offset)) &&
    /^[^[\]\n]*\](\(|\[)/.test(whole.slice(offset + matchLength))
  );
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
      _tick: string | undefined,
      url: string | undefined,
      offset: number,
      whole: string,
    ) => {
      if (code !== undefined || url === undefined) return match;
      if (isInsideAngleSegment(whole, offset)) return match;
      if (isInsideLinkLabel(whole, offset, match.length)) return match;
      const { url: trimmed, tail } = trimTrailingPunctuation(url);
      if (trimmed.endsWith("://")) return match;
      return `<${trimmed}>${tail}`;
    },
  );
}

type Fence = { char: string; length: number };

function matchFence(line: string): { char: string; length: number; info: string } | null {
  const match = line.match(FENCE_LINE_PATTERN);
  const run = match?.[2] ?? "";
  if (run.length < 3) return null;
  const info = match?.[3] ?? "";
  // A backtick info string means this was never a fence (e.g. ```a`b).
  if (run.charAt(0) === "`" && info.includes("`")) return null;
  return { char: run.charAt(0), length: run.length, info };
}

/** End marker for a raw HTML block starting on `line`, or blank-line mode. */
function matchHtmlBlockStart(line: string): { marker: string } | { blank: true } | null {
  const trimmed = line.replace(/^\s{0,3}/, "");
  if (trimmed.startsWith("<!--")) {
    return trimmed.includes("-->") ? null : { marker: "-->" };
  }
  if (trimmed.startsWith("<?")) {
    return trimmed.includes("?>") ? null : { marker: "?>" };
  }
  if (/^<!\[CDATA\[/i.test(trimmed)) {
    return trimmed.includes("]]>") ? null : { marker: "]]>" };
  }
  const preformatted = trimmed.match(/^<\/?(pre|script|style|textarea)(?=[\s>/])/i);
  if (preformatted) {
    const tag = preformatted[1]?.toLowerCase() ?? "";
    const close = `</${tag}>`;
    // A self-contained line (`<pre>x</pre>`) protects just itself.
    return trimmed.toLowerCase().includes(close, preformatted[0].length) ? null : { marker: close };
  }
  // Any other tag-looking line starts an HTML block until a blank line.
  return /^<\/?[A-Za-z][^<>]*>\s*$/.test(trimmed) ? { blank: true } : null;
}

/**
 * Rewrite bare `http(s)://` URLs as explicit `<url>` autolinks so the native
 * parser links them whole. Fenced code, indented code, raw HTML blocks,
 * inline code spans, existing `<...>` segments, and link labels pass through.
 */
export function wrapBareUrlsForNativeParser(markdown: string): string {
  const out: string[] = [];
  const prose: string[] = [];
  const flushProse = () => {
    if (prose.length > 0) {
      out.push(wrapBareUrlsInProse(prose.join("\n")));
      prose.length = 0;
    }
  };

  let fence: Fence | null = null;
  let htmlEnd: { marker: string } | { blank: true } | null = null;
  let inIndented = false;
  let prevBlank = true;

  for (const line of markdown.split("\n")) {
    const blank = line.trim() === "";
    const fenceMatch = matchFence(line);

    if (fence) {
      flushProse();
      out.push(line);
      if (
        fenceMatch &&
        fenceMatch.char === fence.char &&
        fenceMatch.length >= fence.length &&
        fenceMatch.info.trim() === ""
      ) {
        fence = null;
      }
    } else if (htmlEnd) {
      flushProse();
      out.push(line);
      if ("marker" in htmlEnd ? line.toLowerCase().includes(htmlEnd.marker) : blank) {
        htmlEnd = null;
      }
    } else if (fenceMatch) {
      flushProse();
      out.push(line);
      fence = { char: fenceMatch.char, length: fenceMatch.length };
    } else if (!blank && INDENTED_CODE_PATTERN.test(line) && (prevBlank || inIndented)) {
      flushProse();
      out.push(line);
      inIndented = true;
    } else {
      const htmlStart = !blank ? matchHtmlBlockStart(line) : null;
      if (htmlStart) {
        flushProse();
        out.push(line);
        htmlEnd = htmlStart;
      } else if (!blank && INLINE_HTML_LINE_PATTERN.test(line)) {
        flushProse();
        out.push(line);
      } else {
        if (blank) inIndented = false;
        prose.push(line);
      }
    }
    prevBlank = blank;
  }
  flushProse();
  return out.join("\n");
}
