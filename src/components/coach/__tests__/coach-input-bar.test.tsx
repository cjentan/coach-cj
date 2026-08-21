// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CoachInputBar from "../coach-input-bar";

describe("CoachInputBar", () => {
  const defaultProps = {
    input: "",
    onInputChange: vi.fn(),
    onSend: vi.fn(),
    disabled: false,
    placeholder: "Type your message...",
  };

  it("renders textarea and send button", () => {
    render(<CoachInputBar {...defaultProps} />);
    expect(screen.getByPlaceholderText("Type your message...")).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("disables send button when input is empty", () => {
    render(<CoachInputBar {...defaultProps} input="" />);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("enables send button when input has text", () => {
    render(<CoachInputBar {...defaultProps} input="Hello" />);
    expect(screen.getByRole("button")).toBeEnabled();
  });

  it("calls onInputChange on textarea change", async () => {
    const onInputChange = vi.fn();
    render(<CoachInputBar {...defaultProps} onInputChange={onInputChange} />);
    const textarea = screen.getByPlaceholderText("Type your message...");
    await userEvent.type(textarea, "a");
    expect(onInputChange).toHaveBeenCalled();
  });

  it("calls onSend when Enter is pressed", () => {
    const onSend = vi.fn();
    render(<CoachInputBar {...defaultProps} onSend={onSend} input="Hello" />);
    const textarea = screen.getByPlaceholderText("Type your message...");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("does not call onSend on Shift+Enter", () => {
    const onSend = vi.fn();
    render(<CoachInputBar {...defaultProps} onSend={onSend} input="Hello" />);
    const textarea = screen.getByPlaceholderText("Type your message...");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows loading spinner when loading is true", () => {
    const { container } = render(<CoachInputBar {...defaultProps} loading={true} input="Hello" />);
    // Loading shows a spinner icon instead of send icon
    const spinner = container.querySelector(".animate-spin");
    expect(spinner).toBeInTheDocument();
  });

  it("disables textarea and button when disabled is true", () => {
    render(<CoachInputBar {...defaultProps} disabled={true} />);
    expect(screen.getByPlaceholderText("Type your message...")).toBeDisabled();
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("applies custom className", () => {
    const { container } = render(<CoachInputBar {...defaultProps} className="custom-class" />);
    expect(container.firstChild).toHaveClass("custom-class");
  });

  it("calls onSend when send button is clicked", async () => {
    const onSend = vi.fn();
    render(<CoachInputBar {...defaultProps} onSend={onSend} input="Hello" />);
    await userEvent.click(screen.getByRole("button"));
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});
