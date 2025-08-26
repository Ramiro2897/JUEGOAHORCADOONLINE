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
  pingInterval: 10000,
  pingTimeout: 5000,
});

type Role = "player1" | "player2";
type RoomState = "lobby" | "waiting_word" | "playing" | "aborted";

interface PlayerSlot {
  socketId: string;
  name: string;
}

interface GameRoom {
  id: string;
  state: RoomState;
  players: Record<Role, PlayerSlot | undefined>;
  word?: string;
  revealed: string[];
  wrong: Set<string>;
  fails: number;
  maxFails: number;
  createdAt: number;
  reconnectTimeout?: NodeJS.Timeout | null;
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
      reconnectTimeout: null,
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

    // Si había un timeout pendiente para borrar la sala (por desconexión anterior), cancelarlo:
    if (room.reconnectTimeout) {
      clearTimeout(room.reconnectTimeout);
      room.reconnectTimeout = null;
    }

    // Emitir estado actual de la sala al que acaba de entrar (y a todos)
    io.to(roomId).emit("room:update", {
      roomId,
      roles: {
        player1Taken: !!room.players.player1?.socketId,
        player2Taken: !!room.players.player2?.socketId,
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
      const slot = room.players[role];

      // Permite reclamar el slot si no hay un socketId activo, o si ya es tu socket
      const takenByOther = slot && slot.socketId && slot.socketId !== socket.id;
      if (takenByOther) {
        socket.emit("error:msg", {
          code: "ROLE_TAKEN",
          message: "Ese rol ya está ocupado.",
        });
        return;
      }

      // Asignar (o reasignar si estaba vacío)
      room.players[role] = {
        socketId: socket.id,
        name: name || slot?.name || role,
      };

      // Si existía un timeout (por si el jugador había caído), lo cancelamos
      if (room.reconnectTimeout) {
        clearTimeout(room.reconnectTimeout);
        room.reconnectTimeout = null;
      }

      // actualizar estado si ambos están presentes y no hay palabra
      if (room.players.player1?.socketId && room.players.player2?.socketId && !room.word) {
        room.state = "waiting_word";
      }

      io.to(roomId).emit("room:update", {
        roomId,
        roles: {
          player1Taken: !!room.players.player1?.socketId,
          player2Taken: !!room.players.player2?.socketId,
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
        for (let i = 0; i < room.word.length; i++) {
          if (room.word[i] === L) room.revealed[i] = L;
        }
      } else {
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

    // vaciar socketId (marcar desconectado) pero conservar datos del jugador
    if (room.players.player1?.socketId === socket.id) {
      room.players.player1.socketId = "";
    }
    if (room.players.player2?.socketId === socket.id) {
      room.players.player2.socketId = "";
    }

    // Avisar a quien quede en la sala (manteniendo el estado del juego)
    io.to(joinedRoomId).emit("room:update", {
      roomId: room.id,
      roles: {
        player1Taken: !!room.players.player1?.socketId,
        player2Taken: !!room.players.player2?.socketId,
      },
      state: room.state,
      hasWord: !!room.word,
      revealed: room.revealed,
      wrong: Array.from(room.wrong),
      fails: room.fails,
      maxFails: room.maxFails,
    });

    // Si nadie quedó online, programar eliminación tras X ms
    const someoneOnline =
      !!room.players.player1?.socketId || !!room.players.player2?.socketId;

    if (!someoneOnline) {
      // 30s de gracia antes de borrar
      room.reconnectTimeout = setTimeout(() => {
        const current = rooms.get(joinedRoomId!);
        if (!current) return;

        const stillNoOne =
          !current.players.player1?.socketId && !current.players.player2?.socketId;

        if (stillNoOne) {
          rooms.delete(joinedRoomId!);
          console.log("🗑️ Sala eliminada tras timeout:", joinedRoomId);
        }
      }, 30000);
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
