import admin from "firebase-admin";
import { getEnv } from "./env";
import { logger } from "./logger";

const { firebaseProjectId, firebaseClientEmail, firebasePrivateKey } = getEnv();

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: firebaseProjectId,
      clientEmail: firebaseClientEmail,
      privateKey: firebasePrivateKey,
    }),
  });
}

logger.info("Firebase Admin initialized");

export const firebaseAuth = admin.auth();
export default admin;
