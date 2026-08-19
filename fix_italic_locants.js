const fs = require('fs');
const path = 'games/aromatic-quest/index.html';
let text = fs.readFileSync(path, 'utf8');

const mathItalic = { o: '\u{1D45C}', m: '\u{1D45A}', p: '\u{1D45D}' };

let totalLiteral = 0;
let totalEscaped = 0;

for (const letter of ['o', 'm', 'p']) {
  const literalPattern = `<tspan style="font-style:italic">${letter}</tspan>`;
  const literalParts = text.split(literalPattern);
  totalLiteral += literalParts.length - 1;
  text = literalParts.join(mathItalic[letter]);

  const escapedPattern = `\\u003ctspan style=\\"font-style:italic\\"\\u003e${letter}\\u003c/tspan\\u003e`;
  const escapedParts = text.split(escapedPattern);
  totalEscaped += escapedParts.length - 1;
  text = escapedParts.join(mathItalic[letter]);
}

fs.writeFileSync(path, text, 'utf8');
console.log('literal replaced:', totalLiteral);
console.log('escaped replaced:', totalEscaped);
