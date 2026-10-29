const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeGeneratedContent } = require('../lib/file-normalization.js');

test('decodes an extra JSON layer in generated HTML and CSS', () => {
  assert.equal(normalizeGeneratedContent('index.html', '<html>\\n<body>\\n<p>Hi</p>\\n</body>\\n</html>'), '<html>\n<body>\n<p>Hi</p>\n</body>\n</html>');
  assert.equal(normalizeGeneratedContent('style.css', ':root {\\nfont-family: \\"Example\\";\\ncolor: red;\\n}'), ':root {\nfont-family: "Example";\ncolor: red;\n}');
});

test('decodes a double-encoded JS file only when it parses', () => {
  assert.equal(normalizeGeneratedContent('app.js', '// title\\nconst a = 1;\\nconst b = 2;\\nconsole.log(a + b);'), '// title\nconst a = 1;\nconst b = 2;\nconsole.log(a + b);');
  assert.throws(() => normalizeGeneratedContent('app.js', "const a = 'x\\ny';\\nconst b=1;\\nconst c=2;\\n"), /could not be safely decoded/);
});

test('leaves normal file contents and supported escaped strings alone', () => {
  const js = 'const text = "hello\\nworld";';
  assert.equal(normalizeGeneratedContent('app.js', js), js);
  const validSingleLine = 'const a = "one\\ntwo\\nthree\\nfour";';
  assert.equal(normalizeGeneratedContent('app.js', validSingleLine), validSingleLine);
  const html = '<p>one</p>\n<p>two</p>';
  assert.equal(normalizeGeneratedContent('index.html', html), html);
});
