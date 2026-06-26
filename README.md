<img src="papyrus-banner.svg" alt="Papyrus — Offline-first document transformation engine">

# Papyrus v1.0.0

**Offline-first document transformation engine — convert any format to any format.**

Papyrus is a CLI-first document converter with a pipeline-based architecture. It reads 13 input formats and writes to 10 output formats — all offline, all local.

## Supported Formats

**Input (13):** Markdown (.md, .markdown), CSV (.csv), Plain Text (.txt, .text), Mermaid (.mmd, .mermaid), LaTeX (.tex, .latex), Word Document (.docx), Excel Spreadsheet (.xlsx), PowerPoint (.pptx), HTML (.html, .htm), JSON (.json), YAML (.yaml, .yml), Rich Text Format (.rtf), EPUB (.epub)

**Output (10):** PDF, Markdown, Plain Text, HTML, Word Document (DOCX), Excel Spreadsheet (XLSX), PowerPoint (PPTX), CSV, LaTeX, EPUB

Every input converts to every output — 130 conversion paths total.

## Getting Started

```bash
npm install
npm run papy
```

Launches interactive REPL. Type `cd <path>` to pick a folder, select files by number, and convert.

## Usage

### Interactive REPL (default)

```bash
npm run papy
```

Full state-machine REPL with file selection, multi-directory support, and format mapping:

```
papyrus> cd test-fixtures
papyrus> 1 3 4
papyrus> 1->pdf 3->txt 4->html
```

Type `manual` inside the REPL for full instructions with examples.

Commands:

| Command | Description |
|---------|-------------|
| `cd <path>` | Change directory, then add more dirs |
| `add cd` | Add another directory |
| `nshow` | Toggle auto-show after cd |
| `nshow <path>` | Change dir without file list |
| `show` | Show files (selected only if any) |
| `<N> <M>` | Add files to selection |
| `rem <N>,<M>` | Remove files from selection |
| `N-><fmt>` | Convert file N to format |
| `dir history` | Show visited directory paths |
| `back` | Reset selection & directories |
| `clear` | Clear screen |
| `manual` | Show full user manual |
| `help` | Show quick command reference |
| `exit / quit` | Exit |

### One-shot conversion

```bash
npm run papy -- convert <file> --to <format> [--output <dir>]
npm run papy -- convert doc.docx --to pdf
npm run papy -- convert file.md --to pdf --to html --to txt
```

### Batch conversion

```bash
npm run papy -- batch <dir> --to <format>
npm run papy -- batch ./docs --to pdf --all
```

### Other commands

```bash
npm run papy -- manual         # Show full user manual
npm run papy -- formats        # List all formats
npm run papy -- doctor         # System diagnostics
npm run papy -- watch <dir>    # Watch directory for changes
```

## Architecture

```
src/
├── cli/          # Commander CLI + interactive REPL + commands
├── core/         # Pipeline, parsers (13), workers (10), registry, scheduler
├── db/           # SQLite database layer
├── shared/       # Types, constants, schemas, utilities
└── types/        # Format-specific type definitions
```

Pipeline flow:

```
Source File -> Format Parser -> Intermediate Representation -> Workers -> Output File
```

- **13 parsers**: md, csv, txt, mermaid, latex, docx, xlsx, pptx, html, json, yaml, rtf, epub
- **10 workers**: pdf, md, txt, html, docx, xlsx, pptx, csv, latex, epub

## Tech Stack

- **Runtime**: Node.js >= 18, TypeScript
- **CLI**: Commander, Chalk, tsx (runner)
- **Pipeline**: Custom pipeline with registry, scheduler, worker pool
- **Database**: SQLite (better-sqlite3)
- **Conversion**: pdf-lib, docx, mammoth, xlsx, pptxgenjs, epub-gen, cheerio, rtf-parser, yaml

No heavy frameworks, no monorepo overhead. Flat `src/` structure.

## Scripts

| Script | Command |
|--------|---------|
| `npm run papy` | Launch interactive REPL |
| `npm run papyrus` | Same as above |
| `npm run cli` | Same as above |
| `npm test` | Run tests |
| `npm run typecheck` | TypeScript type check |
| `npm run lint` | ESLint |

## License

MIT
