// Reading view: id'd code blocks get a header, line numbers and per-line wrappers;
// [label](#id:a-b) links become double-underlined, focusable code references.

import { MarkdownView, TFile, type MarkdownPostProcessorContext, type MarkdownSectionInformation } from "obsidian";
import type CodeRefsPlugin from "./main";
import {
  blocksById,
  checkTarget,
  findCodeBlocks,
  formatLabel,
  githubUrl,
  parseRefTarget,
  type CodeBlock,
  type RefTarget,
} from "./parse";

const LINE_CLASS = "coderef-line";
const flashTimers = new WeakMap<HTMLElement, number>();

export function registerReadingView(plugin: CodeRefsPlugin): void {
  plugin.registerMarkdownPostProcessor((el, ctx) => processSection(plugin, el, ctx));
}

function processSection(
  plugin: CodeRefsPlugin,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
): Promise<void> | void {
  const codes = Array.from(el.querySelectorAll<HTMLElement>("pre > code"));
  const links = Array.from(el.querySelectorAll<HTMLAnchorElement>("a")).filter(
    (a) => refTargetOf(a) !== null,
  );
  if (codes.length === 0 && links.length === 0) return;

  // Obsidian drops everything after the language from the rendered <pre>, so recover the raw
  // fence line from the note source. getSectionInfo gives the whole note text plus this
  // section's line span; it is null for some renders (exports, hover popovers, canvas), and
  // then we fall back to reading the file and matching blocks by content.
  const info = ctx.getSectionInfo(el);
  if (info) {
    run(plugin, ctx, codes, links, info.text, info);
    return;
  }
  const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
  if (!(file instanceof TFile)) {
    run(plugin, ctx, codes, links, "", null);
    return;
  }
  return plugin.app.vault.cachedRead(file).then(
    (text) => run(plugin, ctx, codes, links, text, null),
    () => run(plugin, ctx, codes, links, "", null),
  );
}

function run(
  plugin: CodeRefsPlugin,
  ctx: MarkdownPostProcessorContext,
  codes: HTMLElement[],
  links: HTMLAnchorElement[],
  text: string,
  info: MarkdownSectionInformation | null,
): void {
  const blocks = findCodeBlocks(text);
  const isPrivate = ctx.frontmatter?.private === true;
  if (codes.length) decorateBlocks(codes, blocks, info, ctx.sourcePath, isPrivate);
  if (links.length) {
    const byId = blocksById(blocks);
    for (const a of links) replaceLink(plugin, a, byId, ctx.sourcePath, isPrivate, text === "");
  }
}

function refTargetOf(a: HTMLAnchorElement): RefTarget | null {
  const href = a.getAttribute("data-href") ?? a.getAttribute("href");
  if (!href || !href.includes("#")) return null;
  return parseRefTarget(href);
}

// ---------------------------------------------------------------------------------------------
// Code blocks

function codeText(code: HTMLElement): string {
  return (code.textContent ?? "").replace(/\n$/, "");
}

function decorateBlocks(
  codes: HTMLElement[],
  blocks: CodeBlock[],
  info: MarkdownSectionInformation | null,
  sourcePath: string,
  isPrivate: boolean,
): void {
  const candidates = info
    ? blocks.filter((b) => b.openLine >= info.lineStart && b.openLine <= info.lineEnd)
    : blocks;
  const used = new Set<CodeBlock>();
  codes.forEach((code, i) => {
    const text = codeText(code);
    let block = candidates.find((b) => !used.has(b) && b.content === text);
    // Content can differ slightly (indent stripping, tabs); with section info the order is reliable.
    if (!block && info && candidates.length === codes.length) block = candidates[i];
    if (!block) return;
    used.add(block);
    if (block.id) decorateBlock(code, block, sourcePath, isPrivate);
  });
}

function decorateBlock(code: HTMLElement, block: CodeBlock, sourcePath: string, isPrivate: boolean): void {
  const pre = code.parentElement;
  if (!pre || pre.hasClass("coderef-pre")) return;
  const id = block.id!;

  pre.addClass("coderef-pre");
  pre.id = id;
  pre.dataset.coderefId = id;
  pre.dataset.coderefPath = sourcePath;
  pre.style.setProperty("--coderef-gutter", `${String(Math.max(block.lineCount, 1)).length}ch`);

  const header = createDiv({ cls: "coderef-header" });
  header.createSpan({ cls: "coderef-title", text: block.title || block.lang || "code" });
  if (block.source) {
    if (isPrivate) {
      header.createSpan({ cls: "coderef-source is-private", text: "private repo" });
    } else {
      const url = githubUrl(block.source);
      if (url) {
        header.createEl("a", {
          cls: "coderef-source external-link",
          text: "view source ↗",
          href: url,
          attr: { target: "_blank", rel: "noopener" },
        });
      }
    }
  }
  pre.parentElement?.insertBefore(header, pre);

  wrapLines(code, block.lineCount);
  watchForRehighlight(code, block.lineCount);
}

/** Split the (possibly syntax highlighted) code into one block element per line. */
function wrapLines(code: HTMLElement, expected: number): void {
  const lines = splitNode(code);
  // A trailing newline produces an extra empty line; drop empties beyond the block's length.
  while (lines.length > Math.max(expected, 1) && lines[lines.length - 1]!.length === 0) lines.pop();
  code.empty();
  lines.forEach((nodes, i) => {
    const line = code.createSpan({ cls: LINE_CLASS });
    line.dataset.line = String(i + 1);
    for (const n of nodes) line.appendChild(n);
  });
}

/** Returns the node split into lines; elements spanning lines are cloned per line. */
function splitNode(node: Node): Node[][] {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? "").split("\n").map((part) => (part ? [document.createTextNode(part)] : []));
  }
  if (!(node instanceof HTMLElement)) return [[]];
  const lines: Node[][] = [[]];
  for (const child of Array.from(node.childNodes)) {
    const parts = splitNode(child);
    lines[lines.length - 1]!.push(...parts[0]!);
    for (let i = 1; i < parts.length; i++) lines.push(parts[i]!);
  }
  if (node.tagName === "CODE") return lines;
  return lines.map((nodes) => {
    if (nodes.length === 0) return [];
    const clone = node.cloneNode(false) as HTMLElement;
    for (const n of nodes) clone.appendChild(n);
    return [clone];
  });
}

/** Syntax highlighting can land after post-processing; re-wrap if the code gets replaced. */
function watchForRehighlight(code: HTMLElement, expected: number): void {
  const observer = new MutationObserver(() => {
    const stale = Array.from(code.childNodes).some(
      (n) => !(n instanceof HTMLElement) || !n.hasClass(LINE_CLASS),
    );
    if (!stale) return;
    observer.disconnect();
    wrapLines(code, expected);
    observer.observe(code, { childList: true });
  });
  observer.observe(code, { childList: true });
  window.setTimeout(() => observer.disconnect(), 10000);
}

// ---------------------------------------------------------------------------------------------
// References

function replaceLink(
  plugin: CodeRefsPlugin,
  a: HTMLAnchorElement,
  byId: Map<string, CodeBlock>,
  sourcePath: string,
  isPrivate: boolean,
  sourceUnknown: boolean,
): void {
  const target = refTargetOf(a)!;
  const span = createSpan({ cls: "coderef" });
  span.setAttrs({ role: "button", tabindex: "0", "data-coderef-target": `${target.id}:${target.start}-${target.end}` });
  const text = span.createSpan({ cls: "coderef-text" });
  while (a.firstChild) text.appendChild(a.firstChild);
  span.createSpan({ cls: "coderef-label", text: formatLabel(target.start, target.end) });
  a.replaceWith(span);

  const block = byId.get(target.id);
  const problem = sourceUnknown ? null : checkTarget(target, byId);
  if (problem) {
    span.addClass("is-broken");
    span.setAttr("aria-label", problem);
  }

  const soft = (on: boolean) => {
    const pre = findBlockEl(span, target.id, sourcePath);
    if (pre) setLines(pre, target, "is-soft", on);
  };
  const activate = (evt: MouseEvent | KeyboardEvent) => {
    evt.preventDefault();
    evt.stopPropagation();
    const url = block?.source && !isPrivate ? githubUrl(block.source, target.start, target.end) : null;
    if ((evt.ctrlKey || evt.metaKey) && url) {
      window.open(url, "_blank");
      return;
    }
    void jumpTo(plugin, span, target, block, sourcePath);
  };

  span.addEventListener("mouseenter", () => soft(true));
  span.addEventListener("mouseleave", () => soft(false));
  span.addEventListener("focus", () => soft(true));
  span.addEventListener("blur", () => soft(false));
  span.addEventListener("click", activate);
  span.addEventListener("keydown", (evt) => {
    if (evt.key === "Enter" || evt.key === " ") activate(evt);
  });
}

function findBlockEl(from: HTMLElement, id: string, sourcePath: string): HTMLElement | null {
  const scope =
    from.closest(".markdown-embed-content") ??
    from.closest(".markdown-preview-view") ??
    from.closest(".markdown-rendered") ??
    document.body;
  const all = Array.from(scope.querySelectorAll<HTMLElement>("pre.coderef-pre"));
  return all.find((p) => p.dataset.coderefId === id && p.dataset.coderefPath === sourcePath) ?? null;
}

function lineEls(pre: HTMLElement, t: RefTarget): HTMLElement[] {
  return Array.from(pre.querySelectorAll<HTMLElement>(`.${LINE_CLASS}`)).filter((l) => {
    const n = Number(l.dataset.line);
    return n >= t.start && n <= t.end;
  });
}

function setLines(pre: HTMLElement, t: RefTarget, cls: string, on: boolean): HTMLElement[] {
  const els = lineEls(pre, t);
  for (const l of els) l.toggleClass(cls, on);
  return els;
}

async function jumpTo(
  plugin: CodeRefsPlugin,
  span: HTMLElement,
  target: RefTarget,
  block: CodeBlock | undefined,
  sourcePath: string,
): Promise<void> {
  let pre = findBlockEl(span, target.id, sourcePath);
  if (!pre && block) {
    // Reading view only keeps nearby sections in the DOM. Ask the view to scroll to the
    // block's source line so it gets rendered, then look again.
    const view = plugin.app.workspace
      .getLeavesOfType("markdown")
      .map((l) => l.view)
      .find((v): v is MarkdownView => v instanceof MarkdownView && v.containerEl.contains(span));
    if (view && view.getMode() === "preview") {
      view.previewMode.applyScroll(block.openLine);
      for (let i = 0; i < 20 && !pre; i++) {
        await sleep(50);
        pre = findBlockEl(span, target.id, sourcePath);
      }
    }
  }
  if (!pre) return;
  flash(plugin, pre, target);
}

function flash(plugin: CodeRefsPlugin, pre: HTMLElement, target: RefTarget): void {
  const prev = flashTimers.get(pre);
  if (prev !== undefined) window.clearTimeout(prev);
  pre.querySelectorAll(".is-strong").forEach((l) => l.removeClass("is-strong"));

  const els = setLines(pre, target, "is-strong", true);
  const anchor = els[0] ?? pre;
  const fits = pre.getBoundingClientRect().height < window.innerHeight * 0.7;
  (fits ? pre : anchor).scrollIntoView({ block: "center", behavior: "smooth" });

  flashTimers.set(
    pre,
    window.setTimeout(() => {
      for (const l of els) l.removeClass("is-strong");
      flashTimers.delete(pre);
    }, plugin.settings.highlightMs),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}
