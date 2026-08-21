// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Navbar } from "../navbar";

const mocks = vi.hoisted(() => ({
  nextIntl: {
    useTranslations: () => (key: string) => key,
    useLocale: () => "en",
  },
  nextAuth: { useSession: vi.fn(), signOut: vi.fn() },
  navigation: { usePathname: () => "/", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) },
}));

vi.mock("next-intl", () => mocks.nextIntl);
vi.mock("next-auth/react", () => mocks.nextAuth);
vi.mock("next/navigation", () => mocks.navigation);

describe("Navbar", () => {
  it("shows sign in/sign up for unauthenticated", () => {
    mocks.nextAuth.useSession.mockReturnValue({ data: null, status: "unauthenticated" });
    render(<Navbar />);
    // With the simple mock, t('signIn') returns 'signIn' and t('getStarted') returns 'getStarted'
    expect(screen.getByText("signIn")).toBeInTheDocument();
    expect(screen.getByText("getStarted")).toBeInTheDocument();
  });

  it("renders nav links when authenticated", () => {
    mocks.nextAuth.useSession.mockReturnValue({
      data: { user: { id: "u1", role: "user" } },
      status: "authenticated",
    });
    render(<Navbar />);
    expect(screen.getByText("dashboard")).toBeInTheDocument();
    expect(screen.getByText("trainingPlan")).toBeInTheDocument();
    expect(screen.getByText("activities")).toBeInTheDocument();
    expect(screen.getByText("import")).toBeInTheDocument();
    expect(screen.getByText("settings")).toBeInTheDocument();
  });

  it("shows admin link for admin users", () => {
    mocks.nextAuth.useSession.mockReturnValue({
      data: { user: { id: "u1", role: "admin" } },
      status: "authenticated",
    });
    render(<Navbar />);
    expect(screen.getByText("admin")).toBeInTheDocument();
  });

  it("hides admin link for regular users", () => {
    mocks.nextAuth.useSession.mockReturnValue({
      data: { user: { id: "u1", role: "user" } },
      status: "authenticated",
    });
    render(<Navbar />);
    expect(screen.queryByText("admin")).not.toBeInTheDocument();
  });

  it("calls signOut when Sign Out is clicked", () => {
    mocks.nextAuth.useSession.mockReturnValue({
      data: { user: { id: "u1", role: "user" } },
      status: "authenticated",
    });
    render(<Navbar />);
    fireEvent.click(screen.getByText("signOut"));
    expect(mocks.nextAuth.signOut).toHaveBeenCalledWith({ redirectTo: "/" });
  });
});
