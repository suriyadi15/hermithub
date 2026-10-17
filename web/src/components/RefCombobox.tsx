import { GitBranch, GitCommitHorizontal, Globe, Tag, type LucideIcon } from "lucide-react";
import { Popover } from "radix-ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { ago } from "@/lib/format";
import { useRefs } from "@/lib/queries";
import { cn } from "@/lib/utils";

const PER_GROUP = 20;

type Option = { value: string; detail: string; date: number; icon: LucideIcon };

/**
 * Pick what a new worktree starts from: a branch, tag or commit, with autocomplete.
 * Free text is allowed too (e.g. a full hash); "" means the project's current HEAD.
 */
export function RefCombobox(props: {
  project: string;
  value: string;
  onChange: (ref: string) => void;
  enabled?: boolean;
  /** What "" resolves to, e.g. the project folder's branch. */
  defaultLabel: string;
  id?: string;
  className?: string;
}) {
  const refs = useRefs(props.project, props.enabled ?? true);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => {
    const d = refs.data;
    if (!d) return [];
    const f = props.value.trim().toLowerCase();
    const match = (...s: string[]) => !f || s.some((x) => x.toLowerCase().includes(f));
    const localNames = new Set(d.branches.filter((b) => !b.remote).map((b) => b.name));
    const pick = (label: string, opts: Option[]) => ({
      label,
      options: opts.filter((o) => match(o.value, o.detail)).slice(0, PER_GROUP),
    });
    return [
      pick(
        "Branches",
        d.branches.filter((b) => !b.remote).map((b) => ({ value: b.name, detail: b.subject, date: b.date, icon: GitBranch })),
      ),
      // Remote branches that already have a local counterpart add nothing to start from.
      pick(
        "Remote",
        d.branches
          .filter((b) => b.remote && !localNames.has(b.name.slice(b.name.indexOf("/") + 1)))
          .map((b) => ({ value: b.name, detail: b.subject, date: b.date, icon: Globe })),
      ),
      pick("Tags", d.tags.map((t) => ({ value: t.name, detail: t.subject, date: t.date, icon: Tag }))),
      pick(
        "Commits",
        d.commits.map((c) => ({ value: c.hash, detail: c.subject, date: c.date, icon: GitCommitHorizontal })),
      ),
    ].filter((g) => g.options.length > 0);
  }, [refs.data, props.value]);

  const flat = groups.flatMap((g) => g.options);
  useEffect(() => setActive(0), [props.value]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (o: Option) => {
    props.onChange(o.value);
    setOpen(false);
  };

  let index = 0;
  return (
    <Popover.Root open={open && (flat.length > 0 || refs.isLoading)} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <Input
          ref={inputRef}
          id={props.id}
          className={cn("font-mono", props.className)}
          placeholder={`${props.defaultLabel} (current)`}
          title="Start from this branch, tag or commit"
          autoComplete="off"
          spellCheck={false}
          value={props.value}
          maxLength={200}
          onChange={(e) => {
            props.onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              if (!open) return setOpen(true);
              const n = flat.length;
              if (n) setActive((a) => (a + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
            } else if (e.key === "Enter" && open && flat[active]) {
              e.preventDefault();
              choose(flat[active]!);
            } else if (e.key === "Escape" && open) {
              // Close the list only, not the surrounding dialog.
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }
          }}
        />
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(e) => e.preventDefault()}
          // Clicks on the input itself should not count as "outside" and close the list.
          onInteractOutside={(e) => {
            if (e.target === inputRef.current) e.preventDefault();
          }}
          className="z-50 max-h-72 w-(--radix-popover-trigger-width) min-w-72 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <div ref={listRef}>
            {refs.isLoading && <p className="px-2 py-1.5 text-sm text-muted-foreground">Loading…</p>}
            {groups.map((g) => (
              <div key={g.label}>
                <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</div>
                {g.options.map((o) => {
                  const i = index++;
                  const Icon = o.icon;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      data-index={i}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm max-md:py-2",
                        i === active && "bg-accent text-accent-foreground",
                      )}
                      onMouseEnter={() => setActive(i)}
                      // Keep focus in the input while picking.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(o)}
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono">{o.value}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {ago(o.date)}
                          {o.detail && ` · ${o.detail}`}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
