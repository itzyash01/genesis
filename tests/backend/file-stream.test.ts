import { describe, expect, it } from 'vitest';
import { FileStreamParser } from '../../functions/src/file-stream';
import { normalizeGeneratedContent } from '../../functions/src/file-normalization';

describe('streamed file parsing', () => {
  it('extracts records across arbitrary chunk boundaries', () => {
    const p = new FileStreamParser();
    const files = [{path: 'index.html', content: 'Hello "world"\n{a}'}, {path:'app.js',content:'const n = 2;'}];
    const input = JSON.stringify({files});
    const records: string[] = [];
    for (const char of input) records.push(...p.push(char));
    expect(records.map(JSON.parse)).toEqual(files);
    expect(p.fileCount()).toBe(2);
  });
  it('reports incomplete and invalid responses without discarding complete records', () => {
    const p = new FileStreamParser();
    expect(p.push('{"files":[{"path":"a.js","content":"ok"},')).toHaveLength(1);
    expect(p.fileCount()).toBeNull();
    expect(new FileStreamParser().push('{"other":{"files":[{}]}}')).toEqual([]);
  });
  it('repairs double escaped content while rejecting unsafe decoding', () => {
    expect(normalizeGeneratedContent('x.html', '<p>a</p>\\n<p>b</p>\\n<p>c</p>\\n')).toContain('\n');
    expect(normalizeGeneratedContent('x.js', 'const s="a\\nb\\nc\\nd";')).toBe('const s="a\\nb\\nc\\nd";');
    expect(() => normalizeGeneratedContent('x.js', "const s='x\\ny';\\nconst a=1;\\nconst b=2;\\n")).toThrow();
  });
});
