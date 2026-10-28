import { type DocumentReference } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { db } from "./admin.js";

const SNAPSHOT_RETENTION_LIMIT = 20;
const SNAPSHOT_FILE_LIMIT = 150;

export async function pruneOldSnapshots(projectRef: DocumentReference): Promise<void> {
  try {
    const snapshots = await projectRef
      .collection("snapshots")
      .where("status", "==", "complete")
      .orderBy("createdAt", "desc")
      .limit(SNAPSHOT_RETENTION_LIMIT + 1)
      .get();
    if (snapshots.size <= SNAPSHOT_RETENTION_LIMIT) return;

    for (const snapshot of snapshots.docs.slice(SNAPSHOT_RETENTION_LIMIT)) {
      const files = await snapshot.ref.collection("files").limit(SNAPSHOT_FILE_LIMIT + 1).get();
      if (files.size > SNAPSHOT_FILE_LIMIT) {
        throw new Error("Snapshot exceeds the configured retention delete limit.");
      }
      const batch = db.batch();
      files.docs.forEach((file) => batch.delete(file.ref));
      batch.delete(snapshot.ref);
      await batch.commit();
    }
  } catch (error) {
    logger.warn("Snapshot retention cleanup failed", {
      error: error instanceof Error ? error.message : "Unknown cleanup error",
    });
  }
}
