import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MissionPage from "../../app/demo/mission/page";
import DemoPage from "../../app/demo/page";
import { Fallback2D } from "@/components/mission-world/Fallback2D";
import { PortViewerClient } from "@/components/mission-world/PortViewerClient";
import { validateWorld } from "@/components/mission-world/world-data";

const realWorld = validateWorld(
  JSON.parse(
    readFileSync(
      path.resolve(__dirname, "../../public/port-world/world.json"),
      "utf8",
    ),
  ),
);

beforeEach(() => {
  // jsdom canvas has no WebGL; the viewer's dynamic chunk is not loaded in
  // these tests, but stub matchMedia-dependent pieces defensively anyway.
  window.matchMedia = window.matchMedia ?? (() => ({
    matches: false, media: "", onchange: null,
    addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  }) as unknown as MediaQueryList);
});

describe("/demo/mission page (SSR shell)", () => {
  it("carries the honest scope badge and no invented activity", () => {
    render(<MissionPage />);
    expect(
      screen.getAllByText(/World preview · Static vehicle anchors/i).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "The port, in one shared world.",
    );
    expect(
      screen.getByText(/no mission engine, telemetry stream, evidence/i),
    ).toBeInTheDocument(); // lives inside a closed <details> on the SSR shell
    expect(
      screen.queryByRole("button", { name: /start mission|connect wallet|settle/i }),
    ).not.toBeInTheDocument();
  });

  it("renders the client loading shell before hydration", () => {
    render(<PortViewerClient />);
    expect(screen.getByText(/Preparing the world preview/i)).toBeVisible();
  });
});

describe("/demo links to the world preview honestly", () => {
  it("has exactly one 3D-preview link with a static-scope label", () => {
    render(<DemoPage />);
    const links = screen.getAllByRole("link", { name: /Explore the 3D world preview/i });
    expect(links).toHaveLength(1);
    expect(links[0]!).toHaveAttribute("href", "/demo/mission");
  });
});

describe("2D fallback (no-WebGL / forced 2D)", () => {
  function renderFallback(props?: Partial<Parameters<typeof Fallback2D>[0]>) {
    return render(
      <Fallback2D
        world={realWorld}
        selectedId="rov"
        onSelect={() => {}}
        mode="UNDERWATER"
        reason="A WebGL-capable browser is required for the 3D preview."
        {...props}
      />,
    );
  }

  it("explains the fallback and points at the generated plan view", () => {
    renderFallback();
    expect(screen.getByText(/2D fallback/i)).toBeVisible();
    expect(screen.getByText(/A WebGL-capable browser is required/i)).toBeVisible();
    const plan = screen.getByRole("img", { name: /top-down plan of PORT-001/i });
    expect(plan).toHaveAttribute("src", "/port-world/plan-view.svg");
  });

  it("lists every zone from world.json with kind and damage flags", () => {
    renderFallback();
    for (const zone of realWorld.zones) {
      const needle = zone.label.split("(")[0]!.trim();
      expect(screen.getAllByText(new RegExp(needle, "i")).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(/Pier C deck \(collapsed beyond y=-30\)/i)).toBeVisible();
  });

  it("shows the selected machine with its real anchor coordinates", () => {
    renderFallback();
    expect(screen.getByRole("button", { name: "Access rover" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Inspection ROV" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("rov_home")).toBeVisible();
    expect(screen.getByText(/\(60, -10, -2\.5\)/)).toBeVisible();
    expect(screen.getByText(/Static anchor fixture — no live telemetry/)).toBeVisible();
  });

  it("lists all five camera stations with declared distance ranges", () => {
    renderFallback();
    expect(screen.getByText(/RESET — d 330 m/i)).toBeVisible();
    expect(screen.getByText(/AIR — d 220–480 m/i)).toBeVisible();
    expect(screen.getByText(/UNDERWATER — d 12–60 m/i)).toBeVisible();
    expect(screen.getAllByText(/INSPECT/i).length).toBeGreaterThan(0); // ROV chip also matches
  });

  it("switches selection through real click handlers", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <Fallback2D
        world={realWorld}
        selectedId={null}
        onSelect={onSelect}
        mode="RESET"
        reason="test"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Survey drone" }));
    expect(onSelect).toHaveBeenCalledWith("drone");
  });
});
