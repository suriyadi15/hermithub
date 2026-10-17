import { ExternalLink, MoreVertical, Pencil, RotateCw, Square, SquareArrowOutUpRight } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Session } from "@/lib/api";
import { duration } from "@/lib/format";
import { useModes } from "@/lib/modes";
import { useKillSession, useRenameSession, useRestartSession } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { ConfirmDialog, PromptDialog } from "./dialogs";

export function StatusDot({ status }: { status: Session["status"] }) {
  return (
    <span className="relative flex size-2.5" title={status}>
      {status === "active" && <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />}
      <span
        className={cn(
          "relative inline-flex size-2.5 rounded-full",
          status === "active" && "bg-success",
          status === "idle" && "bg-warning",
          status === "exited" && "bg-muted-foreground/50",
        )}
      />
    </span>
  );
}

const STATUS_LABEL = { active: "active", idle: "waiting", exited: "exited" } as const;

export function ModeBadge({ mode }: { mode: Session["mode"] }) {
  const info = useModes().info(mode);
  const Icon = info.icon;
  return (
    <Badge variant="outline" className={cn("gap-1 font-normal", info.className)}>
      <Icon className="size-3" />
      {info.short}
    </Badge>
  );
}

export function SessionActions({ session, onOpen }: { session: Session; onOpen?: () => void }) {
  const kill = useKillSession();
  const restart = useRestartSession();
  const rename = useRenameSession();
  const [confirmKill, setConfirmKill] = useState(false);
  const [renaming, setRenaming] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="size-9 shrink-0 sm:size-8">
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {onOpen && (
            <DropdownMenuItem onClick={onOpen}>
              <SquareArrowOutUpRight /> Open terminal
            </DropdownMenuItem>
          )}
          {session.remoteUrl && (
            <DropdownMenuItem asChild>
              <a href={session.remoteUrl} target="_blank" rel="noreferrer">
                <ExternalLink /> Open in claude.ai
              </a>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setRenaming(true)}>
            <Pencil /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => restart.mutate(session.name)}>
            <RotateCw /> {session.mode === "bash" ? "Restart" : "Restart (continue conversation)"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setConfirmKill(true)}>
            <Square /> Stop session
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirmKill}
        onOpenChange={setConfirmKill}
        title="Stop session?"
        description={`The process in "${session.label}" (${session.project}) will be stopped. The conversation is kept and can be continued later.`}
        confirmLabel="Stop"
        destructive
        onConfirm={() => kill.mutate(session.name)}
      />
      <PromptDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename session"
        label="Label"
        initial={session.label}
        onSubmit={(label) => rename.mutate({ name: session.name, label }, { onSuccess: () => setRenaming(false) })}
      />
    </>
  );
}

export function SessionCard({ session, now }: { session: Session; now: number }) {
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-2 px-3 pt-3">
        <StatusDot status={session.status} />
        <Link
          to={`/p/${encodeURIComponent(session.project)}?s=${session.name}`}
          className="min-w-0 flex-1 truncate font-medium hover:underline"
        >
          {session.label}
        </Link>
        <ModeBadge mode={session.mode} />
        <SessionActions session={session} />
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 pt-1 text-xs text-muted-foreground">
        <span className="max-w-full truncate">{session.project}</span>
        <span>{STATUS_LABEL[session.status]}</span>
        <span>{duration(now - session.created)}</span>
        {session.status !== "exited" && (
          <span>
            {session.cpu}% · {session.memMB} MB
          </span>
        )}
        {session.permission && session.mode !== "bash" && session.permission !== "default" && (
          <span className="text-warning">{session.permission}</span>
        )}
      </div>
      <Link to={`/p/${encodeURIComponent(session.project)}?s=${session.name}`} className="group mt-2 block">
        <pre className="h-20 overflow-hidden whitespace-pre-wrap break-all bg-terminal px-3 py-2 font-mono text-[11px] leading-snug text-zinc-400 group-hover:text-zinc-200 sm:h-24">
          {session.preview || " "}
        </pre>
      </Link>
      {session.mode === "rc" && (
        <div className="border-t px-3 py-2.5 text-sm sm:py-2 sm:text-xs">
          {session.remoteUrl ? (
            <a
              href={session.remoteUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-info hover:underline"
            >
              <ExternalLink className="size-3" /> Open in claude.ai/code
            </a>
          ) : (
            <span className="text-muted-foreground">Waiting for the remote control link…</span>
          )}
        </div>
      )}
    </div>
  );
}
