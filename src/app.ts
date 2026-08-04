import path from "path";
import express, { Application } from "express";
import cors from "cors";
import authRoutes from "./routes/auth.routes";
import { notFoundHandler, errorHandler } from "./middleware/error.middleware";

const app: Application = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/health", (_req, res) => {
  res.status(200).json({ success: true, message: "Airecruitx API is running" });
});

app.use("/api/auth", authRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
