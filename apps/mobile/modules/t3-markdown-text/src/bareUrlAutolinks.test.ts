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
});
