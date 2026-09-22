import { describe, expect, it } from "vite-plus/test";

import { wrapBareUrlsForNativeParser } from "./bareUrlAutolinks";

describe("wrapBareUrlsForNativeParser", () => {
  it("wraps the full compare URL that MD4C truncates at `...`", () => {
    const url = "https://github.com/google/ax/compare/main...Wraient:patch-1?expand=1";
    expect(wrapBareUrlsForNativeParser(`see ${url} thanks`)).toBe(`see <${url}> thanks`);
  });

  it("wraps plain bare URLs", () => {
    expect(wrapBareUrlsForNativeParser("see https://example.com/a/b?c=1 nice")).toBe(
      "see <https://example.com/a/b?c=1> nice",
    );
  });

  it("keeps GFM trailing punctuation outside the brackets", () => {
    expect(wrapBareUrlsForNativeParser("see https://example.com/a.")).toBe(
      "see <https://example.com/a>.",
    );
    expect(wrapBareUrlsForNativeParser("see (https://example.com/a), ok")).toBe(
      "see (<https://example.com/a>), ok",
    );
    expect(wrapBareUrlsForNativeParser("see https://example.com/a?")).toBe(
      "see <https://example.com/a>?",
    );
  });

  it("keeps balanced parens but drops unbalanced ones", () => {
    expect(wrapBareUrlsForNativeParser("(see https://en.wikipedia.org/wiki/Link_(film))")).toBe(
      "(see <https://en.wikipedia.org/wiki/Link_(film)>)",
    );
  });

  it("leaves fenced code blocks alone", () => {
    const input = "```\nhttps://example.com/a...b:c?d=1\n```";
    expect(wrapBareUrlsForNativeParser(input)).toBe(input);
  });

  it("leaves inline code spans alone", () => {
    expect(wrapBareUrlsForNativeParser("run `https://example.com/a...b:c?d=1` now")).toBe(
      "run `https://example.com/a...b:c?d=1` now",
    );
  });

  it("leaves existing autolinks and HTML tags alone", () => {
    expect(wrapBareUrlsForNativeParser("see <https://example.com/a...b:c?d=1> ok")).toBe(
      "see <https://example.com/a...b:c?d=1> ok",
    );
    expect(wrapBareUrlsForNativeParser('<a href="https://example.com/a...b:c?d=1">x</a>')).toBe(
      '<a href="https://example.com/a...b:c?d=1">x</a>',
    );
  });

  it("wraps link destinations, which stays valid markdown", () => {
    expect(wrapBareUrlsForNativeParser("[pr](https://example.com/a...b:c?d=1)")).toBe(
      "[pr](<https://example.com/a...b:c?d=1>)",
    );
  });

  it("leaves text without URLs, emails, and bare schemes alone", () => {
    expect(wrapBareUrlsForNativeParser("no links here")).toBe("no links here");
    expect(wrapBareUrlsForNativeParser("mail me@example.com")).toBe("mail me@example.com");
    expect(wrapBareUrlsForNativeParser("see https:// ok")).toBe("see https:// ok");
  });

  it("leaves multiline inline code spans alone", () => {
    const input = "`first\nhttps://example.com/a...b:c\nlast`";
    expect(wrapBareUrlsForNativeParser(input)).toBe(input);
  });

  it("leaves shorter backtick runs inside multi-backtick spans alone", () => {
    const input = "``foo ` https://example.com/a...b:c ``";
    expect(wrapBareUrlsForNativeParser(input)).toBe(input);
  });

  it("wraps URLs after non-block HTML text, which stays paragraph text", () => {
    // `<table><tr><td>` does not satisfy the CommonMark type-6 start
    // condition (no whitespace/EOL/`>` after the tag name), so the URL after
    // it is linkable prose.
    expect(wrapBareUrlsForNativeParser("<table><tr><td>\nhttps://example.com/a")).toBe(
      "<table><tr><td>\n<https://example.com/a>",
    );
    expect(wrapBareUrlsForNativeParser("<div> foo\nhttps://example.com/a")).toBe(
      "<div> foo\n<https://example.com/a>",
    );
  });

  it("tracks fence character and length, including quoted fences", () => {
    const input = "````\n```\nhttps://example.com/a...b:c\n```\n````";
    expect(wrapBareUrlsForNativeParser(input)).toBe(input);
    const quoted = "> ```\n> https://example.com/a...b:c\n> ```";
    expect(wrapBareUrlsForNativeParser(quoted)).toBe(quoted);
    const tilde = "~~~\nhttps://example.com/a...b:c\n~~~";
    expect(wrapBareUrlsForNativeParser(tilde)).toBe(tilde);
  });

  it("wraps URLs around tag lines, which the parser treats as plain text", () => {
    // The native parser sets MD_FLAG_NOHTML, so raw HTML blocks are never
    // formed: tag lines are paragraph text and a URL after them must wrap
    // (verified against the vendored md4c.c: truncated LINK either way).
    expect(wrapBareUrlsForNativeParser("<pre>\nhttps://example.com/a")).toBe(
      "<pre>\n<https://example.com/a>",
    );
    expect(wrapBareUrlsForNativeParser("<div>\nhttps://example.com/a\n</div>")).toBe(
      "<div>\n<https://example.com/a>\n</div>",
    );
    expect(wrapBareUrlsForNativeParser("<!--\nhttps://example.com/a\n-->")).toBe(
      "<!--\n<https://example.com/a>\n-->",
    );
    expect(wrapBareUrlsForNativeParser("<table><tr><td>\nhttps://example.com/a")).toBe(
      "<table><tr><td>\n<https://example.com/a>",
    );
    expect(wrapBareUrlsForNativeParser("<div> foo\nhttps://example.com/a")).toBe(
      "<div> foo\n<https://example.com/a>",
    );
  });

  it("leaves indented code blocks alone but still wraps nearby prose", () => {
    const input = "see https://example.com/ok\n\n    https://example.com/a...b:c";
    expect(wrapBareUrlsForNativeParser(input)).toBe(
      "see <https://example.com/ok>\n\n    https://example.com/a...b:c",
    );
  });

  it("wraps URLs after a prose `<` comparison", () => {
    expect(wrapBareUrlsForNativeParser("value < limit; see https://example.com/a...b:c")).toBe(
      "value < limit; see <https://example.com/a...b:c>",
    );
  });

  it("leaves URLs inside link labels alone", () => {
    // Label stays bare (no nested autolink); the destination is still wrapped,
    // which stays valid markdown.
    expect(
      wrapBareUrlsForNativeParser("[https://example.com/a...b:c](https://destination.example/x)"),
    ).toBe("[https://example.com/a...b:c](<https://destination.example/x>)");
    expect(wrapBareUrlsForNativeParser("[see https://example.com/a] plain")).toBe(
      "[see <https://example.com/a>] plain",
    );
  });
});
