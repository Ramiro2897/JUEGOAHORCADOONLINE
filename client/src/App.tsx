import { useEffect, useState } from "react";
import "./App.css";
import { socket } from "./socket";


// genera un ID de 6 letras mayúsculas
function generarSalaId(): string {
  const letras = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let id = "";
  for (let i = 0; i < 6; i++) {
    id += letras.charAt(Math.floor(Math.random() * letras.length));
  }
  return id;
}

function App() {
  const [salaId, setSalaId] = useState(() => {
    const guardado = localStorage.getItem("salaId");
    if (guardado) return guardado;
    const nuevo = generarSalaId();
    localStorage.setItem("salaId", nuevo);
    return nuevo;
  });

  const [userId, setUserId] = useState(() => {
  const guardado = localStorage.getItem("userId");
  if (guardado) return guardado;

  function generarUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
  }

  const nuevo = generarUUID(); // genera un UUID único
  localStorage.setItem("userId", nuevo);
  return nuevo;
  });

  const [conectado, setConectado] = useState(false);

  const entrarSala = () => {
    // alert('entra');
    socket.emit("entrar:sala", { salaId, userId });
  };

// ---------------------eventos--------------------
  const [sala, setSala] = useState<any>(null);
  const [resultado, setResultado] = useState<"ganado" | "perdido" | null>(null);

  useEffect(() => {
  // entra a la sala y marca true
  socket.on("sala:entrada:ok", () => {
    // alert('lo recibe');
    setConectado(true); // solo aquí pasa a verde
  });

  socket.on("sala:llena", ({  }) => {
    alert('sala llena');
  });

   socket.on("sala:actualizada", (room) => {
    alert('rebido se actualizo la sala')
    console.log("📩 Sala actualizada:", room);
    setSala(room);
    setResultado(room?.resultado ?? null);
  });

  socket.on("juego:ganado", ({ }) => {
    setResultado("ganado");
  });

    socket.on("juego:perdido", ({ }) => {
    setResultado("perdido");
  });

  socket.on("letra:repetida", ({ }) => {
    alert('ya usaste esta letra'); 
  });


  return () => {
    socket.off("sala:entrada:ok");
    socket.off("sala:llena");
    socket.off("sala:actualizada");
    socket.off("juego:ganado");
    socket.off("juego:perdido");
    socket.off("letra:repetida");
  };
  }, []);

  // nuevo id para la sala
  const nuevoIdSala = () => {
    const nuevo = generarSalaId();
    localStorage.setItem("salaId", nuevo);
    setSalaId(nuevo);

    // generar también un nuevo userId
    const nuevoUserId = crypto.randomUUID();
    localStorage.setItem("userId", nuevoUserId);
    setUserId(nuevoUserId); 
    window.location.reload();
  };

  const [pidiendoNombrePara, setPidiendoNombrePara] = useState<"jugador1" | "jugador2" | null>(null);
  const [nombreJugador, setNombreJugador] = useState("");
  // elegir rol para jugar
  const handlePedirNombre = (rol: "jugador1" | "jugador2") => {
  if (!conectado) return; // solo si está conectado
  setPidiendoNombrePara(rol);
  };

  // confirmacion del rol
  const confirmarRol = () => {
  if (!nombreJugador) return; // validar que haya escrito algo
  // emitimos al servidor: rol y nombre
  socket.emit("asignar:rol", { salaId, userId, rol: pidiendoNombrePara, nombre: nombreJugador });
  setPidiendoNombrePara(null);
  setNombreJugador(""); 
};

  // confirmar palabra del jugador1
  const [palabra, setPalabra] = useState("");
  const confirmarPalabra = () => {
    if (!palabra) return;

    // limpiar palabra: solo letras A-Z, sin espacios ni acentos
    const limpia = palabra
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // quita acentos
      .replace(/[^a-zA-Z]/g, "") // solo letras
      .toUpperCase();

    if (limpia.length < 3 || limpia.length > 20) {
      alert("La palabra debe tener entre 3 y 20 letras.");
      return;
    }
    console.log(salaId, userId, 'valoressss');
    // enviar al servidor
    socket.emit("definir:palabra", { salaId, userId, palabra: limpia });

    // limpiar input
    setPalabra("");
  };

  // enviar letra por letra (funcion)
  const [letra, setLetra] = useState("");
  const manejarEnvioLetra = () => {
    if (!letra) {
      alert("Debes ingresar una letra");
      return;
    }

    // regex: solo letras (mayúsculas o minúsculas)
    if (!/^[a-zA-ZñÑ]$/.test(letra)) {
      alert("Debes ingresar una letra válida");
      return;
    }
   socket.emit("probar:letra", { salaId, userId, letra: letra.toLowerCase()});
    // limpiar el input
    setLetra("");
  };

  return (
  <div className="app" style={{ maxWidth: 520, margin: "40px auto" }}>
    <div className="game">
      <h1>🎮 El ahorcado</h1>
    </div>

    {/* overlay de reconexión */}
    {/* {reconectando && ( */}
      <div className="reconnect-overlay">
        <div className="reconnect-card">
          {/* <p>Reconectando...</p> */}
        </div>
      </div>
    {/* )} */}

    {/* ID sala */}
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", marginBottom: 8 }}>ID de sala</label>
      <div className="room-connect">
        <input
          value={salaId}
          onChange={(e) => setSalaId(e.target.value.toUpperCase())}
          placeholder="IDSALA"
          style={{ flex: 1 }}
        />
        <button
            onClick={entrarSala}
            className={conectado ? "connected" : ""}
            disabled={conectado}
          >
            {conectado ? "Conectado" : "Entrar"}
          </button>
      </div>
      <small>Comparte este ID con el otro jugador.</small>
    </div>

    {/* elección de rol */}
    <div style={{ marginTop: 12 }}>
      <p>¿Con qué jugador quieres entrar?</p>
      <div style={{ display: "flex", gap: 8 }}>
        <button
           onClick={() => handlePedirNombre("jugador1")}
           disabled={!conectado || !!sala?.players.jugador1}
           style={{
            borderColor: sala?.players.jugador1 ? "#646cff" : undefined,
           }}

        >
          Jugador 1, elige palabra
          {sala?.players.jugador1 ? ` - ${sala.players.jugador1.name}` : ""}
        </button>

        <button
          onClick={() => handlePedirNombre("jugador2")}
          disabled={!conectado || !!sala?.players.jugador2}
          style={{
            borderColor: sala?.players.jugador2 ? "#646cff" : undefined,
           }}
        >
          Jugador 2, adivina palabra
          {sala?.players.jugador2 ? ` - ${sala.players.jugador2.name}` : ""}
        </button>
      </div>
    </div>

    {/* Input nombre */}
    {pidiendoNombrePara && (
      <div className="player" style={{ marginTop: 16 }}>
        <input
          type="text"
          placeholder={`Tu nombre (${pidiendoNombrePara === "jugador1" ? "Jugador 1" : "Jugador 2"})`}
          value={nombreJugador}
          onChange={(e) => setNombreJugador(e.target.value)}
        />
        <button onClick={confirmarRol}>Confirmar rol</button>
      </div>
    )}

    {/* J1 elegir palabra */}
    {conectado &&
     sala?.players.jugador1 &&
     sala?.players.jugador2 &&
     userId === sala.players.jugador1.userId && !sala.word &&  (
      <div style={{ marginTop: 24 }}>
        <h3>Ingresa la palabra secreta</h3>
        <input
          type="text"
          placeholder="Solo letras A-Z, 3-20"
          value={palabra}
          onChange={(e) => setPalabra(e.target.value)}
        />
        <button className="btn-word" style={{ marginLeft: 8 }} onClick={confirmarPalabra}>
          Confirmar palabra
        </button>
        <p className="note" style={{ marginTop: 8 }}>
          * El Jugador 2 no verá la palabra. Se enviará enmascarada.
        </p>
      </div>
    )}

    {/* J2 esperando */}
    {conectado &&
     sala?.players.jugador2 &&
     userId === sala.players.jugador2.userId &&
     !sala.word && (
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
    {conectado && sala?.word && (
    <div style={{ marginTop: 24, }}>
      <h3>Palabra:</h3>
      <div style={{ letterSpacing: "8px", fontSize: 28 }}>
        {sala?.revealed ? sala.revealed.join(" ") : ""}
      </div>

      <div style={{ display: "flex", justifyContent: "center", gap: "10px", marginTop: 20}}>
        <p
          style={{
            border: "1px solid #f2f2f223",
            borderRadius: "5px",
            padding: "6px 10px",
            display: "inline-block",
            backgroundColor: "rgba(255,255,255,0.02)"
          }}
        >
          Fallos: {sala?.fails ?? 0} / {sala?.maxFails ?? 6}
        </p>

        <p
          style={{
            border: "1px solid #f2f2f223",
            borderRadius: "5px",
            padding: "6px 10px",
            display: "inline-block",
            backgroundColor: "rgba(255,255,255,0.02)"
          }}
        >
          Letras: {sala ? Array.from(sala.wrong).join(", ") : ""}
        </p>
      </div>

      {resultado === "ganado" && conectado && (
      <div className="celebration-container">
        <p className="result-message win">¡Ganaste!</p>
        <img
          src="https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExN3JsdXA3amJlY2QyNDNpd2ZoODJob3F5czgzMXZubHkzMDRuY3hwdCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/mIZ9rPeMKefm0/giphy.gif"
          alt="¡Ganaste!"
          className="celebration-gif"
        />
      </div>
      )}

      {resultado === "perdido" && conectado && (
      <div className="hangman-container">
        <p className="result-message lose">Ahorcado</p>
        <img
          src="https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExdmEzZzV6Nmdra2oxb3U0ZzE0OXlrNGN1dmdxbHM3ZTVxcDRjZzF4NyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/ybQIv0CsYm1XY9A8Dm/giphy.gif"
          alt="Juego del Ahorcado"
          className="hangman-gif"
        />
      </div>
      )}

      {/* Input solo para jugador 2 */}
        {conectado && sala?.players.jugador1 && sala?.players.jugador2 &&
        userId === sala.players.jugador2.userId &&
        !!sala.word && resultado === null &&  (
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <input
              placeholder="Ingresa una letra"
              maxLength={1}
              value={letra}
              onChange={(e) => setLetra(e.target.value)}
              style={{ width: 160 }}
            />
            <button onClick={manejarEnvioLetra}>Probar letra</button>
          </div>
      )}
      </div>
      )}

    <div className="play-again">
      <button  className="btn-reload" onClick={nuevoIdSala}>
        Nueva sala
      </button>
    </div>

    <footer className="footer">
      <p> © by Ramiro González {new Date().getFullYear()}</p>
    </footer>
  </div>
);
}

export default App;
