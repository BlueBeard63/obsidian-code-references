// Pure parsing helpers for fenced code blocks with ids and [label](#id:a-b) references.
// No Obsidian or DOM imports here so the module can be unit tested with plain node.

export interface FenceInfo {
  lang: string;
  attrs: Record<string, string>;
}

export interface RefTarget {
  id: string;
  start: number;
  end: number;
}

export interface CodeBlock {
  lang: string;
  attrs: Record<string, string>;
  id?: string;
  title?: string;
  source?: string;
  /** 0-based line of the opening fence. Content line N is document line openLine + N. */
  openLine: number;
  /** 0-based line of the closing fence (or the last document line when unclosed). */
  closeLine: number;
  /** Number of content lines (lines between the fences). */
  lineCount: number;
  closed: boolean;
  /** Raw content between the fences, blockquote prefixes removed, joined with "\n". */
  content: string;
}

export interface RefOccurrence extends RefTarget {
  label: string;
  /** 0-based document line. */
  line: number;
  /** Offsets relative to the start of the line. */
  from: number;
  to: number;
  labelFrom: number;
  labelTo: number;
}

export interface Problem {
  line: number;
  message: string;
}

export interface SourceRef {
  owner: string;
  repo: string;
  ref: string;
  path: string;
}

const ATTR_RE = /([A-Za-z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))/g;
const ID_CHARS = "A-Za-z0-9_.-";
const TARGET_RE = new RegExp(`^#?([${ID_CHARS}]+):(\\d+)(?:-(\\d+))?$`);
const REF_RE = new RegExp(
  `\\[((?:\\\\.|[^\\]\\\\])*)\\]\\(\\s*<?#([${ID_CHARS}]+):(\\d+)(?:-(\\d+))?>?\\s*\\)`,
  "g",
);
const FENCE_OPEN_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const QUOTE_PREFIX_RE = /^(?:[ \t]{0,3}>[ \t]?)*/;

/** Parse a fence info string: language first, then key="value" attributes in any order. */
export function parseFenceInfo(info: string): FenceInfo {
  const text = info.trim();
  let lang = "";
  let rest = text;
  const first = /^\S+/.exec(text);
  if (first && !first[0].includes("=")) {
    lang = first[0];
    rest = text.slice(first[0].length);
  }
  const attrs: Record<string, string> = {};
  for (const m of rest.matchAll(ATTR_RE)) {
    const key = m[1];
    if (!(key in attrs)) attrs[key] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return { lang, attrs };
}

/** Parse "#seal:11-14", "seal:11-14" or "#seal:7". URL-encoded input is accepted. */
export function parseRefTarget(href: string | null | undefined): RefTarget | null {
  if (!href) return null;
  let s = href.trim();
  try {
    s = decodeURIComponent(s);
  } catch {
    // keep the raw string
  }
  const hash = s.indexOf("#");
  if (hash > 0) s = s.slice(hash);
  const m = TARGET_RE.exec(s);
  if (!m) return null;
  const start = Number(m[2]);
  const end = m[3] === undefined ? start : Number(m[3]);
  return { id: m[1], start, end };
}

/** "L7" or "L11-14" (plain hyphen). */
export function formatLabel(start: number, end: number): string {
  return start === end ? `L${start}` : `L${start}-${end}`;
}

/** "#seal:7" or "#seal:11-14". */
export function formatTarget(id: string, start: number, end: number): string {
  return start === end ? `#${id}:${start}` : `#${id}:${start}-${end}`;
}

export function formatRef(label: string, id: string, start: number, end: number): string {
  return `[${label}](${formatTarget(id, start, end)})`;
}

/** Parse "1-12", "7" or " 3 - 9 ". */
export function parseRange(text: string): { start: number; end: number } | null {
  const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(text);
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] === undefined ? start : Number(m[2]);
  return { start, end };
}

/** Parse source="owner/repo@ref:path". */
export function parseSource(source: string | undefined): SourceRef | null {
  if (!source) return null;
  const m = /^([^/\s@]+)\/([^/\s@]+)@([^:\s]+):(.+)$/.exec(source.trim());
  if (!m) return null;
  return { owner: m[1], repo: m[2], ref: m[3], path: m[4].replace(/^\/+/, "") };
}

/** https://github.com/owner/repo/blob/ref/path, optionally with #L7 or #L11-L14. */
export function githubUrl(source: string | undefined, start?: number, end?: number): string | null {
  const s = parseSource(source);
  if (!s) return null;
  let url = `https://github.com/${s.owner}/${s.repo}/blob/${encodeURI(s.ref)}/${encodeURI(s.path)}`;
  if (start !== undefined) {
    const e = end ?? start;
    url += e === start ? `#L${start}` : `#L${start}-L${e}`;
  }
  return url;
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/** Find every fenced code block (backtick or tilde, optionally inside blockquotes/callouts). */
export function findCodeBlocks(textOrLines: string | readonly string[]): CodeBlock[] {
  const lines = typeof textOrLines === "string" ? splitLines(textOrLines) : textOrLines;
  const blocks: CodeBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const prefix = QUOTE_PREFIX_RE.exec(raw)![0];
    const m = FENCE_OPEN_RE.exec(raw.slice(prefix.length));
    if (!m) {
      i++;
      continue;
    }
    const fence = m[2];
    const info = m[3];
    if (fence[0] === "`" && info.includes("`")) {
      i++;
      continue;
    }
    const closeRe = new RegExp(`^\\s*${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`);
    const depth = (prefix.match(/>/g) ?? []).length;
    const content: string[] = [];
    let j = i + 1;
    let closed = false;
    for (; j < lines.length; j++) {
      const line = lines[j];
      const p = QUOTE_PREFIX_RE.exec(line)![0];
      const body = depth > 0 ? stripQuoteLevels(line, depth) : line;
      if (depth > 0 && (p.match(/>/g) ?? []).length < depth) break; // quote ended: unclosed
      if (closeRe.test(body)) {
        closed = true;
        break;
      }
      content.push(body);
    }
    const { lang, attrs } = parseFenceInfo(info);
    const block: CodeBlock = {
      lang,
      attrs,
      openLine: i,
      closeLine: closed ? j : j - 1,
      lineCount: content.length,
      closed,
      content: content.join("\n"),
    };
    if (attrs.id) block.id = attrs.id;
    if (attrs.title) block.title = attrs.title;
    if (attrs.source) block.source = attrs.source;
    blocks.push(block);
    i = closed ? j + 1 : j;
  }
  return blocks;
}

function stripQuoteLevels(line: string, depth: number): string {
  let s = line;
  for (let d = 0; d < depth; d++) {
    const m = /^[ \t]{0,3}>[ \t]?/.exec(s);
    if (!m) break;
    s = s.slice(m[0].length);
  }
  return s;
}

/** The block whose fences (inclusive) contain the 0-based line, if any. */
export function blockAtLine(blocks: readonly CodeBlock[], line: number): CodeBlock | null {
  for (const b of blocks) if (line >= b.openLine && line <= b.closeLine) return b;
  return null;
}

/** First block with each id. */
export function blocksById(blocks: readonly CodeBlock[]): Map<string, CodeBlock> {
  const map = new Map<string, CodeBlock>();
  for (const b of blocks) if (b.id && !map.has(b.id)) map.set(b.id, b);
  return map;
}

/**
 * Convert a document selection (0-based lines) into a 1-based line range inside the block.
 * Lines on the fences are clamped to the content. Returns null for an empty block.
 */
export function rangeForSelection(
  block: CodeBlock,
  fromLine: number,
  toLine: number,
): { start: number; end: number } | null {
  if (block.lineCount === 0) return null;
  const clamp = (n: number) => Math.min(Math.max(n, 1), block.lineCount);
  const a = clamp(Math.min(fromLine, toLine) - block.openLine);
  const b = clamp(Math.max(fromLine, toLine) - block.openLine);
  return { start: a, end: b };
}

/** Find [label](#id:a-b) refs in one line. Skips image links and refs inside inline code. */
export function findRefsInLine(text: string, line = 0): RefOccurrence[] {
  const out: RefOccurrence[] = [];
  for (const m of text.matchAll(REF_RE)) {
    const from = m.index;
    if (from > 0 && text[from - 1] === "!") continue;
    if (insideInlineCode(text, from)) continue;
    const start = Number(m[3]);
    const end = m[4] === undefined ? start : Number(m[4]);
    out.push({
      id: m[2],
      start,
      end,
      label: m[1],
      line,
      from,
      to: from + m[0].length,
      labelFrom: from + 1,
      labelTo: from + 1 + m[1].length,
    });
  }
  return out;
}

function insideInlineCode(text: string, pos: number): boolean {
  let ticks = 0;
  for (let i = 0; i < pos; i++) if (text[i] === "`") ticks++;
  return ticks % 2 === 1;
}

/** Find every ref in a note, skipping fenced code blocks. */
export function findRefs(text: string, blocks?: readonly CodeBlock[]): RefOccurrence[] {
  const lines = splitLines(text);
  const bs = blocks ?? findCodeBlocks(lines);
  const inBlock = new Uint8Array(lines.length);
  for (const b of bs) for (let l = b.openLine; l <= b.closeLine && l < lines.length; l++) inBlock[l] = 1;
  const out: RefOccurrence[] = [];
  lines.forEach((l, i) => {
    if (!inBlock[i] && l.includes("](")) out.push(...findRefsInLine(l, i));
  });
  return out;
}

/** Why a ref target is broken, or null when it is fine. */
export function checkTarget(target: RefTarget, byId: ReadonlyMap<string, CodeBlock>): string | null {
  const block = byId.get(target.id);
  if (!block) return `No code block with id="${target.id}" in this note`;
  if (target.start < 1) return "Line numbers start at 1";
  if (target.end < target.start) return `Range ${target.start}-${target.end} is reversed`;
  if (target.end > block.lineCount) {
    return `Block "${target.id}" has ${block.lineCount} line${block.lineCount === 1 ? "" : "s"}, ref asks for ${formatLabel(target.start, target.end)}`;
  }
  return null;
}

/** All problems in a note: duplicate ids, unknown ids, out-of-range lines. */
export function validateNote(text: string): Problem[] {
  const blocks = findCodeBlocks(text);
  const problems: Problem[] = [];
  const seen = new Map<string, CodeBlock>();
  for (const b of blocks) {
    if (!b.id) continue;
    const prev = seen.get(b.id);
    if (prev) {
      problems.push({
        line: b.openLine,
        message: `Duplicate id "${b.id}" (first used on line ${prev.openLine + 1})`,
      });
    } else seen.set(b.id, b);
    if (!b.closed) problems.push({ line: b.openLine, message: `Code block "${b.id}" is not closed` });
  }
  for (const r of findRefs(text, blocks)) {
    const msg = checkTarget(r, seen);
    if (msg) problems.push({ line: r.line, message: `${formatTarget(r.id, r.start, r.end)}: ${msg}` });
  }
  return problems.sort((a, b) => a.line - b.line);
}

/** Lowercase slug made of [a-z0-9-]. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Suggest an id from the title's file name (seal.go -> seal), then the language, then "code". */
export function suggestId(block: Pick<CodeBlock, "title" | "lang">, taken: Iterable<string> = []): string {
  const used = new Set(taken);
  let base = "";
  if (block.title) {
    const name = block.title.split(/[\\/]/).pop() ?? "";
    base = slugify(name.replace(/\.[^.]+$/, "")) || slugify(block.title);
  }
  if (!base) base = slugify(block.lang);
  if (!base) base = "code";
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  return id;
}

export function isValidId(id: string): boolean {
  return new RegExp(`^[${ID_CHARS}]+$`).test(id);
}

/** Append id="..." to an opening fence line (keeps any trailing content intact). */
export function insertIdIntoFence(line: string, id: string): string {
  const trimmed = line.replace(/\s+$/, "");
  return `${trimmed} id="${id}"`;
}
