import { io } from "socket.io-client";


// https://juegoahorcadoonline.onrender.com ---- http://localhost:4000
export const socket = io("https://juegoahorcadoonline.onrender.com", {
  autoConnect: false, // nos conectamos cuando tengamos roomId
  reconnection: true, // habilita reconexión automática
  reconnectionAttempts: Infinity, // intentos infinitos
  reconnectionDelay: 1000, // 1s entre intentos
  transports: ["websocket"],
})

// 2️⃣ Conectamos manualmente cuando queramos
socket.connect();

// 3️⃣ Escuchamos el evento de conexión para ver que el cliente se conectó
socket.on("connect", () => {
  console.log("Cliente conectado al servidor con id:", socket.id);
});

socket.on("disconnect", (reason) => {
  console.log("Cliente desconectado del servidor:", reason);
});