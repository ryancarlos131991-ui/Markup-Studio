import { useEffect, useRef } from "react";
import { engine, useEngine } from "../app/engine";
import type { LogKind } from "../cli/types";

const LOG_COLORS: Record<LogKind, string> = {
  command: "text-ws-100",
  echo: "text-ws-400",
  info: "text-ws-300",
  result: "text-cmd-prompt",
  error: "text-cmd-error",
};

/**
 * AutoCAD-style command line. It is display-only: keystrokes are captured globally by
 * useGlobalKeyboard, so there's no input element to focus.
 */
export function CommandBar() {
  const snap = useEngine();
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [snap.log]);

  // Render the prompt with clickable [Keyword] options.
  const bracket = snap.prompt.indexOf(" [");
  const head = bracket >= 0 ? snap.prompt.slice(0, bracket) : snap.prompt.replace(/:$/, "");
  const tail = snap.prompt.slice(snap.prompt.lastIndexOf("]") + 1).replace(/:$/, "");

  return (
    <div className="shrink-0 border-t border-ws-700 bg-ws-950 font-mono text-xs">
      <div ref={logRef} className="h-[76px] overflow-y-auto px-3 py-1">
        {snap.log.map((l) => (
          <div key={l.id} className={`whitespace-pre-wrap leading-[17px] ${LOG_COLORS[l.kind]}`}>
            {l.text}
          </div>
        ))}
      </div>
      <div className="flex h-7 items-center whitespace-pre border-t border-ws-800 bg-ws-900 px-3">
        <span className="mr-1.5 text-cmd-prompt">{snap.activeCommand ? "›" : "⌘"}</span>
        <span className="text-ws-300">{head}</span>
        {bracket >= 0 && (
          <span className="text-ws-400">
            {" "}[
            {snap.keywords.map((k, i) => (
              <span key={k.key}>
                {i > 0 && "/"}
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => engine.chooseKeyword(k.key)}
                  className="text-cmd-kw hover:underline"
                >
                  {k.label}
                </button>
              </span>
            ))}
            ]
          </span>
        )}
        {bracket >= 0 && tail && <span className="text-ws-400">{tail}</span>}
        <span className="text-ws-300">: </span>
        <span className="text-cmd-input">{snap.buffer}</span>
        <span className="caret-blink inline-block h-3.5 w-[7px] bg-cmd-input" />
      </div>
    </div>
  );
}
