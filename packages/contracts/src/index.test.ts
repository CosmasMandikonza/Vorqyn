import { describe, expect, it } from "vitest";

import { CONTRACTS_STATUS } from "./index.js";

/**
 * VQ-00: proves the workspace test runner executes and the contracts
 * package is importable. Real contract behavior tests arrive in VQ-01.
 */
describe("@vorqyn/contracts scaffolding", () => {
  it("imports cleanly and reports the placeholder status", () => {
    expect(CONTRACTS_STATUS).toBe("scaffolding-pending-vq-01");
  });
});
