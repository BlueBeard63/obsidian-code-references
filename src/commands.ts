// Authoring commands: copy a ref for the selected lines, insert a ref, validate refs.

import { App, MarkdownView, Modal, Notice, Setting, SuggestModal, type Editor } from "obsidian";
import type CodeRefsPlugin from "./main";
import {
  blockAtLine,
  findCodeBlocks,
  formatLabel,
  formatRef,
  insertIdIntoFence,
  isValidId,
  parseRange,
  rangeForSelection,
  suggestId,
  validateNote,
  type CodeBlock,
} from "./parse";

export function registerCommands(plugin: CodeRefsPlugin): void {
  plugin.addCommand({
    id: "copy-code-reference",
    name: "Copy code reference for selected lines",
    editorCallback: (editor) => copyReference(plugin, editor),
  });

  plugin.addCommand({
    id: "paste-code-reference",
    name: "Paste code reference",
    editorCheckCallback: (checking, editor) => {
      const ref = plugin.lastReference;
      if (!ref) return false;
      if (!checking) pasteReference(editor, ref);
      return true;
    },
  });

  plugin.addCommand({
    id: "insert-code-reference",
    name: "Insert code reference...",
    editorCallback: (editor) => insertReference(plugin.app, editor),
  });

  plugin.addCommand({
    id: "validate-code-references",
    name: "Validate code references in current note",
    checkCallback: (checking) => {
      const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view) return false;
      if (!checking) validate(plugin.app, view);
      return true;
    },
  });
}

// --- copy -------------------------------------------------------------------------------------

function copyReference(plugin: CodeRefsPlugin, editor: Editor): void {
  const app = plugin.app;
  const from = editor.getCursor("from");
  const to = editor.getCursor("to");
  // A selection that ends at column 0 of the next line does not include that line.
  const toLine = to.line > from.line && to.ch === 0 ? to.line - 1 : to.line;
  const blocks = findCodeBlocks(editor.getValue());
  const block = blockAtLine(blocks, from.line);
  if (!block || blockAtLine(blocks, toLine) !== block) {
    new Notice("Put the cursor or selection inside a fenced code block first.");
    return;
  }
  const range = rangeForSelection(block, from.line, toLine);
  if (!range) {
    new Notice("This code block is empty.");
    return;
  }
  const finish = (id: string) => {
    const ref = formatRef("", id, range.start, range.end);
    plugin.lastReference = { id, start: range.start, end: range.end };
    if (!plugin.settings.useClipboard) {
      new Notice(`Ready: ${ref}. Run "Paste code reference" where you want it.`);
      return;
    }
    // Write-only: the plugin never reads the clipboard.
    void navigator.clipboard.writeText(ref).then(
      () => new Notice(`Copied ${ref}`),
      () => new Notice(`Could not copy to the clipboard: ${ref}. Use "Paste code reference" instead.`),
    );
  };
  if (block.id) {
    finish(block.id);
    return;
  }
  const taken = blocks.flatMap((b) => (b.id ? [b.id] : []));
  new PromptModal(app, {
    title: "This code block has no id",
    description: `Give it an id so it can be referenced. It is added to the fence as id="...".`,
    label: "Block id",
    value: suggestId(block, taken),
    validate: (v) => {
      if (!isValidId(v)) return "Use letters, digits, '-', '_' or '.' only.";
      if (taken.includes(v)) return `id "${v}" is already used in this note.`;
      return null;
    },
    onSubmit: (id) => {
      // Re-find the fence in case the document changed while the modal was open.
      const current = findCodeBlocks(editor.getValue()).find(
        (b) => b.openLine === block.openLine && !b.id,
      );
      if (!current) {
        new Notice("The code block moved; run the command again.");
        return;
      }
      const lineText = editor.getLine(current.openLine);
      editor.replaceRange(
        insertIdIntoFence(lineText, id),
        { line: current.openLine, ch: 0 },
        { line: current.openLine, ch: lineText.length },
      );
      finish(id);
    },
  }).open();
}

// --- paste --------------------------------------------------------------------------------------

/** Insert the last copied reference without touching the clipboard. A selection becomes the label. */
function pasteReference(editor: Editor, ref: { id: string; start: number; end: number }): void {
  const selected = editor.getSelection();
  const label = selected || "ref";
  const from = editor.getCursor("from");
  editor.replaceSelection(formatRef(label, ref.id, ref.start, ref.end));
  if (!selected) {
    // Select the placeholder label so it can be typed over.
    editor.setSelection({ line: from.line, ch: from.ch + 1 }, { line: from.line, ch: from.ch + 1 + label.length });
  }
}

// --- insert -------------------------------------------------------------------------------------

class BlockSuggestModal extends SuggestModal<CodeBlock> {
  constructor(
    app: App,
    private readonly blocks: CodeBlock[],
    private readonly onPick: (b: CodeBlock) => void,
  ) {
    super(app);
    this.setPlaceholder("Pick a code block to reference");
  }

  getSuggestions(query: string): CodeBlock[] {
    const q = query.toLowerCase();
    return this.blocks.filter(
      (b) => b.id!.toLowerCase().includes(q) || (b.title ?? "").toLowerCase().includes(q),
    );
  }

  renderSuggestion(block: CodeBlock, el: HTMLElement): void {
    el.createDiv({ text: block.id! });
    el.createEl("small", {
      cls: "coderef-suggest-meta",
      text: `${block.title || block.lang || "code"}  (${block.lineCount} line${block.lineCount === 1 ? "" : "s"})`,
    });
  }

  onChooseSuggestion(block: CodeBlock): void {
    this.onPick(block);
  }
}

function insertReference(app: App, editor: Editor): void {
  const blocks = findCodeBlocks(editor.getValue()).filter((b) => b.id);
  if (blocks.length === 0) {
    new Notice('No code blocks with an id in this note. Add id="..." to a fence first.');
    return;
  }
  new BlockSuggestModal(app, blocks, (block) => {
    const all = block.lineCount <= 1 ? "1" : `1-${block.lineCount}`;
    new PromptModal(app, {
      title: `Reference lines in "${block.id}"`,
      description: `${block.lineCount} line${block.lineCount === 1 ? "" : "s"}. Enter a line (7) or a range (11-14).`,
      label: "Lines",
      value: all,
      validate: (v) => {
        const r = parseRange(v);
        if (!r) return "Enter a line number or a range like 11-14.";
        if (r.start < 1 || r.end < r.start || r.end > block.lineCount) {
          return `Out of range: the block has lines 1-${block.lineCount}.`;
        }
        return null;
      },
      onSubmit: (v) => {
        const r = parseRange(v)!;
        const selected = editor.getSelection();
        const label = selected || "ref";
        const from = editor.getCursor("from");
        editor.replaceSelection(formatRef(label, block.id!, r.start, r.end));
        if (!selected) {
          // Select the placeholder label so it can be typed over.
          editor.setSelection({ line: from.line, ch: from.ch + 1 }, { line: from.line, ch: from.ch + 1 + label.length });
        }
        editor.focus();
        new Notice(`Inserted reference to ${block.id} ${formatLabel(r.start, r.end)}`);
      },
    }).open();
  }).open();
}

// --- validate -----------------------------------------------------------------------------------

function validate(app: App, view: MarkdownView): void {
  const problems = validateNote(view.editor.getValue());
  if (problems.length === 0) {
    new Notice("Code references: no problems found.");
    return;
  }
  const modal = new Modal(app);
  modal.titleEl.setText(`${problems.length} code reference problem${problems.length === 1 ? "" : "s"}`);
  const list = modal.contentEl.createEl("ul", { cls: "coderef-problems" });
  for (const p of problems) {
    const item = list.createEl("li");
    const jump = item.createEl("a", { text: `Line ${p.line + 1}`, href: "#" });
    item.appendText(`: ${p.message}`);
    jump.addEventListener("click", (evt) => {
      evt.preventDefault();
      modal.close();
      if (view.getMode() !== "source") {
        void view.leaf.setViewState({
          type: "markdown",
          state: { ...view.getState(), mode: "source" },
        });
      }
      view.editor.setCursor({ line: p.line, ch: 0 });
      view.editor.scrollIntoView({ from: { line: p.line, ch: 0 }, to: { line: p.line, ch: 0 } }, true);
      view.editor.focus();
    });
  }
  modal.open();
}

// --- prompt modal -------------------------------------------------------------------------------

interface PromptOptions {
  title: string;
  description: string;
  label: string;
  value: string;
  validate: (value: string) => string | null;
  onSubmit: (value: string) => void;
}

class PromptModal extends Modal {
  constructor(
    app: App,
    private readonly opts: PromptOptions,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl, opts } = this;
    this.titleEl.setText(opts.title);
    contentEl.createEl("p", { text: opts.description, cls: "setting-item-description" });
    let value = opts.value;
    const error = contentEl.createDiv({ cls: "coderef-prompt-error" });
    const submit = () => {
      const v = value.trim();
      const problem = opts.validate(v);
      if (problem) {
        error.setText(problem);
        return;
      }
      this.close();
      opts.onSubmit(v);
    };
    new Setting(contentEl).setName(opts.label).addText((text) => {
      text.setValue(value).onChange((v) => {
        value = v;
        error.setText("");
      });
      text.inputEl.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter") {
          evt.preventDefault();
          submit();
        }
      });
      window.setTimeout(() => {
        text.inputEl.focus();
        text.inputEl.select();
      }, 0);
    });
    contentEl.appendChild(error);
    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("OK").setCta().onClick(submit));
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
