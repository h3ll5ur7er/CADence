/**
 * Comma-separated values (RFC 4180): fields with commas, quotes or line breaks are quoted. Reading
 * also takes semicolons, which spreadsheets use where the comma is the decimal separator.
 */

const quoted = (field: string) => (/[",;\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field);

export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(quoted).join(',')).join('\r\n') + '\r\n';
}

/** The rows of a CSV text; blank lines are skipped. The separator is the first of `,` or `;` found outside quotes in the first line. */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, '');
  const separator = firstSeparator(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quotes = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i] as string;
    if (quotes) {
      if (c === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quotes = false;
      else field += c;
    } else if (c === '"') quotes = true;
    else if (c === separator) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f !== '')) rows.push(row);
      [row, field] = [[], ''];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

function firstSeparator(text: string): string {
  let quotes = false;
  for (const c of text) {
    if (c === '"') quotes = !quotes;
    else if (!quotes && (c === ',' || c === ';')) return c;
    else if (!quotes && c === '\n') break;
  }
  return ',';
}
