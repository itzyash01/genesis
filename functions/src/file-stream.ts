/** Extract complete file objects from the top-level files array as JSON arrives. */
export class FileStreamParser {
  private text = "";
  private cursor = 0;
  private inString = false;
  private escaped = false;
  private stringStart = 0;
  private rootKey: string | undefined;
  private expectingRootKey = false;
  private containers: string[] = [];
  private filesDepth = 0;
  private recordStart = -1;

  push(chunk: string): string[] {
    this.text += chunk;
    const records: string[] = [];
    while (this.cursor < this.text.length) {
      const index = this.cursor++;
      const character = this.text[index];
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (character === "\\") this.escaped = true;
        else if (character === '"') {
          this.inString = false;
          if (this.expectingRootKey && this.containers.length === 1) {
            try {
              this.rootKey = JSON.parse(this.text.slice(this.stringStart, index + 1)) as string;
            } catch {
              this.rootKey = undefined;
            }
            this.expectingRootKey = false;
          }
        }
        continue;
      }
      if (character === '"') {
        this.inString = true;
        this.stringStart = index;
      } else if (character === "{" || character === "[") {
        if (character === "[" && this.containers.length === 1 && this.rootKey === "files") {
          this.filesDepth = this.containers.length + 1;
        }
        if (character === "{" && this.filesDepth && this.containers.length === this.filesDepth) {
          this.recordStart = index;
        }
        this.containers.push(character);
        if (this.containers.length === 1 && character === "{") this.expectingRootKey = true;
      } else if (character === "}" || character === "]") {
        const expected = character === "}" ? "{" : "[";
        if (this.containers[this.containers.length - 1] !== expected) continue;
        this.containers.pop();
        if (character === "}" && this.recordStart >= 0 && this.containers.length === this.filesDepth) {
          records.push(this.text.slice(this.recordStart, index + 1));
          this.recordStart = -1;
        }
        if (character === "]" && this.filesDepth && this.containers.length < this.filesDepth) {
          this.filesDepth = 0;
          this.rootKey = undefined;
        }
      } else if (character === "," && this.containers.length === 1) {
        this.expectingRootKey = true;
        this.rootKey = undefined;
      }
    }
    return records;
  }

  fileCount(): number | null {
    try {
      const parsed: unknown = JSON.parse(this.text);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
      const files = (parsed as { files?: unknown }).files;
      return Array.isArray(files) ? files.length : null;
    } catch {
      return null;
    }
  }
}
