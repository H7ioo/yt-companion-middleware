// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { StreamInfo } from "../api.js";
import { StreamBindingField } from "./StreamBindingField.js";

/**
 * The confirmation in front of the default stream binding (issue 051, PRD-15 §9).
 *
 * This setting fails silently and expensively: a wrong id sends the show nowhere and nothing looks
 * broken until nobody can watch. The guard is a confirmation, not a permission — everyone here is
 * trusted, and the risk being defended against is a mis-click.
 */

const streams: StreamInfo[] = [
  { id: "a", title: "Main", streamName: "key-1" },
  { id: "b", title: "Backup", streamName: null },
];

const commit = vi.fn();

afterEach(() => {
  cleanup();
  commit.mockReset();
});

const renderField = (value: string | null) =>
  render(
    <StreamBindingField id="def-stream" label="Default stream binding" value={value} streams={streams} onCommit={commit} />,
  );

const field = () => screen.getByLabelText("Default stream binding") as HTMLInputElement;

const typeAndLeave = (next: string) => {
  fireEvent.change(field(), { target: { value: next } });
  fireEvent.blur(field());
};

describe("StreamBindingField (issue 051)", () => {
  it("saves nothing and asks nothing when the value is left alone", () => {
    renderField("a");
    fireEvent.blur(field());
    expect(commit).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not save on blur — it asks first, naming what is changing from and to", () => {
    renderField("a");
    typeAndLeave("b");
    expect(commit).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Main — key-1");
    expect(dialog.textContent).toContain("Backup");
  });

  it("saves the new binding once it is confirmed", () => {
    renderField("a");
    typeAndLeave("b");
    fireEvent.click(screen.getByRole("button", { name: /change the binding/i }));
    expect(commit).toHaveBeenCalledWith("b");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("leaves the setting untouched when the confirmation is cancelled", () => {
    renderField("a");
    typeAndLeave("b");
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(commit).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    // The field goes back to what is actually saved, so it never shows a value the server does not hold.
    expect(field().value).toBe("a");
  });

  it("cancels on Escape", () => {
    renderField("a");
    typeAndLeave("b");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(commit).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(field().value).toBe("a");
  });

  it("confirms clearing the binding too — unbinding is the change with no symptom at all", () => {
    renderField("a");
    typeAndLeave("  ");
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("not set");
    fireEvent.click(screen.getByRole("button", { name: /change the binding/i }));
    expect(commit).toHaveBeenCalledWith(null);
  });

  it("confirms setting a binding that was never set", () => {
    renderField(null);
    typeAndLeave("a");
    expect(screen.getByRole("dialog").textContent).toContain("not set");
    fireEvent.click(screen.getByRole("button", { name: /change the binding/i }));
    expect(commit).toHaveBeenCalledWith("a");
  });

  it("warns about an id no live stream on the channel carries", () => {
    renderField("gone");
    expect(field()).toHaveProperty("ariaInvalid", "true");
    expect(screen.getByText(/No live stream on this channel has that ID/i)).toBeTruthy();
  });

  it("follows the saved value when it changes underneath (another tab, another operator)", () => {
    const { rerender } = renderField("a");
    rerender(
      <StreamBindingField id="def-stream" label="Default stream binding" value={"b"} streams={streams} onCommit={commit} />,
    );
    expect(field().value).toBe("b");
  });

  it("shows the saved binding again when the save does not take", async () => {
    // saveSettings swallows a refused save and leaves the settings untouched, so a confirmed
    // change that the server rejected must not leave the field reading an id nobody holds.
    commit.mockResolvedValue(undefined);
    renderField("a");
    typeAndLeave("b");
    fireEvent.click(screen.getByRole("button", { name: /change the binding/i }));
    expect(commit).toHaveBeenCalledWith("b");
    await waitFor(() => expect(field().value).toBe("a"));
  });

  it("takes focus into the question and keeps Tab inside it", () => {
    renderField("a");
    typeAndLeave("b");
    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    const confirmBtn = screen.getByRole("button", { name: /change the binding/i });
    // Focus starts in the dialog, not on the control the overlay is covering.
    expect(document.activeElement).toBe(cancelBtn);
    confirmBtn.focus();
    fireEvent.keyDown(document.body, { key: "Tab" });
    expect(document.activeElement).toBe(cancelBtn);
    fireEvent.keyDown(document.body, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirmBtn);
  });

  it("does not let a click outside reach the modal it sits inside", () => {
    const onOutsideClick = vi.fn();
    render(
      <div onClick={onOutsideClick}>
        <StreamBindingField id="def-stream" label="Default stream binding" value={"a"} streams={streams} onCommit={commit} />
      </div>,
    );
    typeAndLeave("b");
    // The mousedown that blurs the field is often on the settings panel's backdrop; its click lands
    // a moment later and used to close the panel and the question together, dropping the change.
    fireEvent.click(document.body);
    expect(onOutsideClick).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(commit).not.toHaveBeenCalled();
    expect(field().value).toBe("a");
  });
});
