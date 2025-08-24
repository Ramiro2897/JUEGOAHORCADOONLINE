import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";

const app = express();
app.use(cors());

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  pingInterval: 10000, // Enviar ping cada 10s
  pingTimeout: 5000,   // Timeout si no responde
});

type Role = "player1" | "player2";
type RoomState = "lobby" | "waiting_word" | "playing" | "aborted";

interface GameRoom {
  id: string;
  state: RoomState;
  players: Record<
    Role,
    | {
        socketId: string;
        name: string;
      }
    | undefined
  >;
  word?: string;
  revealed: string[];
  wrong: Set<string>;
  fails: number;
  maxFails: number;
  createdAt: number;
}

const rooms = new Map<string, GameRoom>();

function getOrCreateRoom(roomId: string): GameRoom {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      state: "lobby",
      players: { player1: undefined, player2: undefined },
      revealed: [],
      wrong: new Set(),
      fails: 0,
      maxFails: 6,
      createdAt: Date.now(),
    });
    console.log("📌 Sala creada:", roomId, "Total salas:", rooms.size);
  }
  return rooms.get(roomId)!;
}

function sanitizeWord(raw: string) {
  return raw
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z]/g, "");
}

// ---------------- SOCKET.IO ----------------
io.on("connection", (socket) => {
  console.log("Cliente conectado:", socket.id);

  let joinedRoomId: string | null = null;

  socket.on("room:join", ({ roomId }: { roomId: string }) => {
    const room = getOrCreateRoom(roomId);
    socket.join(roomId);
    joinedRoomId = roomId;

    io.to(roomId).emit("room:update", {
      roomId,
      roles: {
        player1Taken: !!room.players.player1,
        player2Taken: !!room.players.player2,
      },
      state: room.state,
      hasWord: !!room.word,
      revealed: room.revealed,
      wrong: Array.from(room.wrong),
      fails: room.fails,
      maxFails: room.maxFails,
    });
  });

  socket.on(
    "role:pick",
    ({
      roomId,
      role,
      name,
    }: {
      roomId: string;
      role: Role;
      name: string;
    }) => {
      const room = getOrCreateRoom(roomId);
      const isTaken = room.players[role];
      if (isTaken && isTaken.socketId !== socket.id) {
        socket.emit("error:msg", {
          code: "ROLE_TAKEN",
          message: "Ese rol ya está ocupado.",
        });
        return;
      }

      room.players[role] = { socketId: socket.id, name: name || role };

      if (room.players.player1 && room.players.player2 && !room.word) {
        room.state = "waiting_word";
      }

      io.to(roomId).emit("room:update", {
        roomId,
        roles: {
          player1Taken: !!room.players.player1,
          player2Taken: !!room.players.player2,
        },
        state: room.state,
        hasWord: !!room.word,
        revealed: room.revealed,
        wrong: Array.from(room.wrong),
        fails: room.fails,
        maxFails: room.maxFails,
      });
    }
  );

  socket.on(
    "word:set",
    ({ roomId, word }: { roomId: string; word: string }) => {
      const room = rooms.get(roomId);
      if (!room) return;

      const p1 = room.players.player1;
      if (!p1 || p1.socketId !== socket.id) {
        socket.emit("error:msg", {
          code: "NOT_AUTHORIZED",
          message: "Sólo el Jugador 1 puede definir la palabra.",
        });
        return;
      }

      const clean = sanitizeWord(word);
      if (clean.length < 3 || clean.length > 20) {
        socket.emit("error:msg", {
          code: "INVALID_WORD",
          message: "La palabra debe tener entre 3 y 20 letras A-Z.",
        });
        return;
      }

      room.word = clean;
      room.revealed = Array.from({ length: clean.length }, () => "_");
      room.wrong.clear();
      room.fails = 0;
      room.state = "playing";

      io.to(roomId).emit("game:state", {
        roomId,
        state: room.state,
        revealed: room.revealed,
        wrong: Array.from(room.wrong),
        fails: room.fails,
        maxFails: room.maxFails,
      });
    }
  );

  socket.on(
    "guess:letter",
    ({ roomId, letter }: { roomId: string; letter: string }) => {
      const room = rooms.get(roomId);
      if (!room || room.state !== "playing" || !room.word) return;

      const p2 = room.players.player2;
      if (!p2 || p2.socketId !== socket.id) {
        socket.emit("error:msg", {
          code: "NOT_AUTHORIZED",
          message: "Sólo el Jugador 2 puede adivinar.",
        });
        return;
      }

      const L = sanitizeWord(letter).slice(0, 1);
      if (!L) {
        socket.emit("error:msg", {
          code: "INVALID_LETTER",
          message: "Ingresa una letra A-Z.",
        });
        return;
      }

      if (room.revealed.includes(L) || room.wrong.has(L)) {
        socket.emit("error:msg", {
          code: "REPEATED_LETTER",
          message: "Esa letra ya fue probada.",
        });
        return;
      }

      if (room.word.includes(L)) {
         console.log(`✔ ${L}`);
        for (let i = 0; i < room.word.length; i++) {
          if (room.word[i] === L) room.revealed[i] = L;
        }
      } else {
        console.log('fallo y aumenta en +1', room.fails)
        console.log(`✖ ${L}`);
        room.wrong.add(L);
        room.fails += 1;
      }

      io.to(roomId).emit("game:state", {
        roomId,
        state: room.state,
        revealed: room.revealed,
        wrong: Array.from(room.wrong),
        fails: room.fails,
        maxFails: room.maxFails,
      });
    }
  );

  socket.on("disconnect", () => {
    console.log("Cliente desconectado:", socket.id);

    if (!joinedRoomId) return;
    const room = rooms.get(joinedRoomId);
    if (!room) return;

    if (room.players.player1?.socketId === socket.id) {
      room.players.player1 = undefined;
    }
    if (room.players.player2?.socketId === socket.id) {
      room.players.player2 = undefined;
    }

    const hasSomeone = !!room.players.player1 || !!room.players.player2;
    if (!hasSomeone) {
      rooms.delete(joinedRoomId);
      console.log("🗑️ Sala eliminada:", "Salas restantes:", rooms.size);
    } else {
      room.state = "aborted";
      io.to(joinedRoomId).emit("room:update", {
        roomId: room.id,
        roles: {
          player1Taken: !!room.players.player1,
          player2Taken: !!room.players.player2,
        },
        state: room.state,
        hasWord: !!room.word,
        revealed: room.revealed,
        wrong: Array.from(room.wrong),
        fails: room.fails,
        maxFails: room.maxFails,
      });
    }
  });
});

// Servir frontend
const clientDistPath = path.join(__dirname, "../../client/dist");
app.use(express.static(clientDistPath));
app.get("*", (req, res) => {
  res.sendFile(path.join(clientDistPath, "index.html"));
});

const PORT = 4000;
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor corriendo en http://0.0.0.0:${PORT}`);
});
