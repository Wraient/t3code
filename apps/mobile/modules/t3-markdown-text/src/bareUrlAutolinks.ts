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
 * The rewrite errs toward leaving text alone: fenced code blocks, indented
 * code blocks, inline code spans, `<...>` segments, and link labels pass
 * through, so at worst a URL keeps the old truncated behavior instead of
 * rendering wrong. (Deliberately no HTML block tracking: the native parser
 * sets MD_FLAG_NOHTML, so raw HTML blocks are never formed — tag lines are
 * plain paragraph text and URLs after them must wrap. Verified against the
 * vendored md4c.c.)
 */

// Bare URLs. Inline code spans are split out beforehand by splitProseAndCode,
// which understands multi-backtick delimiters, so this never sees code text.
const BARE_URL_PATTERN = /https?:\/\/[^\s<>\]`"'*]+/g;
// Optional blockquote/list prefix, then the fence run and the rest of the line.
const FENCE_LINE_PATTERN =
  /^((?:\s{0,3}>\s?)*(?:\s{0,3}(?:[-*+]|\d{1,9}[.)])\s+)?\s{0,3})(`{3,}|~{3,})(.*)$/;
const INDENTED_CODE_PATTERN = /^(?:\s{0,3}>\s?)*(?: {4}|\t)/;
// Trailing punctuation stripped from GFM autolinks; anything past it stays
// plain text so parity with web holds (e.g. the `.` in "see https://x/y.").
const TRAILING_PUNCTUATION_PATTERN = /[?!.,:*_~]+$/u;

/**
 * True when the match at `offset` sits inside an unclosed `<...>` on the
 * line: an existing autolink (`<https://...>`) or an HTML tag
 * (`<a href="...">`). A stray `<` from prose (`value < limit`) is not a
 * segment, so URLs after one are still wrapped.
 */
function isInsideAngleSegment(whole: string, offset: number): boolean {
  const open = whole.slice(0, offset).match(/<[^<>\n]*$/);
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

type ProsePart = { code: boolean; text: string };

/**
 * Split prose into code spans and the text between them. A span opens with a
 * maximal backtick run and closes at the next maximal run of the same length,
 * so shorter runs inside (`` ``foo ` bar`` ``) stay code; a blank line between
 * the runs means no span, mirroring CommonMark.
 */
function splitProseAndCode(prose: string): ProsePart[] {
  const runs: Array<{ start: number; length: number }> = [];
  const runPattern = /`+/g;
  let runMatch: RegExpExecArray | null;
  while ((runMatch = runPattern.exec(prose)) !== null) {
    runs.push({ start: runMatch.index, length: runMatch[0].length });
  }

  const parts: ProsePart[] = [];
  let pos = 0;
  let i = 0;
  const pushProse = (end: number) => {
    if (end > pos) parts.push({ code: false, text: prose.slice(pos, end) });
    pos = end;
  };
  while (i < runs.length) {
    const opener = runs[i];
    if (!opener) break;
    let closer = -1;
    for (let j = i + 1; j < runs.length; j += 1) {
      const candidate = runs[j];
      if (!candidate) break;
      if (candidate.length !== opener.length) continue;
      if (/\n[ \t]*\n/.test(prose.slice(opener.start + opener.length, candidate.start))) break;
      closer = j;
      break;
    }
    if (closer === -1) {
      i += 1;
      continue;
    }
    const closerRun = runs[closer];
    if (!closerRun) break;
    pushProse(opener.start);
    parts.push({
      code: true,
      text: prose.slice(opener.start, closerRun.start + closerRun.length),
    });
    pos = closerRun.start + closerRun.length;
    i = closer + 1;
  }
  pushProse(prose.length);
  return parts;
}

function wrapBareUrlsInProse(prose: string): string {
  return splitProseAndCode(prose)
    .map((part) => {
      if (part.code) return part.text;
      return part.text.replace(BARE_URL_PATTERN, (match: string, offset: number, whole: string) => {
        if (isInsideAngleSegment(whole, offset)) return match;
        if (isInsideLinkLabel(whole, offset, match.length)) return match;
        const { url: trimmed, tail } = trimTrailingPunctuation(match);
        if (trimmed.endsWith("://")) return match;
        return `<${trimmed}>${tail}`;
      });
    })
    .join("");
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

/**
 * Rewrite bare `http(s)://` URLs as explicit `<url>` autolinks so the native
 * parser links them whole. Fenced code, indented code, inline code spans,
 * `<...>` segments, and link labels pass through.
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
    } else if (fenceMatch) {
      flushProse();
      out.push(line);
      fence = { char: fenceMatch.char, length: fenceMatch.length };
    } else if (!blank && INDENTED_CODE_PATTERN.test(line) && (prevBlank || inIndented)) {
      flushProse();
      out.push(line);
      inIndented = true;
    } else {
      if (blank) inIndented = false;
      prose.push(line);
    }
    prevBlank = blank;
  }
  flushProse();
  return out.join("\n");
}
