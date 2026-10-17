import { useEffect, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ConfirmDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  /** Extra options shown above the buttons. */
  children?: ReactNode;
}) {
  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          {props.description && <AlertDialogDescription>{props.description}</AlertDialogDescription>}
        </AlertDialogHeader>
        {props.children}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={props.destructive ? "bg-destructive text-white hover:bg-destructive/90" : undefined}
            onClick={props.onConfirm}
          >
            {props.confirmLabel ?? "Yes"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function PromptDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  label: string;
  initial?: string;
  confirmLabel?: string;
  pending?: boolean;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(props.initial ?? "");
  useEffect(() => {
    if (props.open) setValue(props.initial ?? "");
  }, [props.open, props.initial]);
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) props.onSubmit(value.trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>{props.title}</DialogTitle>
            {props.description && <DialogDescription>{props.description}</DialogDescription>}
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="prompt-input">{props.label}</Label>
            <Input
              id="prompt-input"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onFocus={(e) => {
                const dot = e.target.value.lastIndexOf(".");
                e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length);
              }}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!value.trim() || props.pending}>
              {props.confirmLabel ?? "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
