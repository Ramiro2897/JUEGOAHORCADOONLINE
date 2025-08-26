import { useEffect, useState } from "react";
import "./App.css";
import { socket } from "./socket";

type Role = "player1" | "player2";
type Phase = "setup" | "chooseWord" | "waiting" | "playing";

function randomRoom() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function App() {
  const [roomId, setRoomId] = useState<string>(() => {
    return localStorage.getItem("roomId") || randomRoom();
  });
  const [connected, setConnected] = useState(false);

  const [selectedRole, setSelectedRole] = useState<Role | null>(() => {
    const saved = localStorage.getItem("selectedRole");
    return (saved as Role) || null;
  });
  const [playerName, setPlayerName] = useState<string>(() => {
    return localStorage.getItem("playerName") || "";
  });

  const [rolesTaken, setRolesTaken] = useState({
    player1Taken: false,
    player2Taken: false,
  });

  const [phase, setPhase] = useState<Phase>("setup");
  const [secretWord, setSecretWord] = useState("");

  const [revealed, setRevealed] = useState<string[]>([]);
  const [fails, setFails] = useState(0);
  const [maxFails, setMaxFails] = useState(6);
  const [wrong, setWrong] = useState<string[]>([]);

  const [letter, setLetter] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  const addError = (msg: string) => {
    setErrors((prev) => [...prev, msg]);
    setTimeout(() => {
      setErrors((prev) => prev.filter((e) => e !== msg));
    }, 5000);
  };

  // -------- Socket listeners (montar UNA vez) ----------
  useEffect(() => {
    // Conexión / desconexión
    const onConnect = () => {
      setConnected(true);
      addError("Conectado al servidor");

      // Auto-join si había sala guardada
      const savedRoom = localStorage.getItem("roomId");
      const savedRole = localStorage.getItem("selectedRole");
      const savedName = localStorage.getItem("playerName");

      const joinRoomId = savedRoom || roomId;
      if (joinRoomId) {
        socket.emit("room:join", { roomId: joinRoomId });
      }

      // Si teníamos rol guardado, reintentamos reclamarlo
      if (joinRoomId && savedRole && savedName) {
        socket.emit("role:pick", {
          roomId: joinRoomId,
          role: savedRole,
          name: savedName,
        });
      }
    };

    const onDisconnect = (reason: any) => {
      setConnected(false);
      addError("Conexión perdida. Intentando reconectar…");
      console.log("Socket desconectado:", reason);
      // NUNCA limpiar estado de juego aquí — lo mantenemos para no mostrar pantalla negra
    };

    const onRoomUpdate = (payload: any) => {
      // roles
      setRolesTaken({
        player1Taken: payload.roles.player1Taken,
        player2Taken: payload.roles.player2Taken,
      });

      // estado / fase
      switch (payload.state) {
        case "waiting_word":
          setPhase(selectedRole === "player1" ? "chooseWord" : "waiting");
          break;
        case "playing":
          setPhase("playing");
          break;
        case "lobby":
          setPhase("setup");
          break;
        case "aborted":
          // si se llegara a usar, mostramos una nota pero mantenemos tablero
          setPhase((prev) => prev); // no cambiar por defecto
          break;
        default:
          break;
      }

      // actualizar contenido del juego si viene
      if (payload.revealed) setRevealed(payload.revealed);
      if (typeof payload.fails === "number") setFails(payload.fails);
      if (typeof payload.maxFails === "number") setMaxFails(payload.maxFails);
      if (payload.wrong) setWrong(payload.wrong);
    };

    const onGameState = (payload: any) => {
      setRevealed(payload.revealed);
      setFails(payload.fails);
      setMaxFails(payload.maxFails);
      setWrong(payload.wrong ?? []);
      setPhase("playing");
    };

    const onError = (err: any) => {
      addError(err?.message ?? "Error en el servidor");
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:update", onRoomUpdate);
    socket.on("game:state", onGameState);
    socket.on("error:msg", onError);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:update", onRoomUpdate);
      socket.off("game:state", onGameState);
      socket.off("error:msg", onError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRole, roomId]);

  // -------- Conectar a sala (botón) ----------
  const connectToRoom = () => {
    if (connected) return;
    // Guardar sala para reconexión automática más adelante
    localStorage.setItem("roomId", roomId);

    if (!socket.connected) {
      socket.connect();
    }
    // onConnect se encargará de emitir room:join y role:pick guardados
  };

  // -------- Manejo rol ----------
  const [askingNameFor, setAskingNameFor] = useState<Role | null>(null);

  const handleRoleClick = (role: Role) => {
    if ((role === "player1" && rolesTaken.player1Taken) || (role === "player2" && rolesTaken.player2Taken)) {
      return;
    }
    setAskingNameFor(role);
    setSelectedRole(role);
    setPlayerName("");
  };

  const confirmRole = () => {
    if (!selectedRole) return;
    if (!playerName.trim()) {
      addError("Ingresa tu nombre");
      return;
    }

    socket.emit("role:pick", {
      roomId,
      role: selectedRole,
      name: playerName.trim(),
    });

    // Persistir para que al reconectar se reclame el rol automáticamente
    localStorage.setItem("selectedRole", selectedRole);
    localStorage.setItem("playerName", playerName.trim());
    setAskingNameFor(null);
  };

  const confirmWord = () => {
    if (!secretWord.trim()) {
      addError("Ingresa una palabra (3-20 letras A-Z)");
      return;
    }
    socket.emit("word:set", { roomId, word: secretWord });
    setSecretWord("");
  };

  const submitGuess = () => {
    const clean = letter
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Z]/g, "");

    if (!clean || clean.length !== 1) {
      addError("Ingresa una sola letra A-Z");
      return;
    }
    socket.emit("guess:letter", { roomId, letter: clean });
    setLetter("");
  };

  // game checks
  const gameWon = revealed.length > 0 && !revealed.includes("_");
  const gameLost = fails >= maxFails;
  const gameOver = gameWon || gameLost;

  return (
    <div className="app" style={{ maxWidth: 520, margin: "40px auto" }}>
      <div className="game">
        <h1>🎮 El ahorcado</h1>
      </div>

      {/* errores */}
      {errors.length > 0 && (
        <div className="errors-container">
          {errors.map((err, idx) => (
            <p key={idx} className="error-message">
              {err}
            </p>
          ))}
        </div>
      )}

      {/* overlay de reconexión (no desmonta UI) */}
      {!connected && (
        <div className="reconnect-overlay">
          <div className="reconnect-card">
            <p>🔌 Conexión perdida… reconectando</p>
          </div>
        </div>
      )}

      {/* ID sala */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", marginBottom: 8 }}>ID de sala</label>
        <div className="room-connect">
          <input
            value={roomId}
            onChange={(e) => {
              setRoomId(e.target.value.toUpperCase());
              localStorage.setItem("roomId", e.target.value.toUpperCase());
            }}
            placeholder="ROOMID"
            style={{ flex: 1 }}
          />
          <button onClick={connectToRoom} disabled={connected} className={connected ? "btn connected" : "btn"}>
            {connected ? "Conectado" : "Entrar"}
          </button>
        </div>
        <small>Comparte este ID con el otro jugador.</small>
      </div>

      {/* elección de rol */}
      <div style={{ marginTop: 12 }}>
        <p>¿Con qué jugador quieres entrar?</p>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => handleRoleClick("player1")} disabled={!connected || rolesTaken.player1Taken}>
            Jugador 1 (elige palabra)
            {rolesTaken.player1Taken ? " — Ocupado" : ""}
          </button>
          <button onClick={() => handleRoleClick("player2")} disabled={!connected || rolesTaken.player2Taken}>
            Jugador 2 (adivina)
            {rolesTaken.player2Taken ? " — Ocupado" : ""}
          </button>
        </div>
      </div>

      {/* Input nombre */}
      {askingNameFor && (
        <div className="player" style={{ marginTop: 16 }}>
          <input
            type="text"
            placeholder={`Tu nombre (${askingNameFor === "player1" ? "Jugador 1" : "Jugador 2"})`}
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
          />
          <button onClick={confirmRole} disabled={!playerName.trim()}>
            Confirmar rol
          </button>
        </div>
      )}

      {/* J1 elegir palabra */}
      {selectedRole === "player1" && phase === "chooseWord" && (
        <div style={{ marginTop: 24 }}>
          <h3>Ingresa la palabra secreta</h3>
          <input
            type="text"
            placeholder="Solo letras A-Z, 3-20"
            value={secretWord}
            onChange={(e) => setSecretWord(e.target.value)}
          />
          <button onClick={confirmWord} className="btn-word" style={{ marginLeft: 8 }}>
            Confirmar palabra
          </button>
          <p className="note" style={{ marginTop: 8 }}>
            * El Jugador 2 no verá la palabra. Se enviará enmascarada.
          </p>
        </div>
      )}

      {/* J2 esperando */}
      {selectedRole === "player2" && phase === "waiting" && (
        <div className="waiting-container">
          <p className="loading">Esperando palabra del jugador 1</p>
          <div className="loader">
            <div className="block b_1"></div>
            <div className="block b_2"></div>
            <div className="block b_3"></div>
            <div className="block b_4"></div>
            <div className="block b_5"></div>
            <div className="block b_6"></div>
            <div className="block b_7"></div>
            <div className="block b_8"></div>
          </div>
        </div>
      )}

      {/* Vista de juego */}
      {phase === "playing" && (
        <div style={{ marginTop: 24 }}>
          <h3>Palabra:</h3>
          <div style={{ letterSpacing: "8px", fontSize: 28 }}>{revealed.join(" ")}</div>

          <p style={{ marginTop: 20, border: "1px solid #f2f2f223", borderRadius: "5px", padding: "6px 10px", display: "inline-block", backgroundColor: "rgba(255,255,255,0.02)" }}>
            Fallos: {fails} / {maxFails}
          </p>

          {wrong.length > 0 && (
            <p style={{ marginTop: 4, border: "1px solid #f2f2f223", borderRadius: "5px", padding: "6px 10px", display: "inline-block", backgroundColor: "rgba(255,255,255,0.02)" }}>
              Letras falladas: {wrong.join(", ")}
            </p>
          )}

          {gameOver && (gameWon ? (
            <div className="celebration-container">
              <p className="result-message win">¡Ganaste!</p>
              <img src="https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExN3JsdXA3amJlY2QyNDNpd2ZoODJob3F5czgzMXZubHkzMDRuY3hwdCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/mIZ9rPeMKefm0/giphy.gif" alt="¡Ganaste!" className="celebration-gif" />
            </div>
          ) : (
            <div className="hangman-container">
              <p className="result-message lose">Ahorcado</p>
              <img src="https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExdmEzZzV6Nmdra2oxb3U0ZzE0OXlrNGN1dmdxbHM3ZTVxcDRjZzF4NyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/ybQIv0CsYm1XY9A8Dm/giphy.gif" alt="Juego del Ahorcado" className="hangman-gif" />
            </div>
          ))}

          {selectedRole === "player2" && !gameOver && (
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <input value={letter} onChange={(e) => setLetter(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitGuess()} placeholder="Ingresa una letra" maxLength={1} style={{ width: 160 }} />
              <button onClick={submitGuess}>Probar letra</button>
            </div>
          )}
        </div>
      )}

      <div className="play-again">
        <button onClick={() => window.location.reload()} className="btn-reload">
          Otra
        </button>
      </div>

      <footer className="footer">
        <p>by Ramiro González {new Date().getFullYear()}</p>
      </footer>
    </div>
  );
}

export default App;
