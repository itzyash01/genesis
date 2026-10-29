const test = require("node:test");
const assert = require("node:assert/strict");
const { FileStreamParser } = require("../lib/file-stream.js");

test("extracts escaped and nested file contents across arbitrary chunks", () => {
  const parser = new FileStreamParser();
  const files = [
    { path: "index.html", content: '<script>const x = {quote: "\\\\"};</script>' },
    { path: "style.css", content: "body { color: red; }\n" },
  ];
  const response = JSON.stringify({ explanation: "files [{...}]", files });
  const records = [];
  for (let i = 0; i < response.length; i += 3) records.push(...parser.push(response.slice(i, i + 3)));
  assert.deepEqual(records.map(JSON.parse), files);
  assert.equal(parser.fileCount(), 2);
});

test("retains completed file records if the response is interrupted", () => {
  const parser = new FileStreamParser();
  const records = parser.push('{"files":[{"path":"index.html","content":"ok"},{"path":"style.css","content":"unfinished');
  assert.deepEqual(records.map(JSON.parse), [{ path: "index.html", content: "ok" }]);
  assert.equal(parser.fileCount(), null);
});

test("does not extract unrelated nested objects as files", () => {
  const parser = new FileStreamParser();
  const response = '{"other":{"files":[{"path":"wrong","content":"bad"}]},"files":[{"path":"ok.js","content":"ok"}]}';
  assert.deepEqual(parser.push(response).map(JSON.parse), [{ path: "ok.js", content: "ok" }]);
  assert.equal(parser.fileCount(), 1);
});
