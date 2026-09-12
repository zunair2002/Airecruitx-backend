import dotenv from "dotenv";
dotenv.config();

import { assertEnv } from "./config/env";

const env = assertEnv();

import http from "http";
import app from "./app";
import { connectDB } from "./config/db";
import { initSocket } from "./config/socket";
import { logger } from "./config/logger";
import "./config/firebase";
import dns from "dns";

dns.setServers(["1.1.1.1", "8.8.8.8"]);

const start = async () => {
  await connectDB();

  const httpServer = http.createServer(app);
  initSocket(httpServer);

  httpServer.listen(env.port, () => {
    logger.info(`Airecruitx backend running on port ${env.port}`);
  });
};

start();
