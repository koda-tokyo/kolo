import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeCandidatePath, normalizePathPattern, pathMatches } from "./match.js";

// Windows-shaped cases run on every OS by handing the normaliser `path.win32` explicitly;
// the posix cases pin the Linux behaviour so the two never drift.
describe("policy path normalisation", () => {
  const win = path.win32;
  const posix = path.posix;

  it("expands ~ against a Windows home and matches a backslash candidate", () => {
    const home = "C:\\Users\\x";
    expect(normalizePathPattern("~/.ssh/**", home, win)).toBe("C:/Users/x/.ssh/**");
    expect(normalizeCandidatePath("C:\\Users\\x\\.ssh\\id_rsa", win)).toBe(
      "C:/Users/x/.ssh/id_rsa",
    );
    expect(pathMatches("~/.ssh/**", "C:\\Users\\x\\.ssh\\id_rsa", home, win)).toBe(true);
    expect(pathMatches("~/.ssh/**", "C:\\Users\\y\\.ssh\\id_rsa", home, win)).toBe(false);
  });

  it("leaves relative globs alone so **/.env matches a drive-qualified path", () => {
    expect(normalizePathPattern("**/.env", "C:\\Users\\x", win)).toBe("**/.env");
    expect(pathMatches("**/.env", "C:\\ws\\app\\.env", "C:\\Users\\x", win)).toBe(true);
    expect(pathMatches("**/.env", "C:\\ws\\app\\.env.example", "C:\\Users\\x", win)).toBe(false);
  });

  it("resolves a drive-qualified absolute pattern to forward-slash form", () => {
    expect(normalizePathPattern("C:\\etc\\**", "C:\\Users\\x", win)).toBe("C:/etc/**");
    expect(pathMatches("C:\\etc\\**", "C:\\etc\\passwd", "C:\\Users\\x", win)).toBe(true);
  });

  it("keeps posix patterns and candidates byte-identical", () => {
    expect(normalizePathPattern("~/.ssh/**", "/home/x", posix)).toBe("/home/x/.ssh/**");
    expect(normalizePathPattern("/etc/**", "/home/x", posix)).toBe("/etc/**");
    expect(normalizePathPattern("**/.env", "/home/x", posix)).toBe("**/.env");
    expect(normalizeCandidatePath("/etc/passwd", posix)).toBe("/etc/passwd");
    expect(pathMatches("/etc/**", "/etc/passwd", "/home/x", posix)).toBe(true);
    expect(pathMatches("~/.ssh/**", "/home/x/.ssh/id_ed25519", "/home/x", posix)).toBe(true);
    expect(pathMatches("**/.env", "/ws/app/.env", "/home/x", posix)).toBe(true);
    expect(pathMatches("/etc/**", "/home/x/etc/passwd", "/home/x", posix)).toBe(false);
  });
});
