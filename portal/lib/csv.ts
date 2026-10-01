export function downloadCsv(
  filename: string,
  columns: string[],
  rows: Record<string, unknown>[],
) {
  const cell = (value: unknown) => {
    const text = Array.isArray(value)
      ? value.join(" · ")
      : value === null || value === undefined
        ? ""
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
    return (
      '"' +
      (/^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(text) ? "'" : "") +
      text.replaceAll('"', '""') +
      '"'
    );
  };
  const url = URL.createObjectURL(
    new Blob(
      [
        "\uFEFF" +
          [
            columns.map(cell).join(","),
            ...rows.map((row) =>
              columns.map((key) => cell(row[key])).join(","),
            ),
          ].join("\r\n"),
      ],
      { type: "text/csv;charset=utf-8" },
    ),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
