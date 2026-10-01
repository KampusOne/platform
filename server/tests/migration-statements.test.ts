import { describe, expect, it } from "vitest";
import { prepareMigrationStatements, splitMigrationSQL } from "../scripts/migration-statements.mjs";

describe("prepared migration transaction boundary", () => {
  it("preserves semicolons in strings, nested comments, quoted identifiers and function bodies", () => {
    const source = `-- header ;\nbegin;\n/* outer ; /* inner ; */ */\ncreate function example() returns void language plpgsql as $body$ begin perform 'a;''b'; end; $body$;\ninsert into "table;name" values (E'a\\';b', 'c;d');\ncommit; -- trailing comment`;
    const statements = prepareMigrationStatements(source, "20261001000000_fixture", "a".repeat(40));
    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain("perform 'a;''b'");
    expect(statements[1]).toContain('"table;name"');
    expect(statements[2]).toContain("insert into app_private.schema_migrations");
  });
  it("rejects incomplete quoted SQL and inner commits instead of weakening atomicity", () => {
    expect(() => splitMigrationSQL("select 'unfinished;")).toThrow(/Unclosed/);
    expect(() => splitMigrationSQL("do $body$ begin;")).toThrow(/Unclosed/);
    expect(() => splitMigrationSQL("/* nested /* comment */")).toThrow(/Unclosed/);
    expect(() => prepareMigrationStatements("begin; select 1; commit; select 2; commit;", "20261001000000_fixture", "a".repeat(40))).toThrow(/transaction control/);
  });
});
