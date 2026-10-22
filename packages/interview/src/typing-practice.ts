export function normalizeNewlines(text: string) {
  return text.replace(/\r\n?/g, '\n');
}

export function compareTyping(reference: string, typed: string) {
  const expected = Array.from(normalizeNewlines(reference));
  const actual = Array.from(normalizeNewlines(typed));
  let prefix = 0;
  while (prefix < expected.length && prefix < actual.length && expected[prefix] === actual[prefix]) prefix++;
  const complete = prefix === expected.length && prefix === actual.length;
  const before = expected.slice(0, prefix).join('').split('\n');
  const expectedLines = normalizeNewlines(reference).split('\n');
  const actualLines = normalizeNewlines(typed).split('\n');
  return {
    complete,
    prefix,
    total: expected.length,
    entered: actual.length,
    progress: expected.length === 0 ? (complete ? 100 : 0) : Math.floor(prefix / expected.length * 100),
    difference: complete ? null : {
      line: before.length,
      column: Array.from(before.at(-1) ?? '').length + 1,
      expected: expected[prefix] ?? null,
      actual: actual[prefix] ?? null,
    },
    lines: Array.from({ length: Math.max(expectedLines.length, actualLines.length) }, (_, i) => ({
      number: i + 1,
      expected: expectedLines[i] ?? null,
      actual: actualLines[i] ?? null,
      matches: expectedLines[i] !== undefined && expectedLines[i] === actualLines[i],
    })),
  };
}
