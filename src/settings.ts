import { PluginSettingTab, Setting } from "obsidian";
import type CodeRefsPlugin from "./main";

export interface CodeRefsSettings {
  /** How long the strong highlight stays after clicking a ref (ms). */
  highlightMs: number;
  /** Decorate refs and highlight lines in Live Preview / the editor. */
  livePreview: boolean;
  /** Show line numbers on id'd code blocks in reading view. */
  lineNumbers: boolean;
}

export const DEFAULT_SETTINGS: CodeRefsSettings = {
  highlightMs: 2000,
  livePreview: true,
  lineNumbers: true,
};

export class CodeRefsSettingTab extends PluginSettingTab {
  private readonly plugin: CodeRefsPlugin;

  constructor(plugin: CodeRefsPlugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Highlight duration")
      .setDesc("How long (ms) the referenced lines stay strongly highlighted after clicking a code reference.")
      .addText((text) =>
        text
          .setPlaceholder(String(DEFAULT_SETTINGS.highlightMs))
          .setValue(String(this.plugin.settings.highlightMs))
          .onChange(async (value) => {
            const n = Number(value);
            if (!Number.isFinite(n) || n < 0) return;
            this.plugin.settings.highlightMs = Math.round(n);
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Live Preview decorations")
      .setDesc("Style code references in the editor, highlight target lines on hover and jump on click.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.livePreview).onChange(async (value) => {
          this.plugin.settings.livePreview = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Line numbers in reading view")
      .setDesc("Number the lines of code blocks that have an id.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.lineNumbers).onChange(async (value) => {
          this.plugin.settings.lineNumbers = value;
          await this.plugin.saveSettings();
        }),
      );
  }
}
