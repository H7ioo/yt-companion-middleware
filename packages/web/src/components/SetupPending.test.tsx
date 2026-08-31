// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SetupPending } from "./SetupPending.js";

afterEach(cleanup);

it("says what is missing and who can fix it, and offers nothing that would refuse them", () => {
  render(<SetupPending />);
  expect(screen.getByText(/an admin has to connect a youtube channel/i)).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});
