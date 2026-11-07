import { describe, expect, it } from "vitest";
import {
  parseSol,
  emptyInput,
  validate,
} from "../../lib/workspace-draft/schema";
import {
  createRepository,
  STORAGE_KEY,
} from "../../lib/workspace-draft/storage";
import { ZONES } from "../../lib/workspace-draft/metadata";

describe("exact planning budgets", () => {
  it("retains one-lamport precision without floating point", () => {
    expect(parseSol("0.000000001")).toBe("1");
    expect(parseSol("123456.123456789")).toBe("123456123456789");
  });
  it.each([
    "0",
    "-1",
    "NaN",
    "Infinity",
    "1e3",
    "0.0000000001",
    "1000000.000000001",
    "999999999999999999",
    "1.",
  ])("rejects %s", (value) => expect(() => parseSol(value)).toThrow());
});

export function validInput(title = "Basin survey") {
  return {
    ...emptyInput(),
    title,
    zoneIds: ["underwater_inspection"],
    sensors: { air: [], land: [], water: ["sonar"] },
    budgetSol: "2.000000001",
  };
}
function harness() {
  const memory = new Map<string, string>();
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
  };
  let queue = Promise.resolve();
  const lock = <T,>(operation: () => T): Promise<T> => {
    const result = queue.then(operation);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  return { memory, repo: createRepository(storage, lock) };
}

describe("private local repository", () => {
  it("saves distinct A/B drafts, edits A, rejects stale writes, and deletes only A", async () => {
    const { repo } = harness();
    const a = await repo.save(
      {
        id: crypto.randomUUID(),
        input: validInput("Mission A"),
        step: 4,
        complete: true,
      },
      0,
    );
    const b = await repo.save(
      {
        id: crypto.randomUUID(),
        input: { ...validInput("Mission B"), budgetSol: "7.5" },
        step: 4,
        complete: true,
      },
      0,
    );
    expect(repo.read()).toHaveLength(2);
    const edited = await repo.save(
      { ...a, input: { ...a.input, title: "Mission A edited" } },
      a.revision,
    );
    await expect(repo.save(a, a.revision)).rejects.toThrow(/another tab/i);
    expect(repo.read().find((d) => d.id === b.id)?.input.budgetSol).toBe("7.5");
    await repo.remove(edited.id, edited.revision);
    expect(repo.read().map((d) => d.id)).toEqual([b.id]);
  });
  it("is idempotent for repeated identical saves", async () => {
    const { repo } = harness();
    const command = {
      id: crypto.randomUUID(),
      input: validInput(),
      step: 4,
      complete: true,
    };
    const a = await repo.save(command, 0);
    const b = await repo.save(command, a.revision);
    expect(b.revision).toBe(a.revision);
    expect(repo.read()).toHaveLength(1);
  });
  it("serializes racing stale writes", async () => {
    const { repo } = harness();
    const a = await repo.save(
      {
        id: crypto.randomUUID(),
        input: validInput(),
        step: 0,
        complete: false,
      },
      0,
    );
    const results = await Promise.allSettled(
      ["One", "Two"].map((title) =>
        repo.save({ ...a, input: { ...a.input, title } }, a.revision),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it.each(["{broken", '{"version":99,"drafts":[]}'])(
    "blocks corrupt or future storage without overwriting it",
    async (raw) => {
      const { memory, repo } = harness();
      memory.set(STORAGE_KEY, raw);
      expect(() => repo.read()).toThrow();
      await expect(
        repo.save(
          {
            id: crypto.randomUUID(),
            input: validInput(),
            step: 0,
            complete: false,
          },
          0,
        ),
      ).rejects.toThrow();
      expect(memory.get(STORAGE_KEY)).toBe(raw);
      await repo.reset();
      expect(repo.read()).toEqual([]);
    },
  );
  it("blocks sensitive-looking titles before storing any bytes", async () => {
    const { repo, memory } = harness();
    await expect(
      repo.save(
        {
          id: crypto.randomUUID(),
          input: validInput("private key: example"),
          step: 0,
          complete: false,
        },
        0,
      ),
    ).rejects.toThrow(/sensitive/i);
    expect(memory.size).toBe(0);
  });
});

describe("planning validation", () => {
  it("rejects missing title, unknown zones and incompatible sensors", () => {
    expect(validate({ ...validInput(), title: "   " }).title).toBeTruthy();
    expect(
      validate({ ...validInput(), zoneIds: ["invented"] }).zones,
    ).toBeTruthy();
    expect(
      validate({
        ...validInput(),
        sensors: { air: ["sonar"], land: [], water: [] },
      }).machines,
    ).toBeTruthy();
  });
  it("rejects contradictory evidence requirements and exact threshold violations", () => {
    expect(
      validate({
        ...validInput(),
        sensors: { air: [], land: [], water: ["optical"] },
      }).waterEvidence,
    ).toBeTruthy();
    expect(
      validate({ ...validInput(), minCoverage: "101" }).minCoverage,
    ).toBeTruthy();
  });
  it("uses actual port metadata without exposing other templates", () => {
    expect(ZONES.some((z) => z.id === "pier_c_deck" && z.damaged)).toBe(true);
    expect(validate(validInput())).toEqual({});
  });
});

it("accepts the explicit planning ceiling and preserves trailing-zero decimal intent", () => {
  expect(parseSol("1000000")).toBe("1000000000000000");
  expect(parseSol("2.100000000")).toBe("2100000000");
});
it("preserves partial invalid input while rejecting final review until valid", async () => {
  const { repo } = harness();
  const command = {
    id: crypto.randomUUID(),
    input: emptyInput(),
    step: 0,
    complete: false,
  };
  const draft = await repo.save(command, 0);
  expect(repo.read()[0]?.input.title).toBe("");
  await expect(
    repo.save({ ...draft, complete: true }, draft.revision),
  ).rejects.toThrow(/invalid settings/);
});
it("rejects extra input properties and never persists unexpected command properties", async () => {
  const { repo, memory } = harness();
  const command = {
    id: crypto.randomUUID(),
    input: validInput(),
    step: 0,
    complete: false,
    credentials: "must not persist",
  };
  await repo.save(command, 0);
  expect(memory.get(STORAGE_KEY)).not.toContain("credentials");
  await expect(
    repo.save(
      {
        ...command,
        id: crypto.randomUUID(),
        input: { ...validInput(), credentials: "blocked" } as ReturnType<
          typeof validInput
        >,
      },
      0,
    ),
  ).rejects.toThrow(/invalid settings/);
});
it("bounds record count and serialized size", async () => {
  const { repo, memory } = harness();
  for (let index = 0; index < 20; index++)
    await repo.save(
      {
        id: crypto.randomUUID(),
        input: validInput(`Brief ${index}`),
        step: 0,
        complete: false,
      },
      0,
    );
  await expect(
    repo.save(
      {
        id: crypto.randomUUID(),
        input: validInput(),
        step: 0,
        complete: false,
      },
      0,
    ),
  ).rejects.toThrow(/20 drafts/);
  memory.set(STORAGE_KEY, " ".repeat(65537));
  expect(() => repo.read()).toThrow(/size/);
});
it("detects tampered lamports and zones before rendering or overwriting", async () => {
  const { repo, memory } = harness();
  await repo.save(
    { id: crypto.randomUUID(), input: validInput(), step: 4, complete: true },
    0,
  );
  const value = JSON.parse(memory.get(STORAGE_KEY)!);
  value.drafts[0].budgetLamports = "1";
  memory.set(STORAGE_KEY, JSON.stringify(value));
  expect(() => repo.read()).toThrow(/invalid fields/);
  value.drafts[0].budgetLamports = "2000000001";
  value.drafts[0].input.zoneIds = ["unknown-zone"];
  memory.set(STORAGE_KEY, JSON.stringify(value));
  expect(() => repo.read()).toThrow(/invalid fields/);
});
it("keeps quota and read failures explicit instead of reporting a save", async () => {
  const lock = async <T,>(operation: () => T) => operation();
  const repo = createRepository(
    {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("Quota", "QuotaExceededError");
      },
      removeItem: () => {},
    },
    lock,
  );
  await expect(
    repo.save(
      {
        id: crypto.randomUUID(),
        input: validInput(),
        step: 0,
        complete: false,
      },
      0,
    ),
  ).rejects.toThrow(/could not save/);
  const blocked = createRepository(
    {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
      removeItem: () => {},
    },
    lock,
  );
  expect(() => blocked.read()).toThrow(/unavailable/);
});
it("does not reset valid data, and a corruption reset leaves unrelated keys intact", async () => {
  const { repo, memory } = harness();
  await expect(repo.reset()).rejects.toThrow(/readable now/);
  memory.set("vorqyn-theme", "dark");
  memory.set(STORAGE_KEY, "broken");
  await repo.reset();
  expect(memory.get("vorqyn-theme")).toBe("dark");
});
it("rejects incompatible objective/region and modality/sensor combinations", () => {
  expect(validate({ ...validInput(), objective: "ground" }).zones).toBeTruthy();
  expect(
    validate({
      ...validInput(),
      objective: "submerged",
      sensors: { air: [], land: [], water: ["optical"] },
    }).machines,
  ).toBeTruthy();
  expect(
    validate({
      ...validInput(),
      zoneIds: ["road_trunk"],
      sensors: { air: [], land: ["camera"], water: [] },
    }).machines,
  ).toBeTruthy();
});
