import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Preset, PresetActionResult } from "../api.js";
import { PresetFillModal } from "./PresetFillModal.js";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const preset = (over: Partial<Preset> = {}): Preset => ({
  id: "p1",
  title: "Friday — {topic}",
  slug: "friday",
  description: "Speaker: {speaker|the imam}",
  privacyStatus: "public",
  category: null,
  streamBoundId: null,
  titleFallback: null,
  descriptionFallback: null,
  ...over,
});

const ok: PresetActionResult = { success: true };
const fireOk = () =>
  vi.fn<(presetId: string, vars: Record<string, string>) => Promise<PresetActionResult>>(
    async () => ok,
  );

const input = (name: string) => screen.getByLabelText(new RegExp(`^${name}`)) as HTMLInputElement;

describe("PresetFillModal", () => {
  it("renders one input per detected variable", () => {
    render(<PresetFillModal preset={preset()} fire={fireOk()} onClose={() => {}} />);

    expect(input("topic")).toBeDefined();
    expect(input("speaker")).toBeDefined();
  });

  it("greys the inline default as the placeholder, and marks a bare variable required", () => {
    render(<PresetFillModal preset={preset()} fire={fireOk()} onClose={() => {}} />);

    expect(input("speaker").placeholder).toBe("the imam");
    expect(input("topic").placeholder).toBe("required");
  });

  it("calls a variable optional once its field carries a whole-sentence fallback", () => {
    render(
      <PresetFillModal
        preset={preset({ titleFallback: "Friday prayer" })}
        fire={fireOk()}
        onClose={() => {}}
      />,
    );

    expect(input("topic").placeholder).toBe("leave blank for fallback");
  });

  describe("the live preview", () => {
    it("mirrors the resolved title and description as the operator types", () => {
      render(<PresetFillModal preset={preset()} fire={fireOk()} onClose={() => {}} />);

      fireEvent.change(input("topic"), { target: { value: "Patience" } });

      expect(screen.getByText("Friday — Patience")).toBeDefined();
      // Untouched, so the inline default resolves in the preview.
      expect(screen.getByText("Speaker: the imam")).toBeDefined();
    });

    it("warns about a variable with no value and no fallback, before the action is fired", () => {
      render(<PresetFillModal preset={preset()} fire={fireOk()} onClose={() => {}} />);

      expect(screen.getByText(/topic.*has no value and no fallback/)).toBeDefined();
    });

    it("drops the warning once the variable is answered", () => {
      render(<PresetFillModal preset={preset()} fire={fireOk()} onClose={() => {}} />);

      fireEvent.change(input("topic"), { target: { value: "Patience" } });
      expect(screen.queryByText(/no value and no fallback/)).toBeNull();
    });
  });

  describe("applying", () => {
    it("sends only the values that were actually typed, so blanks fall to their defaults", async () => {
      const fire = fireOk();
      render(<PresetFillModal preset={preset()} fire={fire} onClose={() => {}} />);

      fireEvent.change(input("topic"), { target: { value: "Patience" } });
      fireEvent.change(input("speaker"), { target: { value: "   " } });
      fireEvent.click(screen.getByRole("button", { name: "Apply now" }));

      await waitFor(() => expect(fire).toHaveBeenCalledWith("p1", { topic: "Patience" }));
    });

    it("closes on success — an inline 'Applied' line reads as nothing happening mid-show", async () => {
      const onClose = vi.fn();
      render(<PresetFillModal preset={preset()} fire={fireOk()} onClose={onClose} />);

      fireEvent.click(screen.getByRole("button", { name: "Apply now" }));

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });

    it("keeps the dialog open with the values intact when the action fails", async () => {
      const onClose = vi.fn();
      const fire = vi.fn(async (): Promise<PresetActionResult> => ({
        success: false,
        error: { code: "MISSING_TEMPLATE_VARS", message: "topic is missing" },
      }));
      render(<PresetFillModal preset={preset()} fire={fire} onClose={onClose} />);

      fireEvent.change(input("topic"), { target: { value: "Patience" } });
      fireEvent.click(screen.getByRole("button", { name: "Apply now" }));

      expect(await screen.findByText("topic is missing")).toBeDefined();
      expect(onClose).not.toHaveBeenCalled();
      expect(input("topic").value).toBe("Patience");
    });

    it("reports a thrown network error rather than dying silently", async () => {
      const fire = vi.fn(async (): Promise<PresetActionResult> => {
        throw new Error("Failed to fetch");
      });
      render(<PresetFillModal preset={preset()} fire={fire} onClose={() => {}} />);

      fireEvent.click(screen.getByRole("button", { name: "Apply now" }));

      expect(await screen.findByText("Failed to fetch")).toBeDefined();
    });

    it("re-enables the apply button after a failure so the fill can be corrected and retried", async () => {
      const fire = vi.fn(async (): Promise<PresetActionResult> => ({
        success: false,
        error: { code: "X", message: "nope" },
      }));
      render(<PresetFillModal preset={preset()} fire={fire} onClose={() => {}} />);

      fireEvent.click(screen.getByRole("button", { name: "Apply now" }));
      await screen.findByText("nope");

      const apply = screen.getByRole("button", { name: "Apply now" }) as HTMLButtonElement;
      expect(apply.disabled).toBe(false);
    });
  });

  describe("last-used values", () => {
    it("prefills from the last successful fill of this preset", async () => {
      const onClose = vi.fn();
      const first = render(
        <PresetFillModal preset={preset()} fire={fireOk()} onClose={onClose} />,
      );
      fireEvent.change(input("topic"), { target: { value: "Patience" } });
      fireEvent.click(screen.getByRole("button", { name: "Apply now" }));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      first.unmount();

      render(<PresetFillModal preset={preset()} fire={fireOk()} onClose={() => {}} />);
      expect(input("topic").value).toBe("Patience");
    });

    it("keeps each preset's last-used values to itself", async () => {
      const onClose = vi.fn();
      const first = render(<PresetFillModal preset={preset()} fire={fireOk()} onClose={onClose} />);
      fireEvent.change(input("topic"), { target: { value: "Patience" } });
      fireEvent.click(screen.getByRole("button", { name: "Apply now" }));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      first.unmount();

      render(<PresetFillModal preset={preset({ id: "p2" })} fire={fireOk()} onClose={() => {}} />);
      expect(input("topic").value).toBe("");
    });

    it("survives storage that is blocked or holding junk", () => {
      localStorage.setItem("yt-fill-last:p1", "not json");

      expect(() =>
        render(<PresetFillModal preset={preset()} fire={fireOk()} onClose={() => {}} />),
      ).not.toThrow();
      expect(input("topic").value).toBe("");
    });
  });

  describe("dismissing", () => {
    it("closes on Escape", () => {
      const onClose = vi.fn();
      render(<PresetFillModal preset={preset()} fire={fireOk()} onClose={onClose} />);

      fireEvent.keyDown(document, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("closes on a click outside the dialog but not inside it", () => {
      const onClose = vi.fn();
      const { container } = render(
        <PresetFillModal preset={preset()} fire={fireOk()} onClose={onClose} />,
      );

      fireEvent.mouseDown(container.querySelector(".modal")!);
      expect(onClose).not.toHaveBeenCalled();

      fireEvent.mouseDown(container.querySelector(".overlay")!);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("cancels without firing the action", () => {
      const fire = fireOk();
      const onClose = vi.fn();
      render(<PresetFillModal preset={preset()} fire={fire} onClose={onClose} />);

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(fire).not.toHaveBeenCalled();
    });
  });

  it("reports the first edit once — 'someone is answering this popup'", () => {
    const onDirty = vi.fn();
    render(<PresetFillModal preset={preset()} fire={fireOk()} onClose={() => {}} onDirty={onDirty} />);

    fireEvent.change(input("topic"), { target: { value: "P" } });
    fireEvent.change(input("topic"), { target: { value: "Pa" } });
    expect(onDirty).toHaveBeenCalled();
  });

  it("renders a preset with no variables at all", () => {
    render(
      <PresetFillModal
        preset={preset({ title: "Fixed title", description: "Fixed description" })}
        fire={fireOk()}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("Fixed title")).toBeDefined();
    expect(screen.queryByText(/no value and no fallback/)).toBeNull();
  });
});
