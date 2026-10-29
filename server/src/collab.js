// Real-time collaboration relay, compatible with the protocol of
// https://github.com/excalidraw/excalidraw-room. Payloads are end-to-end
// encrypted by the clients, the server only relays them between members of
// a room. Only authenticated users may connect.

import { Server } from "socket.io";

import { authenticateSocketRequest } from "./app.js";

const isValidRoomId = (roomId) =>
  typeof roomId === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(roomId);

export const attachCollab = (httpServer, db) => {
  const io = new Server(httpServer, {
    transports: ["websocket", "polling"],
    maxHttpBufferSize: 20e6,
    allowEIO3: true,
    // same-origin only: we never allow cross-origin access
    cors: { origin: false },
  });

  io.use((socket, next) => {
    const user = authenticateSocketRequest(db, socket.request);
    if (!user) {
      return next(new Error("unauthorized"));
    }
    socket.data.userId = user.id;
    next();
  });

  io.on("connection", (socket) => {
    io.to(socket.id).emit("init-room");

    socket.on("join-room", async (roomID) => {
      if (!isValidRoomId(roomID)) {
        return;
      }
      await socket.join(roomID);
      const sockets = await io.in(roomID).fetchSockets();
      if (sockets.length <= 1) {
        io.to(socket.id).emit("first-in-room");
      } else {
        socket.broadcast.to(roomID).emit("new-user", socket.id);
      }
      io.in(roomID).emit(
        "room-user-change",
        sockets.map((s) => s.id),
      );
    });

    socket.on("server-broadcast", (roomID, encryptedData, iv) => {
      if (socket.rooms.has(roomID)) {
        socket.broadcast.to(roomID).emit("client-broadcast", encryptedData, iv);
      }
    });

    socket.on("server-volatile-broadcast", (roomID, encryptedData, iv) => {
      if (socket.rooms.has(roomID)) {
        socket.volatile.broadcast
          .to(roomID)
          .emit("client-broadcast", encryptedData, iv);
      }
    });

    socket.on("user-follow", async (payload) => {
      const socketId = payload?.userToFollow?.socketId;
      if (typeof socketId !== "string") {
        return;
      }
      const roomID = `follow@${socketId}`;
      if (payload.action === "FOLLOW") {
        await socket.join(roomID);
      } else if (payload.action === "UNFOLLOW") {
        await socket.leave(roomID);
      } else {
        return;
      }
      const sockets = await io.in(roomID).fetchSockets();
      io.to(socketId).emit(
        "user-follow-room-change",
        sockets.map((s) => s.id),
      );
    });

    socket.on("disconnecting", async () => {
      for (const roomID of Array.from(socket.rooms)) {
        if (roomID === socket.id) {
          continue;
        }
        const otherClients = (await io.in(roomID).fetchSockets()).filter(
          (s) => s.id !== socket.id,
        );
        const isFollowRoom = roomID.startsWith("follow@");
        if (!isFollowRoom && otherClients.length > 0) {
          socket.broadcast.to(roomID).emit(
            "room-user-change",
            otherClients.map((s) => s.id),
          );
        }
        if (isFollowRoom && otherClients.length === 0) {
          io.to(roomID.replace("follow@", "")).emit("broadcast-unfollow");
        }
      }
    });

    socket.on("disconnect", () => {
      socket.removeAllListeners();
      socket.disconnect();
    });
  });

  return io;
};
