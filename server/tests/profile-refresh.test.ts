import { afterEach, describe, expect, it, vi } from "vitest";
import { profileFailureMessage, refreshProfileResources } from "../../mobile/src/lib/profile-refresh";

afterEach(() => vi.unstubAllGlobals());

describe("profile partial failures", () => {
  it("loads statistics even when identity fails", async () => {
    const failure = new Error("backend unavailable");
    const onIdentity = vi.fn();
    const read = vi.fn(async (path: string) => {
      if (path.endsWith("/me")) throw failure;
      return { path };
    });
    const results = await refreshProfileResources(read as <T>(path: string) => Promise<T>, onIdentity);
    expect(read).toHaveBeenCalledTimes(4);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled", "fulfilled"]);
    expect(onIdentity).toHaveBeenCalledWith({ status: "rejected", reason: failure });
  });

  it("shows identity before a slow statistics request and isolates its failure", async () => {
    let rejectGpa!: (error: Error) => void;
    const gpa = new Promise((_, reject) => { rejectGpa = reject; });
    const onIdentity = vi.fn();
    const read = (path: string) => path.endsWith("/gpa") ? gpa : Promise.resolve({ path });
    const operation = refreshProfileResources(read as <T>(path: string) => Promise<T>, onIdentity);
    await Promise.resolve();
    expect(onIdentity).toHaveBeenCalledWith({ status: "fulfilled", value: { path: "/v1/student/me" } });
    rejectGpa(new Error("unavailable"));
    expect((await operation).map((result) => result.status)).toEqual(["rejected", "fulfilled", "fulfilled"]);
  });

  it("distinguishes offline, timeout, and explicit server failures", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(profileFailureMessage(new TypeError("Failed to fetch"))).toContain("offline");
    vi.stubGlobal("navigator", { onLine: true });
    expect(profileFailureMessage(new DOMException("expired", "TimeoutError"))).toContain("timed out");
    const serverError = Object.assign(new Error("Service unavailable"), { name: "ApiError" });
    expect(profileFailureMessage(serverError)).toBe("Service unavailable");
    expect(profileFailureMessage(new TypeError("Failed to fetch"))).toContain("Could not connect");
  });
});
