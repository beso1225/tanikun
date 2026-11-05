export function parseJsonc(text) {
  let withoutComments = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
        withoutComments += character;
      }
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      withoutComments += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      withoutComments += character;
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    withoutComments += character;
  }

  let withoutTrailingCommas = "";
  let inStringValues = false;
  let escapedValues = false;
  for (let index = 0; index < withoutComments.length; index += 1) {
    const character = withoutComments[index];
    if (inStringValues) {
      withoutTrailingCommas += character;
      if (escapedValues) escapedValues = false;
      else if (character === "\\") escapedValues = true;
      else if (character === '"') inStringValues = false;
      continue;
    }
    if (character === '"') {
      inStringValues = true;
      withoutTrailingCommas += character;
      continue;
    }
    if (character === ",") {
      let cursor = index + 1;
      while (/\s/.test(withoutComments[cursor] ?? "")) cursor += 1;
      if (withoutComments[cursor] === "}" || withoutComments[cursor] === "]") {
        continue;
      }
    }
    withoutTrailingCommas += character;
  }
  return JSON.parse(withoutTrailingCommas);
}
