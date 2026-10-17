// Copies docs/*.md into the Starlight content folder, so docs/ stays the only source of the documentation.
// The first "# Heading" becomes the page title, and links are rewritten for the website.
import { readdir, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const REPO = "https://github.com/suriyadi15/project-hub/blob/main";
const root = join(import.meta.dir, "../..");
const src = join(root, "docs");
const out = join(import.meta.dir, "../src/content/docs/docs");

function rewriteLink(target: string): string {
  if (/^[a-z]+:|^#|^\//i.test(target)) return target;
  const [path, hash] = target.split("#");
  const suffix = hash ? `#${hash}` : "";
  if (path === "../README.md") return `/${suffix}`;
  if (path.startsWith("../")) return `${REPO}/${path.slice(3)}${suffix}`;
  if (path.endsWith(".md") && !path.includes("/")) return `/docs/${path.slice(0, -3)}/${suffix}`;
  // Anything else (e.g. diagrams/) lives in docs/ on GitHub
  return `${REPO}/docs/${path}${suffix}`;
}

function firstParagraph(body: string): string {
  for (const block of body.split(/\n\s*\n/)) {
    const text = block.trim();
    if (!text || /^(#|```|\||-|\*|\d+\.|>|!\[)/.test(text)) continue;
    return text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[*`]/g, "")
      .replace(/\s+/g, " ")
      .replace(/:$/, ".");
  }
  return "";
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const files = (await readdir(src)).filter((f) => f.endsWith(".md"));
for (const file of files) {
  const text = await Bun.file(join(src, file)).text();
  const match = text.match(/^# (.+)\n/m);
  if (!match) throw new Error(`docs/${file}: no "# Title" heading`);
  const title = match[1].trim();
  let body = text.replace(match[0], "").replace(/^\s+/, "");

  // Rewrite links outside code blocks only
  body = body
    .split(/(```[\s\S]*?```)/)
    .map((part, i) => (i % 2 ? part : part.replace(/\]\(([^)\s]+)\)/g, (_, t) => `](${rewriteLink(t)})`)))
    .join("");

  const frontmatter = [
    "---",
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(firstParagraph(body))}`,
    `editUrl: ${REPO.replace("/blob/", "/edit/")}/docs/${file}`,
    "---",
    "",
  ].join("\n");
  await Bun.write(join(out, file), frontmatter + body);
}

console.log(`synced ${files.length} docs → src/content/docs/docs`);
