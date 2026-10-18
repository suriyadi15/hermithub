/**
 * Builds the standalone `hermithub` executables (server + frontend in one file) into dist/.
 *
 *   bun run build:bin                    # every release target
 *   bun run build:bin linux-x64          # only some (names as in TARGETS)
 *   bun run build:bin --host             # only the platform this runs on
 */
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { $ } from "bun";

const ROOT = join(import.meta.dir, "..");
const DIST = join(ROOT, "dist");
const WEB_DIST = join(ROOT, "web/dist");
const ENTRY_DIR = join(DIST, ".entry");

/** Release name → Bun target. x64 uses the baseline build so CPUs without AVX2 (common on cheap VPSs) work. */
const TARGETS: Record<string, string> = {
  "linux-x64": "bun-linux-x64-baseline",
  "linux-arm64": "bun-linux-arm64",
  "linux-x64-musl": "bun-linux-x64-musl-baseline",
  "linux-arm64-musl": "bun-linux-arm64-musl",
  "darwin-x64": "bun-darwin-x64-baseline",
  "darwin-arm64": "bun-darwin-arm64",
};

function hostTarget() {
  const os = process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const musl = os === "linux" && !process.report?.getReport?.()?.header?.glibcVersionRuntime;
  return `${os}-${arch}${musl ? "-musl" : ""}`;
}

const args = process.argv.slice(2);
const names = args.includes("--host") ? [hostTarget()] : args.length ? args : Object.keys(TARGETS);
for (const name of names) if (!TARGETS[name]) throw new Error(`Unknown target ${name}: ${Object.keys(TARGETS).join(", ")}`);

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    out.push(...(e.isDirectory() ? await walk(p) : [p]));
  }
  return out;
}

await $`bun run build`.cwd(ROOT);

// Entry point that embeds every web/dist file, registers them, then starts the CLI. The CLI is imported
// dynamically so the registration runs first.
const files = await walk(WEB_DIST);
const imports = files.map((f, i) => `import f${i} from ${JSON.stringify(relative(ENTRY_DIR, f))} with { type: "file" };`);
const entries = files.map((f, i) => `  ${JSON.stringify("/" + relative(WEB_DIST, f))}: f${i},`);
await rm(ENTRY_DIR, { recursive: true, force: true });
await mkdir(ENTRY_DIR, { recursive: true });
const entry = join(ENTRY_DIR, "main.ts");
await writeFile(
  entry,
  [
    `import { registerEmbeddedWeb } from "../../server/src/web-embed";`,
    ...imports,
    `registerEmbeddedWeb({`,
    ...entries,
    `});`,
    `await import("../../server/src/cli");`,
    "",
  ].join("\n"),
);

for (const name of names) {
  const outfile = join(DIST, `hermithub-${name}`);
  console.log(`Building ${relative(ROOT, outfile)} (${TARGETS[name]})`);
  await $`bun build ${entry} --compile --minify --define ${`process.env.HERMITHUB_TARGET="${name}"`} --no-compile-autoload-dotenv --no-compile-autoload-bunfig --target=${TARGETS[name]} --outfile ${outfile}`.cwd(ROOT);
}
await rm(ENTRY_DIR, { recursive: true, force: true });

// Copies under the name from before the rename (Project Hub): the updater of v0.5.0 and older downloads
// project-hub-<target>. The new executable moves such installs over to the new name when it starts.
for (const name of names) await copyFile(join(DIST, `hermithub-${name}`), join(DIST, `project-hub-${name}`));

// Checksums of everything in dist/, in the format `sha256sum -c` and `shasum -a 256 -c` read.
const sums: string[] = [];
for (const f of (await readdir(DIST)).filter((f) => /^(hermithub|project-hub)-/.test(f)).sort()) {
  const hash = new Bun.CryptoHasher("sha256").update(await Bun.file(join(DIST, f)).arrayBuffer()).digest("hex");
  sums.push(`${hash}  ${f}`);
}
await writeFile(join(DIST, "SHA256SUMS"), sums.join("\n") + "\n");
console.log(`Done: ${names.length} executable(s) in dist/`);
