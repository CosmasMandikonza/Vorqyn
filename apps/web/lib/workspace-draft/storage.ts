import {
  budgetOf,
  isInput,
  LIMITS,
  sensitiveTitle,
  validate,
  type DraftInput,
} from "./schema";
export const STORAGE_KEY = "vorqyn.local-mission-drafts";
export const LOCK_NAME = "vorqyn.local-mission-drafts.write";
export interface LocalDraft {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  input: DraftInput;
  step: number;
  complete: boolean;
  budgetLamports: string | null;
}
export type DraftCommand = Pick<
  LocalDraft,
  "id" | "input" | "step" | "complete"
>;
export class DraftError extends Error {
  constructor(
    public kind:
      | "storage"
      | "corrupt"
      | "version"
      | "conflict"
      | "validation"
      | "capacity",
    message: string,
  ) {
    super(message);
    this.name = "DraftError";
  }
}
const uuid = (id: unknown): id is string =>
  typeof id === "string" &&
  /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(
    id,
  );
const timestamp = (value: unknown) =>
  typeof value === "string" &&
  /^\d{4}-\d\d-\d\dT/.test(value) &&
  Number.isFinite(Date.parse(value));
function decode(raw: string | null): LocalDraft[] {
  if (raw === null) return [];
  if (raw.length * 2 > LIMITS.bytes)
    throw new DraftError(
      "corrupt",
      "Local draft data exceeds the supported size. Nothing was overwritten.",
    );
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new DraftError(
      "corrupt",
      "Local draft data is not readable JSON. Nothing was overwritten.",
    );
  }
  if (!value || typeof value !== "object" || !("version" in value))
    throw new DraftError(
      "corrupt",
      "Local draft data has an invalid structure.",
    );
  if (value.version !== 1)
    throw new DraftError(
      "version",
      "These local drafts use an unsupported schema version. Open them with a compatible app, or explicitly reset this browser’s drafts.",
    );
  if (
    Object.keys(value).sort().join(",") !== "drafts,version" ||
    !("drafts" in value) ||
    !Array.isArray(value.drafts) ||
    value.drafts.length > LIMITS.records
  )
    throw new DraftError("corrupt", "The local draft collection is invalid.");
  const ids = new Set<string>();
  for (const item of value.drafts) {
    const d = item as Partial<LocalDraft> | null;
    if (
      !d ||
      typeof d !== "object" ||
      Object.keys(d).sort().join(",") !==
        "budgetLamports,complete,createdAt,id,input,revision,step,updatedAt" ||
      !uuid(d.id) ||
      ids.has(d.id) ||
      !Number.isSafeInteger(d.revision) ||
      d.revision! < 1 ||
      d.revision! >= Number.MAX_SAFE_INTEGER ||
      !timestamp(d.createdAt) ||
      !timestamp(d.updatedAt) ||
      !Number.isInteger(d.step) ||
      d.step! < 0 ||
      d.step! > 4 ||
      typeof d.complete !== "boolean" ||
      !isInput(d.input) ||
      d.budgetLamports !== budgetOf(d.input) ||
      (d.complete && Object.keys(validate(d.input)).length)
    )
      throw new DraftError(
        "corrupt",
        "A local draft contains unsupported or invalid fields. Nothing was overwritten.",
      );
    ids.add(d.id);
  }
  return value.drafts as LocalDraft[];
}
export type Exclusive = <T>(operation: () => T) => Promise<T>;
export function createRepository(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  exclusive: Exclusive,
) {
  function readRaw() {
    try {
      return storage.getItem(STORAGE_KEY);
    } catch {
      throw new DraftError(
        "storage",
        "Browser storage is unavailable. Your changes remain only in this open page.",
      );
    }
  }
  function read() {
    return decode(readRaw());
  }
  function write(drafts: LocalDraft[]) {
    const encoded = JSON.stringify({ version: 1, drafts });
    if (encoded.length * 2 > LIMITS.bytes)
      throw new DraftError(
        "capacity",
        "Browser draft storage is full. Delete a draft before saving another.",
      );
    try {
      storage.setItem(STORAGE_KEY, encoded);
    } catch {
      throw new DraftError(
        "storage",
        "The browser could not save these changes. Storage may be blocked or full. Keep this page open and retry.",
      );
    }
  }
  return {
    read,
    save(command: DraftCommand, expectedRevision: number) {
      return exclusive(() => {
        const drafts = read();
        if (sensitiveTitle(command.input.title))
          throw new DraftError(
            "validation",
            "Sensitive-looking information is blocked from browser storage. Change the draft title.",
          );
        if (
          !uuid(command.id) ||
          !isInput(command.input) ||
          !Number.isInteger(command.step) ||
          command.step < 0 ||
          command.step > 4 ||
          typeof command.complete !== "boolean" ||
          (command.complete && Object.keys(validate(command.input)).length)
        )
          throw new DraftError(
            "validation",
            "The draft has invalid settings. Review the highlighted fields before saving.",
          );
        const current = drafts.find((d) => d.id === command.id);
        if ((current?.revision ?? 0) !== expectedRevision)
          throw new DraftError(
            "conflict",
            "This draft changed or was deleted in another tab. Load the browser copy or keep your changes as a new draft.",
          );
        if (
          current &&
          JSON.stringify(current.input) === JSON.stringify(command.input) &&
          current.step === command.step &&
          current.complete === command.complete
        )
          return current;
        if (!current && drafts.length >= LIMITS.records)
          throw new DraftError(
            "capacity",
            `This browser holds ${LIMITS.records} drafts. Delete one before creating another.`,
          );
        const now = new Date().toISOString();
        const next: LocalDraft = {
          id: command.id,
          input: command.input,
          step: command.step,
          complete: command.complete,
          revision: (current?.revision ?? 0) + 1,
          createdAt: current?.createdAt ?? now,
          updatedAt: now,
          budgetLamports: budgetOf(command.input),
        };
        write([...drafts.filter((d) => d.id !== next.id), next]);
        return next;
      });
    },
    remove(id: string, expectedRevision: number) {
      return exclusive(() => {
        const drafts = read();
        const current = drafts.find((d) => d.id === id);
        if (!current || current.revision !== expectedRevision)
          throw new DraftError(
            "conflict",
            "This draft changed in another tab. Reload the browser copy before deleting.",
          );
        write(drafts.filter((d) => d.id !== id));
      });
    },
    reset() {
      return exclusive(() => {
        const raw = readRaw();
        try {
          decode(raw);
        } catch (error) {
          if (
            error instanceof DraftError &&
            ["corrupt", "version"].includes(error.kind)
          ) {
            try {
              storage.removeItem(STORAGE_KEY);
              return;
            } catch {
              throw new DraftError(
                "storage",
                "Browser storage is still blocked.",
              );
            }
          }
          throw error;
        }
        throw new DraftError(
          "conflict",
          "Storage is readable now. Reload the list instead of resetting it.",
        );
      });
    },
  };
}
export type Repository = ReturnType<typeof createRepository>;
export function browserRepository(): Repository {
  // Web Locks serializes read/compare/write across tabs; do not promise atomic localStorage alone.
  if (!navigator.locks)
    throw new DraftError(
      "storage",
      "This browser cannot safely coordinate draft writes across tabs. Use a current browser with Web Locks support.",
    );
  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch {
    throw new DraftError(
      "storage",
      "Browser storage is disabled. Planning can continue in this page, but saving and reload recovery are unavailable.",
    );
  }
  return createRepository(storage, (operation) =>
    navigator.locks.request(LOCK_NAME, operation),
  );
}
