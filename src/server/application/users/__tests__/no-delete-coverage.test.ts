/**
 * Structural enforcement of the "never delete users" rule (P7.2 / P7.3).
 *
 * Binding principle: a user row is NEVER deleted from `users`. The ONLY
 * code path that removes a row from `users` is `archiveUser()` in
 * `src/server/application/users/archive.ts`, which moves the row to
 * `user_archive` first.
 *
 * This test scans every production source file (skipping tests) and
 * fails CI if anything else calls:
 *   - `db.delete(usersTable)`
 *   - `tx.delete(usersTable)`
 *
 * Mirrors the audit-log coverage and RBAC coverage test patterns.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = process.cwd();

/**
 * The ONE file allowed to call `db.delete(usersTable)`. Any other file
 * is a binding violation.
 */
const ALLOWED_DELETE_USERS_FILES: ReadonlyArray<string> = [
  "src/server/application/users/archive.ts",
];

function readUtf8(p: string): string {
  return readFileSync(p, "utf8");
}

async function findFiles(pattern: string): Promise<string[]> {
  const matches: string[] = [];
  for await (const entry of glob(pattern, { cwd: REPO_ROOT })) {
    matches.push(path.join(REPO_ROOT, entry));
  }
  return matches.sort();
}

/**
 * Match `db.delete(usersTable)` and `tx.delete(usersTable)` and any
 * alias variant (whitespace tolerant). We INTENTIONALLY don't match
 * `usersArchiveTable` deletions — those are part of the archive lifecycle
 * (e.g. `restoreArchivedUser` removes from archive after putting the row
 * back in `users`).
 */
const callsDeleteOnUsersTable = (text: string): boolean => {
  return /\.delete\s*\(\s*usersTable\s*\)/.test(text);
};

describe("never-delete-users coverage (P7.2/P7.3)", () => {
  it("the only file that may call db.delete(usersTable) is archive.ts", async () => {
    const candidates = [
      ...(await findFiles("src/server/**/*.ts")),
      ...(await findFiles("src/app/**/*.ts")),
    ];

    const offenders: string[] = [];
    for (const file of candidates) {
      // Skip test files — they legitimately set up + tear down state.
      if (file.includes("__tests__") || file.endsWith(".test.ts")) continue;
      const relative = path.relative(REPO_ROOT, file);
      if (ALLOWED_DELETE_USERS_FILES.includes(relative)) continue;
      const text = readUtf8(file);
      if (callsDeleteOnUsersTable(text)) {
        offenders.push(relative);
      }
    }

    expect(
      offenders,
      `These files call db.delete(usersTable) outside the archive use case:\n  - ${offenders.join(
        "\n  - "
      )}\n\nUse archiveUser() instead — the binding principle is that a user row is NEVER deleted; it moves to user_archive.\n\nIf you have a legitimate reason to delete (e.g. a new archive lifecycle function), add the file to ALLOWED_DELETE_USERS_FILES with a justification.`
    ).toEqual([]);
  });

  it("the archive module exists at the documented path", () => {
    const expected = path.join(
      REPO_ROOT,
      "src/server/application/users/archive.ts"
    );
    const text = readUtf8(expected);
    // Sanity: the file must export archiveUser.
    expect(text).toContain("export async function archiveUser");
    // And it must call db.delete(usersTable) — otherwise the principle
    // isn't actually being enforced (the row would still be in users
    // alongside an archive row, defeating "never delete from main").
    expect(callsDeleteOnUsersTable(text)).toBe(true);
  });

  it("user_archive table is exported from schema (sanity)", () => {
    const schemaPath = path.join(
      REPO_ROOT,
      "src/server/infrastructure/db/schema.ts"
    );
    const text = readUtf8(schemaPath);
    expect(text).toContain("usersArchiveTable");
    expect(text).toContain('"user_archive"');
  });
});
