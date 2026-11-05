import assert from "node:assert/strict";
import test from "node:test";

import { parseJsonc } from "../../scripts/parse-jsonc.mjs";
import { parseJsonc as parseJsoncFromHarness } from "./sync-harness.mjs";

test("the sync harness re-exports the shared parser", () => {
  assert.equal(parseJsoncFromHarness, parseJsonc);
});

const validCases = [
  {
    name: "line and block comments alongside trailing commas",
    input:
      '{\n  // line comment\n  "a": 1, /* block comment */\n  "b": [2, 3,],\n}\n',
    expected: { a: 1, b: [2, 3] },
  },
  {
    name: "literal URLs and comment tokens inside strings",
    input:
      '{"url": "https://example.com/a//b/*c*/d", "text": "// not a comment, /* neither */, ]}"}',
    expected: {
      url: "https://example.com/a//b/*c*/d",
      text: "// not a comment, /* neither */, ]}",
    },
  },
  {
    name: "escaped quotes and backslashes inside strings",
    input: String.raw`{"s": "quote: \" slash: \\ // /* */", "n": 1,}`,
    expected: { s: 'quote: " slash: \\ // /* */', n: 1 },
  },
  {
    name: "unicode escapes without treating them as comment tokens",
    input: String.raw`{"s": "\u002f\u002a"}`,
    expected: { s: "/*" },
  },
  {
    name: "trailing commas before comments and whitespace",
    input: '{"a": [1, /* comment */ ],}',
    expected: { a: [1] },
  },
  {
    name: "commas before closing delimiters inside strings",
    input: '{"s": ",}", "t": ",]"}',
    expected: { s: ",}", t: ",]" },
  },
  {
    name: "a line comment at end of input",
    input: '{"a": 1} // end',
    expected: { a: 1 },
  },
  {
    name: "an unterminated block comment after a complete value",
    input: '{"a": 1} /* end',
    expected: { a: 1 },
  },
  {
    name: "block comments without inserting token separators",
    input: '{"a": 1/* comment */2}',
    expected: { a: 12 },
  },
  {
    name: "top-level values after a line comment",
    input: "// comment\n 1 ",
    expected: 1,
  },
  {
    name: "CRLF line comments",
    input: '{\r\n// comment\r\n"a": 1,\r\n}',
    expected: { a: 1 },
  },
];

for (const { name, input, expected } of validCases) {
  test(`parses ${name}`, () => {
    assert.deepEqual(parseJsonc(input), expected);
  });
}

const malformedCases = [
  { name: "a missing closing brace", input: '{"a": 1' },
  { name: "a double comma", input: "[1,,]" },
  { name: "a trailing comma at end of input", input: '{"a": 1},' },
  { name: "an unterminated string", input: '{"a": "x}' },
  { name: "a bare comment token", input: '{"a": /}' },
  { name: "empty input", input: "" },
];

for (const { name, input } of malformedCases) {
  test(`rejects ${name} with a SyntaxError`, () => {
    assert.throws(() => parseJsonc(input), SyntaxError);
  });
}
