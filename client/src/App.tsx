import { useEffect, useState } from "react";
import "./App.css";
import { socket } from "./socket";

type Role = "player1" | "player2";
type Phase = "setup" | "chooseWord" | "waiting" | "playing";

// genera el id de la sala
function randomRoom() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function App() {
  const [roomId, setRoomId] = useState<string>(randomRoom());
  const [connected, setConnected] = useState(false);

  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [playerName, setPlayerName] = useState("");

  const [rolesTaken, setRolesTaken] = useState({
    player1Taken: false,
    player2Taken: false,
  });

  const [phase, setPhase] = useState<Phase>("setup");
  const [secretWord, setSecretWord] = useState("");

  // estado del juego enviado por el server
  const [revealed, setRevealed] = useState<string[]>([]);
  const [fails, setFails] = useState(0);
  const [maxFails, setMaxFails] = useState(6);
  const [wrong, setWrong] = useState<string[]>([]);

  // input local del jugador 2
  const [letter, setLetter] = useState("");

  // mensajes de error
  const [errors, setErrors] = useState<string[]>([]);

  // helper para mostrar errores temporales
  const addError = (msg: string) => {
    setErrors((prev) => [...prev, msg]);
    setTimeout(() => {
      setErrors((prev) => prev.filter((e) => e !== msg));
    }, 5000);
  };

  // pérdida de la conexión
  useEffect(() => {
    const onDisconnect = () => {
      console.log("Se perdió la conexión con la sala");
      setConnected(false);
      addError("Conexión perdida con el servidor");
    };

    socket.on("disconnect", onDisconnect);

    return () => {
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  // subscripción a eventos socket
  useEffect(() => {
    if (!connected) return;

    const onRoomUpdate = (payload: any) => {
      setRolesTaken({
        player1Taken: payload.roles.player1Taken,
        player2Taken: payload.roles.player2Taken,
      });

      // actualizar fase según el estado real del servidor
      switch (payload.state) {
        case "waiting_word":
          setPhase(selectedRole === "player1" ? "chooseWord" : "waiting");
          break;
        case "playing":
          setRevealed(payload.revealed);
          setFails(payload.fails);
          setMaxFails(payload.maxFails);
          setWrong(payload.wrong ?? []);
          setPhase("playing");
          break;
        case "aborted":
          setPhase("setup");
          setSelectedRole(null);
          setPlayerName("");
          break;
        default:
          break;
      }
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

    socket.on("room:update", onRoomUpdate);
    socket.on("game:state", onGameState);
    socket.on("error:msg", onError);

    return () => {
      socket.off("room:update", onRoomUpdate);
      socket.off("game:state", onGameState);
      socket.off("error:msg", onError);
    };
  }, [connected, selectedRole]);

  // conectar a la sala manda el id de la sala al servidor
  const connectToRoom = () => {
    if (connected) return;

    if (!socket.connected) {
      socket.connect();
    }

    socket.once("connect", () => {
      socket.emit("room:join", { roomId });
      setConnected(true);
    });
  };

  // elegir rol
  const [askingNameFor, setAskingNameFor] = useState<Role | null>(null);

  const handleRoleClick = (role: Role) => {
    if (
      (role === "player1" && rolesTaken.player1Taken) ||
      (role === "player2" && rolesTaken.player2Taken)
    ) {
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
  };

  const confirmWord = () => {
    if (!secretWord.trim()) {
      addError("Ingresa una palabra (3-20 letras A-Z)");
      return;
    }
    socket.emit("word:set", { roomId, word: secretWord });
    setSecretWord("");
  };

  // ------- J2: enviar letra -------
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

  const gameWon = revealed.length > 0 && !revealed.includes("_");
  const gameLost = fails >= maxFails;
  const gameOver = gameWon || gameLost;

  // ----------- UI -----------
  return (
    <div className="app" style={{ maxWidth: 520, margin: "40px auto" }}>
      <div className="game">
        <h1>🎮 El ahorcado</h1>
      </div>

      {/* Mostrar errores */}
      {errors.length > 0 && (
        <div className="errors-container">
          {errors.map((err, idx) => (
            <p key={idx} className="error-message">
              {err}
            </p>
          ))}
        </div>
      )}

      {/* ID sala */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", marginBottom: 8 }}>ID de sala</label>
        <div className="room-connect">
          <input
            value={roomId}
            onChange={(e) => setRoomId(e.target.value.toUpperCase())}
            placeholder="ROOMID"
            style={{ flex: 1 }}
          />
          <button
            onClick={connectToRoom}
            disabled={connected}
            className={connected ? "btn connected" : "btn"}
          >
            {connected ? "Conectado" : "Entrar"}
          </button>
        </div>
        <small>Comparte este ID con el otro jugador.</small>
      </div>

      {/* Elección de rol */}
      <div style={{ marginTop: 12 }}>
        <p>¿Con qué jugador quieres entrar?</p>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => handleRoleClick("player1")}
            disabled={!connected || rolesTaken.player1Taken}
          >
            Jugador 1 (elige palabra)
            {rolesTaken.player1Taken ? " — Ocupado" : ""}
          </button>
          <button
            onClick={() => handleRoleClick("player2")}
            disabled={!connected || rolesTaken.player2Taken}
          >
            Jugador 2 (adivina)
            {rolesTaken.player2Taken ? " — Ocupado" : ""}
          </button>
        </div>
      </div>

      {/* Input de nombre */}
      {askingNameFor && (
        <div className="player" style={{ marginTop: 16 }}>
          <input
            type="text"
            placeholder={`Tu nombre (${
              askingNameFor === "player1" ? "Jugador 1" : "Jugador 2"
            })`}
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
          />
          <button onClick={confirmRole} disabled={!playerName.trim()}>
            Confirmar rol
          </button>
        </div>
      )}

      {/* Vista de J1: elegir palabra */}
      {selectedRole === "player1" && phase === "chooseWord" && (
        <div style={{ marginTop: 24 }}>
          <h3>Ingresa la palabra secreta</h3>
          <input
            type="text"
            placeholder="Solo letras A-Z, 3-20"
            value={secretWord}
            onChange={(e) => setSecretWord(e.target.value)}
          />
          <button
            onClick={confirmWord}
            className="btn-word"
            style={{ marginLeft: 8 }}
          >
            Confirmar palabra
          </button>
          <p className="note" style={{ marginTop: 8 }}>
            * El Jugador 2 no verá la palabra. Se enviará enmascarada.
          </p>
        </div>
      )}

      {/* Vista de J2: esperando */}
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
          <div style={{ letterSpacing: "8px", fontSize: 28 }}>
            {revealed.join(" ")}
          </div>

          <p
            style={{
              marginTop: 20,
              border: "1px solid #f2f2f223",
              borderRadius: "5px",
              padding: "6px 10px",
              display: "inline-block",
              backgroundColor: "rgba(255, 255, 255, 0.02)",
            }}
          >
            Fallos: {fails} / {maxFails}
          </p>

          {wrong.length > 0 && (
            <p
              style={{
                marginTop: 4,
                border: "1px solid #f2f2f223",
                borderRadius: "5px",
                padding: "6px 10px",
                display: "inline-block",
                backgroundColor: "rgba(255, 255, 255, 0.02)",
              }}
            >
              Letras falladas: {wrong.join(", ")}
            </p>
          )}

          {/* Mensajes de fin */}
          {gameOver && (
            gameWon ? (
              <div className="celebration-container">
                <p className="result-message win">¡Ganaste!</p>
                <img
                  src="https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExN3JsdXA3amJlY2QyNDNpd2ZoODJob3F5czgzMXZubHkzMDRuY3hwdCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/mIZ9rPeMKefm0/giphy.gif"
                  alt="¡Ganaste!"
                  className="celebration-gif"
                />
              </div>
            ) : (
              <div className="hangman-container">
                <p className="result-message lose">Ahorcado</p>
                <img
                  src="https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExdmEzZzV6Nmdra2oxb3U0ZzE0OXlrNGN1dmdxbHM3ZTVxcDRjZzF4NyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/ybQIv0CsYm1XY9A8Dm/giphy.gif"
                  alt="Juego del Ahorcado"
                  className="hangman-gif"
                />
              </div>
            )
          )}

          {/* Input de adivinar SOLO para J2 y si no ha terminado */}
          {selectedRole === "player2" && !gameOver && (
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <input
                value={letter}
                onChange={(e) => setLetter(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitGuess()}
                placeholder="Ingresa una letra"
                maxLength={1}
                style={{ width: 160 }}
              />
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
