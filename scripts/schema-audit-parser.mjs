const withoutComments = (source) => {
  let output = '';
  let mode = 'code';
  let quote = '';

  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    const next = source[index + 1];

    if (mode === 'code') {
      if (character === "'" || character === '"' || character === '`') {
        mode = 'string';
        quote = character;
        output += character;
      } else if (character === '/' && next === '*') {
        mode = 'block-comment';
        output += ' ';
        index++;
      } else if (character === '/' && next === '/') {
        mode = 'line-comment';
        output += ' ';
        index++;
      } else {
        output += character;
      }
      continue;
    }

    if (mode === 'string') {
      output += character;
      if (character === '\\' && index + 1 < source.length) {
        output += source[++index];
      } else if (character === quote) {
        mode = 'code';
      }
      continue;
    }

    if (mode === 'block-comment') {
      if (character === '*' && next === '/') {
        mode = 'code';
        index++;
      } else if (character === '\n' || character === '\r') {
        output += character;
      }
      continue;
    }

    if (character === '\n' || character === '\r') {
      mode = 'code';
      output += character;
    }
  }

  return output;
};

const arrayContents = (source, name) => {
  const match = source.match(new RegExp(`\\b${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
  return match?.[1] || '';
};

const stringFields = (contents) => [...contents.matchAll(/(['"])([a-z_][a-z0-9_]*)\1/gi)]
  .map((match) => match[2]);

export const declaredFields = (source) => {
  const cleanSource = withoutComments(source);
  const baseFields = stringFields(arrayContents(cleanSource, 'LIBRARY_ITEM_BASE_FIELDS'));
  const lightFields = arrayContents(cleanSource, 'LIBRARY_ITEM_LIGHT_FIELDS');
  if (!lightFields) return [];

  const fields = [];
  const tokens = /(['"])([a-z_][a-z0-9_]*)\1|\bLIBRARY_ITEM_BASE_FIELDS\b/gi;
  for (const match of lightFields.matchAll(tokens)) {
    if (match[2]) fields.push(match[2]);
    else fields.push(...baseFields);
  }
  return [...new Set(fields)];
};
