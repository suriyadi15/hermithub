// Loaded lazily: Monaco is several MB, only fetched when a file is opened.
import Editor, { loader, type OnMount } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import cssWorker from "monaco-editor/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/language/json/json.worker?worker";
import tsWorker from "monaco-editor/language/typescript/ts.worker?worker";
import { useEffect, useRef } from "react";
import type { Reveal } from "./PlainEditor";

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === "json") return new jsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new cssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};
// Self-hosted Monaco instead of the default CDN copy.
loader.config({ monaco });

// The editor is for browsing/editing, not type-checking: project deps are not loaded, so silence semantic errors.
const ts = (monaco as any).languages?.typescript;
for (const d of [ts?.typescriptDefaults, ts?.javascriptDefaults]) {
  d?.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
  d?.setCompilerOptions({ jsx: ts.JsxEmit?.React, allowJs: true, target: ts.ScriptTarget?.ESNext });
}

let lastReveal = 0;

export default function CodeEditor(props: {
  path: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  /** Jump to a line (e.g. a search hit); `seq` changes to re-trigger. */
  reveal?: Reveal;
  /** Changes whenever the toolbar's "find" button is pressed. */
  findSeq?: number;
}) {
  const saveRef = useRef(props.onSave);
  saveRef.current = props.onSave;
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  const doReveal = () => {
    const ed = editorRef.current;
    const r = props.reveal;
    // Each reveal (unique seq) is applied once, so switching back to a tab keeps the cursor where it was.
    // Tracked at module level so a remount (switching panes) does not jump again either.
    if (!ed || !r || r.seq <= lastReveal) return;
    lastReveal = r.seq;
    const [a, b] = r.cols ?? [0, 0];
    ed.setSelection(new monaco.Selection(r.line, a + 1, r.line, b + 1));
    ed.revealLineInCenter(r.line);
    ed.focus();
  };

  const onMount: OnMount = (editor, m) => {
    editorRef.current = editor;
    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => saveRef.current());
    editor.focus();
    doReveal();
  };

  // The child <Editor> swaps the model for `path` in its own effect, which runs before this one.
  useEffect(() => {
    requestAnimationFrame(doReveal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.reveal?.seq, props.path]);

  useEffect(() => {
    if (props.findSeq) editorRef.current?.getAction("actions.find")?.run();
  }, [props.findSeq]);

  return (
    <Editor
      theme="vs-dark"
      path={props.path}
      value={props.value}
      onChange={(v) => props.onChange(v ?? "")}
      onMount={onMount}
      options={{
        fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
        fontSize: 13,
        minimap: { enabled: window.innerWidth > 1024 },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        renderWhitespace: "selection",
        smoothScrolling: true,
      }}
    />
  );
}
