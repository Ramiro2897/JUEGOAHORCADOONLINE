import { io, Socket } from "socket.io-client";

// https://juegoahorcadoonline.onrender.com ---- http://localhost:4000

// URL del servidor
const SERVER_URL = "https://juegoahorcadoonline.onrender.com";

// Creamos el socket pero **no se conecta automáticamente**
export const socket: Socket = io(SERVER_URL, {
  autoConnect: false, // nos conectamos manualmente desde App.tsx
  reconnection: true, // habilita reconexión automática
  reconnectionAttempts: Infinity, // intentos infinitos
  reconnectionDelay: 1000, // 1 segundo entre intentos
  transports: ["websocket"],
});

// --- Eventos generales de conexión ---
socket.on("connect", () => {
  console.log("Cliente conectado al servidor con id:", socket.id);
});

socket.on("disconnect", (reason) => {
  console.log("Cliente desconectado del servidor:", reason);
});

socket.on("connect_error", (err) => {
  console.log("Error de conexión:", err.message);
});

socket.on("reconnect_attempt", (attempt) => {
  console.log(`Intentando reconexión #${attempt}`);
});
