import { Plugin } from "obsidian";
import type { Extension } from "@codemirror/state";
import { CodeRefsSettingTab, DEFAULT_SETTINGS, type CodeRefsSettings } from "./settings";
import { registerReadingView } from "./reading";
import { liveExtension } from "./live";
import { registerCommands } from "./commands";

const HIDE_NUMBERS_CLASS = "coderefs-hide-line-numbers";

export default class CodeRefsPlugin extends Plugin {
  override settings: CodeRefsSettings = { ...DEFAULT_SETTINGS };
  /** The last reference made by "Copy reference", for "Paste reference" (never saved). */
  lastReference: { id: string; start: number; end: number } | null = null;
  /** Mutated in place so the Live Preview toggle applies without a reload. */
  private readonly editorExtensions: Extension[] = [];

  override async onload(): Promise<void> {
    await this.loadSettings();
    registerReadingView(this);
    this.registerEditorExtension(this.editorExtensions);
    registerCommands(this);
    this.addSettingTab(new CodeRefsSettingTab(this));
    this.applySettings();
  }

  override onunload(): void {
    document.body.removeClass(HIDE_NUMBERS_CLASS);
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<CodeRefsSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.applySettings();
  }

  private applySettings(): void {
    document.body.toggleClass(HIDE_NUMBERS_CLASS, !this.settings.lineNumbers);
    const wanted = this.settings.livePreview;
    const active = this.editorExtensions.length > 0;
    if (wanted !== active) {
      this.editorExtensions.length = 0;
      if (wanted) this.editorExtensions.push(liveExtension(this));
      this.app.workspace.updateOptions();
    }
  }
}
