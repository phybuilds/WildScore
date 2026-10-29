export function parseByteRange(header, size) {
  if (header === undefined) return null;
  if (!Number.isInteger(size) || size <= 0) return { satisfiable: false };
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header);
  if (!match || (match[1] === "" && match[2] === "")) return { satisfiable: false };

  let start;
  let end;
  if (match[1] === "") {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { satisfiable: false };
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Number(match[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return { satisfiable: false };
    end = Math.min(end, size - 1);
  }
  if (start < 0 || start >= size || end < start) return { satisfiable: false };
  return { satisfiable: true, start, end };
}
