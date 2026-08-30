// @vitest-environment jsdom
// Only the web components render React into a DOM; the rest of the repo stays on plain `node`,
// so the environment is declared per-file rather than globally.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HEALTH_GLOSSARY } from "@app/shared";
import { HealthExplainer } from "./HealthExplainer.js";

afterEach(cleanup);

describe("HealthExplainer", () => {
  it("shows the glossary label and keeps the explanation collapsed until asked", () => {
    render(<HealthExplainer health="ok" lampClass="lamp--ready" />);

    const toggle = screen.getByRole("button");
    expect(toggle.textContent).toContain(HEALTH_GLOSSARY.ok.label);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(HEALTH_GLOSSARY.ok.meaning)).toBeNull();
  });

  it("drops the plain-language meaning on click and folds it away again", () => {
    render(<HealthExplainer health="degraded" lampClass="lamp--warn" />);
    const toggle = screen.getByRole("button");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(new RegExp(HEALTH_GLOSSARY.degraded.meaning))).toBeDefined();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(new RegExp(HEALTH_GLOSSARY.degraded.meaning))).toBeNull();
  });

  it("points the panel it controls at its own id, so the toggle is wired to what it opens", () => {
    render(<HealthExplainer health="offline" lampClass="lamp--offline" />);
    const toggle = screen.getByRole("button");

    fireEvent.click(toggle);
    const controlled = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(controlled).not.toBeNull();
    expect(controlled?.textContent).toContain(HEALTH_GLOSSARY.offline.meaning);
  });

  it("offers the firewall remedy for offline", () => {
    render(<HealthExplainer health="offline" lampClass="lamp--offline" />);
    fireEvent.click(screen.getByRole("button"));

    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("#firewall");
  });

  it("offers the reconnect remedy for auth_error", () => {
    render(<HealthExplainer health="auth_error" lampClass="lamp--err" />);
    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByRole("link").getAttribute("href")).toBe("#reauth");
  });

  it("offers no remedy link when the state has none to offer", () => {
    render(<HealthExplainer health="ok" lampClass="lamp--ready" />);
    fireEvent.click(screen.getByRole("button"));

    expect(screen.queryByRole("link")).toBeNull();
  });

  it("wears the lamp class the rail hands it, so the glossary's key colour reaches the DOM", () => {
    const { container } = render(<HealthExplainer health="offline" lampClass="lamp--offline" />);

    expect(container.querySelector(".lamp.lamp--offline")).not.toBeNull();
  });
});
