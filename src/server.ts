import dotenv from "dotenv";
dotenv.config();

import http from "http";
import app from "./app";
import { connectDB } from "./config/db";
import { initSocket } from "./config/socket";
import { startOrgInterviewExpiryScheduler } from "./config/orgInterviewExpiryScheduler";
import "./config/firebase";
import dns from "dns";

dns.setServers(["1.1.1.1", "8.8.8.8"]);

const PORT = process.env.PORT || 5000;

const start = async () => {
  await connectDB();

  const httpServer = http.createServer(app);
  initSocket(httpServer);
  startOrgInterviewExpiryScheduler();

  httpServer.listen(PORT, () => {
    console.log(`Airecruitx backend running on port ${PORT}`);
  });
};

start();
