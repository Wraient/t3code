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

  it("tracks fence character and length, including quoted fences", () => {
    const input = "````\n```\nhttps://example.com/a...b:c\n```\n````";
    expect(wrapBareUrlsForNativeParser(input)).toBe(input);
    const quoted = "> ```\n> https://example.com/a...b:c\n> ```";
    expect(wrapBareUrlsForNativeParser(quoted)).toBe(quoted);
    const tilde = "~~~\nhttps://example.com/a...b:c\n~~~";
    expect(wrapBareUrlsForNativeParser(tilde)).toBe(tilde);
  });

  it("leaves raw HTML blocks alone", () => {
    const pre = "<pre>\nhttps://example.com/a...b:c\n</pre>";
    expect(wrapBareUrlsForNativeParser(pre)).toBe(pre);
    const div = "<div>\nhttps://example.com/a...b:c\n</div>";
    expect(wrapBareUrlsForNativeParser(div)).toBe(div);
    const comment = "<!--\nhttps://example.com/a...b:c\n-->";
    expect(wrapBareUrlsForNativeParser(comment)).toBe(comment);
    expect(wrapBareUrlsForNativeParser("<div>https://example.com/a...b:c</div>")).toBe(
      "<div>https://example.com/a...b:c</div>",
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
