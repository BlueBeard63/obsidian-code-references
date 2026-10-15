import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockAtLine,
  checkTarget,
  blocksById,
  findCodeBlocks,
  findRefs,
  findRefsInLine,
  formatLabel,
  formatRef,
  formatTarget,
  githubUrl,
  insertIdIntoFence,
  parseFenceInfo,
  parseRange,
  parseRefTarget,
  parseSource,
  rangeForSelection,
  slugify,
  suggestId,
  validateNote,
} from "../src/parse.ts";

const NOTE = [
  "# Seal", // 0
  "", // 1
  '```go title="internal/secrets/seal.go" id="seal" source="BlueBeard63/Marlin@v0.7.0:internal/secrets/seal.go"', // 2
  "package secrets", // 3  -> line 1
  "", // 4
  "func Seal() {", // 5
  "\tnonce := make([]byte, 12)", // 6
  "}", // 7  -> line 5
  "```", // 8
  "", // 9
  "See [the nonce](#seal:4) and [the func](#seal:3-5).", // 10
  "Broken: [x](#nope:1) and [y](#seal:4-9) and `[z](#nope:2)`.", // 11
  "```md", // 12
  "[inside](#seal:1)", // 13
  "```", // 14
].join("\n");

test("parseFenceInfo: language then attributes in any order", () => {
  assert.deepEqual(parseFenceInfo('go title="a b.go" id="seal" source="o/r@v1:p.go"'), {
    lang: "go",
    attrs: { title: "a b.go", id: "seal", source: "o/r@v1:p.go" },
  });
  assert.deepEqual(parseFenceInfo("ts id='x' title=plain"), {
    lang: "ts",
    attrs: { id: "x", title: "plain" },
  });
  assert.deepEqual(parseFenceInfo('id="only"'), { lang: "", attrs: { id: "only" } });
  assert.deepEqual(parseFenceInfo(""), { lang: "", attrs: {} });
  assert.deepEqual(parseFenceInfo("python"), { lang: "python", attrs: {} });
});

test("parseRefTarget", () => {
  assert.deepEqual(parseRefTarget("#seal:11-14"), { id: "seal", start: 11, end: 14 });
  assert.deepEqual(parseRefTarget("#seal:7"), { id: "seal", start: 7, end: 7 });
  assert.deepEqual(parseRefTarget("seal:7"), { id: "seal", start: 7, end: 7 });
  assert.deepEqual(parseRefTarget("#my-id_2.x:1-2"), { id: "my-id_2.x", start: 1, end: 2 });
  assert.deepEqual(parseRefTarget("#seal%3A3-4"), { id: "seal", start: 3, end: 4 });
  assert.deepEqual(parseRefTarget("app://obsidian.md/Note#seal:3"), { id: "seal", start: 3, end: 3 });
  assert.equal(parseRefTarget("#heading"), null);
  assert.equal(parseRefTarget("#seal:"), null);
  assert.equal(parseRefTarget("#seal:a-b"), null);
  assert.equal(parseRefTarget(null), null);
});

test("format helpers use plain hyphens", () => {
  assert.equal(formatLabel(11, 14), "L11-14");
  assert.equal(formatLabel(7, 7), "L7");
  assert.equal(formatTarget("seal", 11, 14), "#seal:11-14");
  assert.equal(formatTarget("seal", 7, 7), "#seal:7");
  assert.equal(formatRef("", "seal", 1, 2), "[](#seal:1-2)");
});

test("parseRange", () => {
  assert.deepEqual(parseRange("1-12"), { start: 1, end: 12 });
  assert.deepEqual(parseRange(" 3 - 9 "), { start: 3, end: 9 });
  assert.deepEqual(parseRange("7"), { start: 7, end: 7 });
  assert.equal(parseRange("a"), null);
  assert.equal(parseRange("1-"), null);
});

test("parseSource and githubUrl", () => {
  assert.deepEqual(parseSource("BlueBeard63/Marlin@v0.7.0:internal/secrets/seal.go"), {
    owner: "BlueBeard63",
    repo: "Marlin",
    ref: "v0.7.0",
    path: "internal/secrets/seal.go",
  });
  assert.equal(parseSource("not a source"), null);
  assert.equal(
    githubUrl("o/r@main:a/b.go"),
    "https://github.com/o/r/blob/main/a/b.go",
  );
  assert.equal(githubUrl("o/r@main:a/b.go", 11, 14), "https://github.com/o/r/blob/main/a/b.go#L11-L14");
  assert.equal(githubUrl("o/r@main:a/b.go", 7), "https://github.com/o/r/blob/main/a/b.go#L7");
  assert.equal(githubUrl(undefined), null);
});

test("findCodeBlocks", () => {
  const blocks = findCodeBlocks(NOTE);
  assert.equal(blocks.length, 2);
  const [seal, md] = blocks;
  assert.equal(seal!.id, "seal");
  assert.equal(seal!.lang, "go");
  assert.equal(seal!.title, "internal/secrets/seal.go");
  assert.equal(seal!.openLine, 2);
  assert.equal(seal!.closeLine, 8);
  assert.equal(seal!.lineCount, 5);
  assert.equal(seal!.closed, true);
  assert.equal(seal!.content.split("\n")[0], "package secrets");
  assert.equal(md!.id, undefined);
  assert.equal(md!.lineCount, 1);
});

test("findCodeBlocks: tildes, longer fences, unclosed, callouts", () => {
  const text = ["~~~~ js id=\"a\"", "```", "x", "~~~~", "> [!note]", "> ```go id=\"q\"", "> one", "> two", "> ```", "```", "open"].join("\n");
  const blocks = findCodeBlocks(text);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0]!.id, "a");
  assert.equal(blocks[0]!.lineCount, 2);
  assert.equal(blocks[1]!.id, "q");
  assert.equal(blocks[1]!.content, "one\ntwo");
  assert.equal(blocks[2]!.closed, false);
  assert.equal(blocks[2]!.lineCount, 1);
});

test("findRefs skips code blocks, inline code and images", () => {
  const refs = findRefs(NOTE);
  assert.deepEqual(
    refs.map((r) => [r.id, r.start, r.end, r.label, r.line]),
    [
      ["seal", 4, 4, "the nonce", 10],
      ["seal", 3, 5, "the func", 10],
      ["nope", 1, 1, "x", 11],
      ["seal", 4, 9, "y", 11],
    ],
  );
  const [r] = findRefsInLine("a [lbl](#s:1-2) b");
  assert.equal(r!.from, 2);
  assert.equal(r!.to, 15);
  assert.equal(r!.labelFrom, 3);
  assert.equal(r!.labelTo, 6);
  assert.equal(findRefsInLine("![img](#s:1)").length, 0);
});

test("checkTarget and validateNote", () => {
  const byId = blocksById(findCodeBlocks(NOTE));
  assert.equal(checkTarget({ id: "seal", start: 1, end: 5 }, byId), null);
  assert.match(checkTarget({ id: "nope", start: 1, end: 1 }, byId)!, /No code block/);
  assert.match(checkTarget({ id: "seal", start: 4, end: 9 }, byId)!, /has 5 lines/);
  assert.match(checkTarget({ id: "seal", start: 0, end: 1 }, byId)!, /start at 1/);
  assert.match(checkTarget({ id: "seal", start: 3, end: 2 }, byId)!, /reversed/);

  const problems = validateNote(NOTE + '\n```go id="seal"\nx\n```');
  assert.equal(problems.length, 3);
  assert.match(problems[0]!.message, /#nope:1/);
  assert.match(problems[1]!.message, /#seal:4-9/);
  assert.match(problems[2]!.message, /Duplicate id "seal"/);
});

test("rangeForSelection and blockAtLine", () => {
  const blocks = findCodeBlocks(NOTE);
  const seal = blockAtLine(blocks, 5)!;
  assert.equal(seal.id, "seal");
  assert.equal(blockAtLine(blocks, 10), null);
  assert.deepEqual(rangeForSelection(seal, 5, 5), { start: 3, end: 3 });
  assert.deepEqual(rangeForSelection(seal, 6, 4), { start: 2, end: 4 });
  assert.deepEqual(rangeForSelection(seal, 2, 8), { start: 1, end: 5 });
});

test("slugify, suggestId, insertIdIntoFence", () => {
  assert.equal(slugify("Hello World.go"), "hello-world-go");
  assert.equal(suggestId({ title: "internal/secrets/seal.go", lang: "go" }), "seal");
  assert.equal(suggestId({ title: "internal/secrets/seal.go", lang: "go" }, ["seal"]), "seal-2");
  assert.equal(suggestId({ lang: "go" }), "go");
  assert.equal(suggestId({ lang: "" }), "code");
  assert.equal(insertIdIntoFence('```go title="a.go"  ', "a"), '```go title="a.go" id="a"');
  assert.deepEqual(parseFenceInfo(insertIdIntoFence("```", "x").slice(3)), { lang: "", attrs: { id: "x" } });
});
