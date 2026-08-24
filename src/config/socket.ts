import { Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";

let io: SocketIOServer | undefined;

export const initSocket = (httpServer: HttpServer): SocketIOServer => {
  io = new SocketIOServer(httpServer, {
    cors: { origin: "*" },
  });

  io.on("connection", (socket) => {
    socket.on("join", (userId: string) => {
      if (typeof userId === "string" && userId) {
        socket.join(`user_${userId}`);
      }
    });
  });

  return io;
};

export const emitToUser = (userId: string, event: string, payload: unknown): void => {
  if (!io) {
    console.warn("[Socket] emitToUser called before socket.io was initialized");
    return;
  }
  io.to(`user_${userId}`).emit(event, payload);
};
