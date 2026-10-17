// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightLinksValidator from "starlight-links-validator";

const repo = "https://github.com/suriyadi15/project-hub";

export default defineConfig({
  site: "https://projecthubapp.pages.dev",
  integrations: [
    starlight({
      title: "Project Hub",
      description:
        "A self-hosted web dashboard for your code projects and AI coding agents: Claude Code, Codex CLI, Gemini CLI, OpenCode and more.",
      logo: { src: "./public/favicon.svg" },
      favicon: "/favicon.svg",
      social: [{ icon: "github", label: "GitHub", href: repo }],
      editLink: { baseUrl: `${repo}/edit/main/` },
      customCss: ["./src/styles/theme.css"],
      plugins: [starlightLinksValidator({ errorOnLocalLinks: false })],
      sidebar: [
        {
          label: "Getting started",
          items: ["docs/installation", "docs/ai-install", "docs/configuration"],
        },
        {
          label: "Using Project Hub",
          items: ["docs/agents", "docs/worktrees", "docs/github", "docs/reverse-proxy"],
        },
        { label: "Reference", items: ["docs/security", "docs/advanced"] },
        { label: "Contributing", items: ["docs/development", "docs/adding-an-agent"] },
      ],
    }),
  ],
});
