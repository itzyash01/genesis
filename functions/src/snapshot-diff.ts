export type SnapshotFile = { path: string; content: string };
export type SnapshotChange = {
  path: string;
  status: "added" | "modified" | "removed";
  before: string;
  after: string;
};

/** Compare complete snapshots without assuming that an empty file is absent. */
export function compareSnapshotFiles(before: SnapshotFile[], after: SnapshotFile[]): SnapshotChange[] {
  const oldFiles = new Map(before.map((file) => [file.path, file.content]));
  const newFiles = new Map(after.map((file) => [file.path, file.content]));
  const paths = [...new Set([...oldFiles.keys(), ...newFiles.keys()])].sort();
  return paths.flatMap((path) => {
    const wasPresent = oldFiles.has(path);
    const isPresent = newFiles.has(path);
    const oldContent = oldFiles.get(path) ?? "";
    const newContent = newFiles.get(path) ?? "";
    if (wasPresent && isPresent && oldContent === newContent) return [];
    return [{
      path,
      status: !wasPresent ? "added" as const : !isPresent ? "removed" as const : "modified" as const,
      before: oldContent,
      after: newContent,
    }];
  });
}
