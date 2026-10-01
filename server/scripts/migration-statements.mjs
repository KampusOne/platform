// Neon prepared statements accept one top-level command per query. Keep quoted
// strings, identifiers, nested comments and dollar-quoted function bodies intact.
export function splitMigrationSQL(source) {
  const statements = [];
  let start = 0;
  let i = 0;
  while (i < source.length) {
    if (source.startsWith("--", i)) {
      const end = source.indexOf("\n", i + 2);
      i = end < 0 ? source.length : end + 1;
    } else if (source.startsWith("/*", i)) {
      let depth = 1;
      i += 2;
      while (i < source.length && depth) {
        if (source.startsWith("/*", i)) { depth++; i += 2; }
        else if (source.startsWith("*/", i)) { depth--; i += 2; }
        else i++;
      }
      if (depth) throw new Error("Unclosed SQL comment");
    } else if (source[i] === "'" || source[i] === '"') {
      const quote = source[i];
      const escape = quote === "'" && /e/i.test(source[i - 1] ?? "") && !/[a-z0-9_$]/i.test(source[i - 2] ?? "");
      let closed = false;
      i++;
      while (i < source.length) {
        if (escape && source[i] === "\\") i += 2;
        else if (source[i] === quote && source[i + 1] === quote) i += 2;
        else if (source[i] === quote) { i++; closed = true; break; }
        else i++;
      }
      if (!closed) throw new Error("Unclosed SQL quote");
    } else if (source[i] === "$" && /^(\$\$|\$[a-z_][a-z_0-9]*\$)/i.test(source.slice(i))) {
      const tag = source.slice(i).match(/^(\$\$|\$[a-z_][a-z_0-9]*\$)/i)[0];
      const end = source.indexOf(tag, i + tag.length);
      if (end < 0) throw new Error("Unclosed SQL dollar quote");
      i = end + tag.length;
    } else if (source[i] === ";") {
      statements.push(source.slice(start, ++i).trim());
      start = i;
    } else i++;
  }
  if (source.slice(start).trim()) statements.push(source.slice(start).trim());
  return statements;
}

function commandText(statement) {
  let value = statement.trim();
  while (value.startsWith("--") || value.startsWith("/*")) {
    if (value.startsWith("--")) {
      const end = value.indexOf("\n");
      value = end < 0 ? "" : value.slice(end + 1).trim();
    } else {
      let i = 2;
      let depth = 1;
      while (i < value.length && depth) {
        if (value.startsWith("/*", i)) { depth++; i += 2; }
        else if (value.startsWith("*/", i)) { depth--; i += 2; }
        else i++;
      }
      if (depth) throw new Error("Unclosed SQL comment");
      value = value.slice(i).trim();
    }
  }
  return value.replace(/;\s*$/, "").trim();
}

export function prepareMigrationStatements(source, version, sourceBlobSha) {
  if (!/^\d{14}_[a-z0-9_]+$/.test(version) || !/^[a-f0-9]{40}$/.test(sourceBlobSha))
    throw new Error("Invalid migration identity");
  const statements = splitMigrationSQL(source).filter(statement => commandText(statement));
  const framed = /^begin$/i.test(commandText(statements[0] ?? ""));
  if (framed) {
    if (!/^commit$/i.test(commandText(statements.at(-1) ?? ""))) throw new Error("Unbalanced migration transaction");
    statements.shift();
    statements.pop();
  }
  if (!statements.length || statements.some(statement => /^(begin|commit|rollback|start\s+transaction|savepoint|release\s+savepoint)\b/i.test(commandText(statement))))
    throw new Error("Unexpected migration transaction control");
  statements.push(`insert into app_private.schema_migrations (version,source_blob_sha,applied_by) values ('${version}','${sourceBlobSha}','codex-20261001-reviewed-platform');`);
  // Send this array only through run_sql_transaction, whose outer transaction
  // commits both the migration and its exact original-source ledger entry.
  return statements;
}
