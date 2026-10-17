/**
 * Frontend files built into the standalone executable (scripts/build-binaries.ts). The generated entry point
 * registers them before loading the server; everywhere else this stays empty and web/dist is read from disk.
 */
const files = new Map<string, string>();

/** Maps URL paths ("/index.html", "/assets/x.js") to the embedded file paths returned by `with { type: "file" }`. */
export function registerEmbeddedWeb(entries: Record<string, string>) {
  for (const [path, file] of Object.entries(entries)) files.set(path, file);
}

export function embeddedWebFile(path: string) {
  const file = files.get(path);
  return file ? Bun.file(file) : null;
}

export function hasEmbeddedWeb() {
  return files.size > 0;
}
