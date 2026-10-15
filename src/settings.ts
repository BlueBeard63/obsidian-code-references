import { PluginSettingTab, Setting, type SettingDefinitionItem } from "obsidian";
import type CodeRefsPlugin from "./main";

export interface CodeRefsSettings {
  /** How long the strong highlight stays after clicking a ref (ms). */
  highlightMs: number;
  /** Decorate refs and highlight lines in Live Preview / the editor. */
  livePreview: boolean;
  /** Show line numbers on id'd code blocks in reading view. */
  lineNumbers: boolean;
  /**
   * "Copy reference" also writes to the system clipboard. The plugin never reads the clipboard;
   * with this off the reference is only kept inside the plugin for "Paste reference".
   */
  useClipboard: boolean;
}

export const DEFAULT_SETTINGS: CodeRefsSettings = {
  highlightMs: 2000,
  livePreview: true,
  lineNumbers: true,
  useClipboard: true,
};

type Key = keyof CodeRefsSettings;

/** One list drives both the declarative settings (1.13+, searchable) and the classic display(). */
const SETTINGS: { key: Key; type: "number" | "toggle"; name: string; desc: string }[] = [
  {
    key: "highlightMs",
    type: "number",
    name: "Highlight duration",
    desc: "How long (ms) the referenced lines stay strongly highlighted after clicking a code reference.",
  },
  {
    key: "livePreview",
    type: "toggle",
    name: "Live Preview decorations",
    desc: "Style code references in the editor, highlight target lines on hover and jump on click.",
  },
  {
    key: "lineNumbers",
    type: "toggle",
    name: "Line numbers in reading view",
    desc: "Number the lines of code blocks that have an id.",
  },
  {
    key: "useClipboard",
    type: "toggle",
    name: "Copy to system clipboard",
    desc:
      'When on, "Copy reference for selected lines" puts the reference on the system clipboard. ' +
      'When off, the plugin keeps it to itself and you insert it with "Paste reference". ' +
      "The plugin never reads the clipboard either way.",
  },
];

function validDuration(n: number): string | void {
  if (!Number.isFinite(n) || n < 0) return "Enter a number of milliseconds, 0 or more.";
}

export class CodeRefsSettingTab extends PluginSettingTab {
  private readonly plugin: CodeRefsPlugin;

  constructor(plugin: CodeRefsPlugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    return SETTINGS.map(({ key, type, name, desc }) =>
      type === "number"
        ? {
            name,
            desc,
            control: {
              type,
              key,
              min: 0,
              step: 100,
              defaultValue: DEFAULT_SETTINGS.highlightMs,
              validate: validDuration,
            },
          }
        : { name, desc, control: { type, key, defaultValue: DEFAULT_SETTINGS[key] as boolean } },
    );
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    if (!(key in DEFAULT_SETTINGS) || typeof value !== typeof DEFAULT_SETTINGS[key as Key]) return;
    if (key === "highlightMs") value = Math.round(value as number);
    Object.assign(this.plugin.settings, { [key]: value });
    // saveSettings also applies the change (line numbers, Live Preview) straight away.
    await this.plugin.saveSettings();
  }

  /** Fallback for Obsidian before 1.13, which does not use getSettingDefinitions(). */
  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const settings = this.plugin.settings;

    for (const { key, type, name, desc } of SETTINGS) {
      const setting = new Setting(containerEl).setName(name).setDesc(desc);
      if (type === "number") {
        setting.addText((text) =>
          text
            .setPlaceholder(String(DEFAULT_SETTINGS[key]))
            .setValue(String(settings[key]))
            .onChange(async (value) => {
              const n = Number(value);
              if (validDuration(n)) return;
              await this.setControlValue(key, n);
            }),
        );
      } else {
        setting.addToggle((toggle) =>
          toggle.setValue(settings[key] as boolean).onChange((value) => this.setControlValue(key, value)),
        );
      }
    }
  }
}
