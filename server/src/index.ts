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

type Role = "jugador1" | "jugador2";
type RoomState = "lobby" | "waiting_word" | "playing" | "aborted";

interface PlayerSlot {
  socketId: string;
  userId: string;   // ⚡ el id del usuario que viene del cliente
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
  connections: Record<string, { socketId: string; userId: string }>;
  resultado?: "ganado" | "perdido" | null; 
}

const rooms = new Map<string, GameRoom>();

// ---------------- SOCKET.IO ----------------
io.on("connection", (socket) => {
  socket.on("entrar:sala", ({ salaId, userId }: { salaId: string; userId: string }) => {
    console.log('entrando a la sala', salaId);
  // obtener o crear la sala (no se asignan roles aquí)
  let room = rooms.get(salaId);

  if (!room) {
    const newRoom: GameRoom = {
      id: salaId,
      state: "lobby",
      players: { jugador1: undefined, jugador2: undefined },
      word: undefined,
      revealed: [],
      wrong: new Set<string>(),
      fails: 0,
      maxFails: 6,
      createdAt: Date.now(),
      reconnectTimeout: null,
      connections: {} as Record<string, { socketId: string; userId: string }>,
      resultado: null,
    };

    rooms.set(salaId, newRoom);
    room = newRoom; // ahora room SIEMPRE es GameRoom
  }

  // asegurar que exista el mapa de conexiones
  if (!((room as any).connections)) (room as any).connections = {};

  const connections = (room as any).connections as Record<string, { socketId: string; userId: string }>;

  if (connections[userId]) {
  // Solo actualizar su socketId, no contamos como un nuevo jugador
  connections[userId].socketId = socket.id;
} else {
  // contar usuarios conectados actualmente (solo por conexiones)
  const currentCount = Object.keys(connections).length;

  if (currentCount >= 2) {
    console.log('sala llena');
    socket.emit("sala:llena", { mensaje: "La sala ya tiene 2 jugadores." });
    return;
  }
  // registrar/actualizar la conexión del usuario (nuevo)
  connections[userId] = { socketId: socket.id, userId };
  }

  // unir el socket a la sala de socket.io
  socket.join(salaId);
  // ✅ Enviar confirmación SOLO al que entra
  socket.emit("sala:entrada:ok", { salaId, userId });
  // console.log("Estado actual de la sala:", JSON.stringify(room, null, 2));
  io.to(salaId).emit("sala:actualizada", {
    ...room,
    wrong: Array.from(room.wrong),  // convertimos Set a Array
  });
});

// cuando se asinga un rol escucha
socket.on(
  "asignar:rol",
  ({
    salaId,
    userId,
    rol,
    nombre,
  }: {
    salaId: string;
    userId: string;
    rol: "jugador1" | "jugador2";
    nombre: string;
  }) => {
    const room = rooms.get(salaId);
    if (!room) {
      socket.emit("error", { mensaje: "Sala no encontrada" });
      return;
    }

    // actualizar el jugador correspondiente
    room.players[rol] = {
      socketId: socket.id,
      userId,
      name: nombre,
    };

    // console.log(`Jugador asignado: ${rol} -> ${nombre}`);
    // console.log("Sala actualizada:", JSON.stringify(room, null, 2));

    // emitir a todos en la sala que se actualizó
    io.to(salaId).emit("sala:actualizada", room);
  }
);

// cuando se asigna la palabra
socket.on(
  "definir:palabra",
  ({
    salaId,
    userId,
    palabra,
  }: {
    salaId: string;
    userId: string;
    palabra: string;
  }) => {
    // console.log("📩 Definir palabra recibido:", { salaId, userId, palabra });
    const room = rooms.get(salaId);
    if (!room) {
      // console.log('error en la sala');
      socket.emit("error", { mensaje: "Sala no encontrada" });
      return;
    }

    // validar que quien envía la palabra sea jugador1
    // console.log("📦 Estado actual de players:", room.players);
    if (room.players.jugador1?.userId !== userId) {
      console.log('error en el jugador', room.players.jugador1?.userId);
      socket.emit("error", { mensaje: "Solo el Jugador 1 puede definir la palabra." });
      return;
    }

    // limpiar palabra: solo letras A-Z, sin espacios ni acentos
    const limpia = palabra
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // quitar acentos
      .replace(/[^a-zA-Z]/g, "") // solo letras
      .toUpperCase();

    if (limpia.length < 3 || limpia.length > 20) {
      // console.log('error de letra');
      socket.emit("error", { mensaje: "La palabra debe tener entre 3 y 20 letras." });
      return;
    }

    // asignar palabra al objeto sala
    room.word = limpia;
    room.state = "waiting_word"; // opcional: actualizar estado
    // 👇 Inicializamos los guiones bajos
    room.revealed = Array(limpia.length).fill("_");

    // console.log(`Palabra definida por Jugador 1: ${limpia}`);
    // console.log("Sala actualizada:", JSON.stringify(room, null, 2));

    // emitir la sala actualizada a todos
    io.to(salaId).emit("sala:actualizada", room);
  }
);

// cuando jugador2 prueba una letra
socket.on(
  "probar:letra",
  ({ salaId, userId, letra }: { salaId: string; userId: string; letra: string }) => {
    console.log('letra recibida', letra, userId, salaId);
    const room = rooms.get(salaId);
    if (!room || !room.word) {
      console.log('Sala o palabra no encontrada');
      socket.emit("error", { mensaje: "Sala o palabra no encontrada." });
      return;
    }

    // validar que exista jugador2 y que sea él quien manda
    if (!room.players.jugador2 || room.players.jugador2.userId !== userId) {
      console.log('Solo el Jugador 2 puede probar letras');
      socket.emit("error", { mensaje: "Solo el Jugador 2 puede probar letras." });
      return;
    }

    const letraMayus = letra.toUpperCase();

    // si ya la probó antes, no hacemos nada
    if (room.revealed.includes(letraMayus) || room.wrong.has(letraMayus)) {
      // buscamos el socket del jugador2
      const jugador2SocketId = room.players.jugador2?.socketId;
      if (jugador2SocketId) {
        io.to(jugador2SocketId).emit("letra:repetida", {
          mensaje: `Ya probaste la letra ${letraMayus}`
        });
      }
      return;
    }

    // revisar si la letra está en la palabra
    if (room.word.includes(letraMayus)) {
    // Revelar todas las posiciones donde aparezca la letra
      room.word.split("").forEach((l, idx) => {
    if (l === letraMayus) {
      room.revealed[idx] = letraMayus;
      console.log('letra en la palabraaaaaaa')
    }
    });
    } else {
      console.log('fallos y letras agregados')
      room.wrong.add(letraMayus);
      room.fails++;
    }

    // chequear condiciones de victoria o derrota
    const todasReveladas = room.revealed.every((l) => l !== "_");
    if (todasReveladas) {
      room.resultado = "ganado"; // <-- guardamos estado
      console.log('ganó el idiota');
      io.to(salaId).emit("juego:ganado", { salaId });
    } else if (room.fails >= room.maxFails) {
      room.resultado = "perdido";
      console.log('perdio el idiota');
      io.to(salaId).emit("juego:perdido", { salaId });
    }

    console.log("📌 Estado final de la salaaaaaaa:", JSON.stringify(room, null, 2));
    // emitir sala actualizada siempre
    io.to(salaId).emit("sala:actualizada", {
    ...room,
    wrong: Array.from(room.wrong)
    });
  }
);

  socket.on("disconnect", () => {
    // console.log("Cliente desconectado:", socket.id);
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
