// Live Preview / source editor (CodeMirror 6): style [label](#id:a-b) refs, highlight the
// target lines inside the fenced block on hover, scroll + flash on click.

import { Prec, StateEffect, StateField, type Extension, type Range, type Text } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { editorInfoField, editorLivePreviewField } from "obsidian";
import type CodeRefsPlugin from "./main";
import {
  blockAtLine,
  blocksById,
  checkTarget,
  findCodeBlocks,
  findRefsInLine,
  formatLabel,
  githubUrl,
  parseRefTarget,
  type CodeBlock,
  type RefTarget,
} from "./parse";

// --- block cache ------------------------------------------------------------------------------

const blockCache = new WeakMap<Text, CodeBlock[]>();

function blocksOf(doc: Text): CodeBlock[] {
  let blocks = blockCache.get(doc);
  if (!blocks) {
    blocks = findCodeBlocks(doc.toJSON());
    blockCache.set(doc, blocks);
  }
  return blocks;
}

// --- highlight state ----------------------------------------------------------------------------

interface Highlight {
  hover: RefTarget | null;
  flash: RefTarget | null;
}

const setHover = StateEffect.define<RefTarget | null>();
const setFlash = StateEffect.define<RefTarget | null>();

const highlightField = StateField.define<Highlight>({
  create: () => ({ hover: null, flash: null }),
  update(value, tr) {
    let next = value;
    for (const e of tr.effects) {
      if (e.is(setHover)) next = { ...next, hover: e.value };
      else if (e.is(setFlash)) next = { ...next, flash: e.value };
    }
    return next;
  },
});

/** CM line number (1-based) of each referenced content line that exists. */
function targetLines(doc: Text, t: RefTarget): number[] {
  const block = blocksById(blocksOf(doc)).get(t.id);
  if (!block) return [];
  const out: number[] = [];
  const last = Math.min(t.end, block.lineCount);
  for (let n = Math.max(t.start, 1); n <= last; n++) out.push(block.openLine + n + 1);
  return out;
}

const highlightDecorations = EditorView.decorations.compute([highlightField, "doc"], (state) => {
  const { hover, flash } = state.field(highlightField);
  const ranges: Range<Decoration>[] = [];
  const add = (t: RefTarget | null, cls: string) => {
    if (!t) return;
    for (const n of targetLines(state.doc, t)) {
      ranges.push(Decoration.line({ class: cls }).range(state.doc.line(n).from));
    }
  };
  add(hover, "coderef-line-soft");
  add(flash, "coderef-line-strong");
  return Decoration.set(ranges, true);
});

// --- ref decorations ----------------------------------------------------------------------------

class LabelWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly target: string,
    readonly problem: string | null,
  ) {
    super();
  }
  override eq(other: LabelWidget): boolean {
    return other.text === this.text && other.target === this.target && other.problem === this.problem;
  }
  toDOM(): HTMLElement {
    const el = createSpan({ cls: "coderef-label coderef-lp-label", text: this.text });
    el.dataset.coderefTarget = this.target;
    if (this.problem) el.setAttr("aria-label", this.problem);
    return el;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

function buildRefDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const live = state.field(editorLivePreviewField, false) ?? false;
  const blocks = blocksOf(state.doc);
  const byId = blocksById(blocks);
  const sel = state.selection.ranges;
  const ranges: Range<Decoration>[] = [];

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      if (!line.text.includes("](") || blockAtLine(blocks, line.number - 1)) continue;
      for (const ref of findRefsInLine(line.text)) {
        const a = line.from + ref.from;
        const b = line.from + ref.to;
        if (sel.some((r) => r.from <= b && r.to >= a)) continue; // being edited: leave raw
        const target = `${ref.id}:${ref.start}-${ref.end}`;
        const problem = checkTarget(ref, byId);
        const attributes: Record<string, string> = { "data-coderef-target": target };
        if (problem) attributes["aria-label"] = problem;
        if (ref.labelTo > ref.labelFrom) {
          ranges.push(
            Decoration.mark({
              class: problem ? "coderef-lp is-broken" : "coderef-lp",
              attributes,
            }).range(line.from + ref.labelFrom, line.from + ref.labelTo),
          );
        }
        if (live) {
          ranges.push(
            Decoration.widget({
              widget: new LabelWidget(formatLabel(ref.start, ref.end), target, problem),
              side: 1,
            }).range(b),
          );
        }
      }
    }
  }
  return Decoration.set(ranges, true);
}

function refFromEvent(view: EditorView, evt: Event): RefTarget | null {
  const el = evt.target instanceof HTMLElement ? evt.target.closest<HTMLElement>("[data-coderef-target]") : null;
  if (!el || !view.contentDOM.contains(el)) return null;
  return parseRefTarget(el.dataset.coderefTarget);
}

function sameTarget(a: RefTarget | null, b: RefTarget | null): boolean {
  return a === b || (!!a && !!b && a.id === b.id && a.start === b.start && a.end === b.end);
}

function makeRefPlugin(plugin: CodeRefsPlugin) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private flashTimer: number | undefined;
      private readonly listeners: [string, EventListener, boolean][] = [];

      constructor(readonly view: EditorView) {
        this.decorations = buildRefDecorations(view);
        this.listen("mouseover", (e) => this.onHover(e), false);
        this.listen("mouseleave", () => this.hover(null), false);
        this.listen("mousedown", (e) => this.onPress(e as MouseEvent), true);
        this.listen("click", (e) => this.onClick(e as MouseEvent), true);
      }

      update(u: ViewUpdate): void {
        const liveChanged =
          u.startState.field(editorLivePreviewField, false) !== u.state.field(editorLivePreviewField, false);
        if (u.docChanged || u.viewportChanged || u.selectionSet || liveChanged) {
          this.decorations = buildRefDecorations(u.view);
        }
      }

      destroy(): void {
        for (const [type, fn, capture] of this.listeners) this.view.dom.removeEventListener(type, fn, capture);
        if (this.flashTimer !== undefined) window.clearTimeout(this.flashTimer);
      }

      private listen(type: string, fn: EventListener, capture: boolean): void {
        this.view.dom.addEventListener(type, fn, capture);
        this.listeners.push([type, fn, capture]);
      }

      private hover(t: RefTarget | null): void {
        if (sameTarget(this.view.state.field(highlightField).hover, t)) return;
        this.view.dispatch({ effects: setHover.of(t) });
      }

      private onHover(evt: Event): void {
        this.hover(refFromEvent(this.view, evt));
      }

      private isLive(): boolean {
        return this.view.state.field(editorLivePreviewField, false) ?? false;
      }

      /** In Live Preview a ref acts like a link: swallow the press so the cursor does not move. */
      private onPress(evt: MouseEvent): void {
        if (evt.button !== 0 || !this.isLive() || !refFromEvent(this.view, evt)) return;
        evt.preventDefault();
        evt.stopPropagation();
      }

      private onClick(evt: MouseEvent): void {
        if (evt.button !== 0 || !this.isLive()) return;
        const t = refFromEvent(this.view, evt);
        if (!t) return;
        evt.preventDefault();
        evt.stopPropagation();
        const block = blocksById(blocksOf(this.view.state.doc)).get(t.id);
        if (!block) return;
        if (evt.ctrlKey || evt.metaKey) {
          const url = !this.isPrivate() ? githubUrl(block.source, t.start, t.end) : null;
          if (url) {
            window.open(url, "_blank");
            return;
          }
        }
        this.flash(t, block);
      }

      private isPrivate(): boolean {
        const file = this.view.state.field(editorInfoField, false)?.file;
        if (!file) return false;
        return plugin.app.metadataCache.getFileCache(file)?.frontmatter?.private === true;
      }

      private flash(t: RefTarget, block: CodeBlock): void {
        const doc = this.view.state.doc;
        const first = Math.min(Math.max(t.start, 1), Math.max(block.lineCount, 1));
        const lineNo = Math.min(block.openLine + first + 1, doc.lines);
        if (this.flashTimer !== undefined) window.clearTimeout(this.flashTimer);
        this.view.dispatch({
          effects: [
            setFlash.of(t),
            EditorView.scrollIntoView(doc.line(lineNo).from, { y: "center" }),
          ],
        });
        this.flashTimer = window.setTimeout(() => {
          this.flashTimer = undefined;
          if (this.view.dom.isConnected) this.view.dispatch({ effects: setFlash.of(null) });
        }, plugin.settings.highlightMs);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

export function liveExtension(plugin: CodeRefsPlugin): Extension {
  // Highest precedence so our mark wraps Obsidian's link spans and the double underline wins.
  return [highlightField, highlightDecorations, Prec.highest(makeRefPlugin(plugin))];
}
