// @vitest-environment jsdom
// Only the web components render React into a DOM; the rest of the repo stays on plain `node`,
// so the environment is declared per-file rather than globally.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TARGET_CONFLICT_GLOSSARY, type TargetConflict } from "@app/shared";
import { TargetConflictBanner } from "./TargetConflictBanner.js";

afterEach(cleanup);

const conflict = (over: Partial<TargetConflict> = {}): TargetConflict => ({
  code: "MULTIPLE_UPCOMING",
  message: "Two broadcasts are ready; the encoder decides which one airs.",
  ids: ["abc123", "def456"],
  ...over,
});

describe("TargetConflictBanner", () => {
  it("titles the banner from the canonical glossary, not from inline copy", () => {
    render(<TargetConflictBanner conflict={conflict()} onRefresh={() => {}} refreshing={false} />);

    expect(screen.getByText(TARGET_CONFLICT_GLOSSARY.MULTIPLE_UPCOMING.label)).toBeDefined();
    expect(
      screen.getByText("Two broadcasts are ready; the encoder decides which one airs."),
    ).toBeDefined();
  });

  it("hands over every broadcast id, because deleting the stray is the operator's only fix", () => {
    render(<TargetConflictBanner conflict={conflict()} onRefresh={() => {}} refreshing={false} />);

    const ids = screen.getByRole("list", { name: "Broadcasts involved" });
    expect(ids.textContent).toContain("abc123");
    expect(ids.textContent).toContain("def456");
  });

  it("omits the id list entirely when the conflict names no broadcasts", () => {
    render(
      <TargetConflictBanner conflict={conflict({ ids: [] })} onRefresh={() => {}} refreshing={false} />,
    );

    expect(screen.queryByRole("list")).toBeNull();
  });

  it("re-checks on demand", () => {
    const onRefresh = vi.fn();
    render(<TargetConflictBanner conflict={conflict()} onRefresh={onRefresh} refreshing={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Re-check" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("disables the button while a check is in flight so it cannot be double-fired", () => {
    const onRefresh = vi.fn();
    render(<TargetConflictBanner conflict={conflict()} onRefresh={onRefresh} refreshing={true} />);

    const button = screen.getByRole("button", { name: "Checking…" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("announces itself as status, never as an alert — a target conflict is amber, not red", () => {
    render(<TargetConflictBanner conflict={conflict()} onRefresh={() => {}} refreshing={false} />);

    expect(screen.getByRole("status")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
