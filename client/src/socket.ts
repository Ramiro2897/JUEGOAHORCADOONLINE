import { io } from "socket.io-client";

export const socket = io("http://192.168.0.107:4000", {
  autoConnect: false, // nos conectamos cuando tengamos roomId
})
