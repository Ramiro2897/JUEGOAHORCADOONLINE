import { io } from "socket.io-client";

export const socket = io("https://juegoahorcadoonline.onrender.com", {
  autoConnect: false, // nos conectamos cuando tengamos roomId
})
