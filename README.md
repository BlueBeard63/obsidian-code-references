# Code References

An Obsidian plugin for writing about code. Give a code block an id, then link any sentence to specific
lines of it:

````md
```go title="crypto/seal.go" id="seal"
func Seal(key, plaintext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	...
}
```

The important part is [a fresh random nonce](#seal:11-14), and [this line](#seal:3) does X.
````

In reading view and Live Preview the link gets a double underline and a small `L11-14` label.
**Hover** it and those lines light up in the block; **click** it and the note scrolls to them and flashes
them. Readers of a long write-up never lose their place between the prose and the code.

It is plain Markdown underneath: without the plugin (on GitHub, in other editors, in a static site
generator) a reference is just a link to `#seal`, so nothing breaks.

## Features

- **Line references:** `[label](#id:line)` or `[label](#id:from-to)` to any id'd code block in the same note.
- **Hover highlight** of the referenced lines; **click** to scroll and flash them (reading view and Live Preview).
- **Code block headers** for blocks with an id: the `title` (or language), line numbers, and a `view source ↗`
  link when the block has `source="owner/repo@ref:path"` (GitHub). Ctrl/Cmd-click a reference to open GitHub at
  exactly those lines.
- **Broken reference warnings:** an unknown id or out-of-range lines show a dotted underline with a tooltip.
- **Commands** (command palette, no default hotkeys):
  - *Copy code reference for selected lines*: select lines inside a code block, run it, paste. If the block
    has no id yet, it asks for one (with a suggestion) and adds it to the fence.
  - *Insert code reference...*: pick a block from the note, then a line range.
  - *Validate code references in current note*: lists every broken reference and duplicate id, click to jump.
- **Settings:** highlight duration, Live Preview decorations on/off, line numbers in reading view.
- Follows your theme (light and dark); no colours of its own beyond a soft highlight.

## Syntax

````md
```<language> id="<id>" title="<shown in the header>" source="<owner/repo@ref:path>"
```
````

- Attributes come after the language, in any order, as `key="value"`. All are optional; refs need `id`.
- `id`: letters, numbers, `-` and `_`; unique within the note. Lines count from 1.
- `source`: `BlueBeard63/Bosun@v0.7.0:registry.go` links to that file on GitHub at that ref. Use a tag or commit
  so line numbers never drift. Add `private: true` to a note's frontmatter to hide source links in that note.
- References: `[text](#id:7)` for one line, `[text](#id:11-14)` for a range.

## Install

**From Obsidian:** Settings, Community plugins, Browse, search for "Code References". *(Pending review; until then
use BRAT or a manual install.)*

**With BRAT:** install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin, choose *Add beta plugin*
and enter `BlueBeard63/obsidian-code-references`.

**Manually:** download `main.js`, `manifest.json` and `styles.css` from the
[latest release](https://github.com/BlueBeard63/obsidian-code-references/releases/latest) into
`<your vault>/.obsidian/plugins/code-references/`, then enable *Code References* under Community plugins.

## Publishing a site from the same notes

The syntax is designed to survive publishing. [jack-morrison.dev](https://jack-morrison.dev) is built from an
Obsidian vault with a small Go static site generator that renders the same code blocks and references (double
underline, hover and click highlighting, shareable `#id:11-14` URLs). Any generator can support it: parse the
fence attributes, give each line an element, and turn `#id:a-b` links into references.

## Development

```sh
npm install
npm test        # unit tests for the parser (node --test)
npm run build   # type-check and bundle main.js into the repo root
npm run dev     # watch mode

# build straight into a test vault while you work:
OBSIDIAN_VAULT="/path/to/vault" npm run dev
```

The parser (`src/parse.ts`) has no Obsidian or DOM imports and carries all the syntax rules; `reading.ts` handles
reading view, `live.ts` the editor (CodeMirror 6), `commands.ts` the commands.

### Releasing

```sh
npm version 1.0.1         # bumps package.json, manifest.json and versions.json, commits and tags 1.0.1
git push --follow-tags    # the Release workflow builds and attaches main.js, manifest.json, styles.css
```

## Licence

MIT, see [LICENSE](LICENSE).
