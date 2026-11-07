"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  browserRepository,
  DraftError,
  STORAGE_KEY,
  type LocalDraft,
  type Repository,
} from "@/lib/workspace-draft/storage";
import {
  emptyInput,
  sensitiveTitle,
  type DraftInput,
} from "@/lib/workspace-draft/schema";

function fresh(input = emptyInput()): LocalDraft {
  return {
    id: crypto.randomUUID(),
    revision: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    input,
    step: 0,
    complete: false,
    budgetLamports: null,
  };
}
export function useDrafts() {
  const [records, setRecords] = useState<LocalDraft[]>([]);
  const [editor, setEditor] = useState<LocalDraft | null>(null);
  const current = useRef<LocalDraft | null>(null);
  const repository = useRef<Repository | null>(null);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<DraftError | null>(null);
  const [conflict, setConflict] = useState(false);
  const conflicted = useRef(false);
  const [dirty, setDirty] = useState(false);
  const unsaved = useRef(false);
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const [mutation, setMutation] = useState(0);
  const [message, setMessage] = useState(
    "Choose a browser-local draft or start a new one.",
  );
  const working = useCallback((next: LocalDraft | null) => {
    current.current = next;
    setEditor(next);
  }, []);
  const markDirty = useCallback((value: boolean) => {
    unsaved.current = value;
    setDirty(value);
  }, []);
  const clearConflict = () => {
    conflicted.current = false;
    setConflict(false);
  };
  const report = useCallback((error: unknown) => {
    const next =
      error instanceof DraftError
        ? error
        : new DraftError(
            "storage",
            "Draft storage is unavailable. Keep this page open and retry.",
          );
    if (next.kind === "conflict") {
      conflicted.current = true;
      setConflict(true);
    } else setProblem(next);
    setMessage(next.message);
  }, []);
  const setUrl = (id?: string) => {
    const url = new URL(location.href);
    if (id) url.searchParams.set("draft", id);
    else url.searchParams.delete("draft");
    history.replaceState(history.state, "", url);
  };
  const allowSwitch = () =>
    !unsaved.current ||
    window.confirm(
      "Your latest changes are not saved in this browser. Leave those changes behind?",
    );

  useEffect(() => {
    try {
      repository.current = browserRepository();
      const saved = repository.current.read();
      setRecords(saved);
      const id = new URL(location.href).searchParams.get("draft");
      if (id) {
        const found = saved.find((d) => d.id === id);
        if (found) {
          working(found);
          setMessage("Reopened from this browser.");
        } else
          setMessage(
            "That draft is not stored in this browser. Choose a draft below.",
          );
      }
    } catch (error) {
      report(error);
    } finally {
      setReady(true);
    }
    const storageChanged = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      try {
        const saved = repository.current?.read();
        if (!saved) return;
        setRecords(saved);
        const active = current.current;
        if (
          active &&
          active.revision > 0 &&
          saved.find((d) => d.id === active.id)?.revision !== active.revision
        ) {
          conflicted.current = true;
          setConflict(true);
          setMessage(
            "This draft changed or was deleted in another tab. Your open changes are preserved.",
          );
        }
      } catch (error) {
        report(error);
      }
    };
    window.addEventListener("storage", storageChanged);
    return () => window.removeEventListener("storage", storageChanged);
  }, [report, working]);

  const persist = useCallback(
    async (complete = false) => {
      const original = current.current;
      if (!original || writing.current || conflicted.current) return;
      if (!repository.current) {
        report(
          new DraftError(
            "storage",
            "Saving is unavailable. Your changes are only in this open page.",
          ),
        );
        return;
      }
      if (sensitiveTitle(original.input.title)) {
        report(
          new DraftError(
            "validation",
            "Sensitive-looking information is blocked from storage. Change the draft title.",
          ),
        );
        return;
      }
      writing.current = true;
      setBusy(true);
      try {
        const saved = await repository.current.save(
          {
            id: original.id,
            input: original.input,
            step: original.step,
            complete,
          },
          original.revision,
        );
        const latest = current.current;
        if (latest?.id === original.id) {
          if (latest === original) {
            working(saved);
            markDirty(false);
            setMessage(
              complete
                ? "Draft reviewed and saved in this browser."
                : "Changes saved in this browser · Review required before final save.",
            );
          } else {
            working({
              ...latest,
              revision: saved.revision,
              createdAt: saved.createdAt,
            });
            setMutation((n) => n + 1);
          }
        }
        setRecords(repository.current.read());
        setProblem(null);
      } catch (error) {
        report(error);
      } finally {
        writing.current = false;
        setBusy(false);
      }
    },
    [markDirty, report, working],
  );

  useEffect(() => {
    if (!ready || !dirty || conflict || problem) return;
    const timer = setTimeout(() => {
      void persist(false);
    }, 450);
    return () => clearTimeout(timer);
  }, [mutation, ready, dirty, conflict, problem, persist]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (unsaved.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const click = (event: MouseEvent) => {
      const anchor =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (
        !anchor ||
        !unsaved.current ||
        (anchor.getAttribute("href") ?? "").startsWith("#")
      )
        return;
      if (
        !window.confirm(
          "Your latest changes are not saved in this browser. Leave this page?",
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const url = location.href,
      state = history.state;
    const back = (event: PopStateEvent) => {
      if (
        unsaved.current &&
        !window.confirm("Your latest changes are not saved. Leave this page?")
      ) {
        event.stopImmediatePropagation();
        history.pushState(state, "", url);
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    window.addEventListener("popstate", back, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
      window.removeEventListener("popstate", back, true);
    };
  }, [editor?.id]);

  function update(input: DraftInput) {
    const active = current.current;
    if (!active) return;
    working({ ...active, input, complete: false });
    markDirty(true);
    setMutation((n) => n + 1);
    setMessage("Unsaved changes · Saving shortly.");
    if (problem?.kind === "validation") setProblem(null);
  }
  function move(step: number) {
    const active = current.current;
    if (!active) return;
    working({ ...active, step });
    markDirty(true);
    setMutation((n) => n + 1);
  }
  function start() {
    if (!allowSwitch()) return;
    const draft = fresh();
    clearConflict();
    working(draft);
    setUrl(draft.id);
    markDirty(true);
    setMutation((n) => n + 1);
    setMessage("New local draft · Saving progress in this browser.");
  }
  function open(draft: LocalDraft) {
    if (!allowSwitch()) return;
    clearConflict();
    working(draft);
    setUrl(draft.id);
    markDirty(false);
    setMessage("Reopened from this browser.");
  }
  function close() {
    if (!allowSwitch()) return;
    clearConflict();
    working(null);
    setUrl();
    markDirty(false);
  }
  async function remove(draft: LocalDraft) {
    if (
      !window.confirm(
        `Delete “${draft.input.title.trim() || "Untitled draft"}” from this browser? This cannot be undone.`,
      )
    )
      return;
    try {
      await repository.current?.remove(draft.id, draft.revision);
      setRecords(repository.current?.read() ?? []);
      if (problem?.kind === "capacity" || problem?.kind === "storage") {
        setProblem(null);
        setMutation((n) => n + 1);
      }
      if (current.current?.id === draft.id) {
        working(null);
        setUrl();
        markDirty(false);
        clearConflict();
      }
      setMessage("Local draft deleted. Other drafts are unchanged.");
    } catch (error) {
      report(error);
    }
  }
  function reloadCopy() {
    if (
      unsaved.current &&
      !window.confirm(
        "Replace your open changes with the current browser copy?",
      )
    )
      return;
    try {
      const saved = repository.current?.read() ?? [];
      setRecords(saved);
      const found = saved.find((d) => d.id === current.current?.id);
      working(found ?? null);
      setUrl(found?.id);
      markDirty(false);
      clearConflict();
      setProblem(null);
      setMessage(
        found
          ? "Loaded the current browser copy."
          : "This draft was deleted in another tab.",
      );
    } catch (error) {
      report(error);
    }
  }
  function copy() {
    const active = current.current;
    if (!active) return;
    const draft = fresh(active.input);
    working(draft);
    setUrl(draft.id);
    clearConflict();
    markDirty(true);
    setMutation((n) => n + 1);
    setMessage(
      "Your changes are a new draft. The other tab’s copy is unchanged.",
    );
  }
  async function reset() {
    if (
      !window.confirm(
        "Reset all VORQYN local mission drafts in this browser? Unreadable or incompatible drafts will be permanently removed. Other browser data is untouched.",
      )
    )
      return;
    try {
      await repository.current?.reset();
      setRecords([]);
      setProblem(null);
      clearConflict();
      const active = current.current;
      if (active) {
        const replacement = fresh(active.input);
        working(replacement);
        setUrl(replacement.id);
        markDirty(true);
        setMutation((n) => n + 1);
      }
      setMessage("Local draft storage reset. You can start again.");
    } catch (error) {
      report(error);
    }
  }
  function retry() {
    try {
      repository.current = browserRepository();
      setRecords(repository.current.read());
      setProblem(null);
      setMutation((n) => n + 1);
      setMessage("Storage is available again.");
    } catch (error) {
      report(error);
    }
  }
  return {
    records,
    editor,
    ready,
    problem,
    conflict,
    dirty,
    busy,
    message,
    update,
    move,
    start,
    open,
    close,
    remove,
    reloadCopy,
    copy,
    reset,
    retry,
    persist,
  };
}
