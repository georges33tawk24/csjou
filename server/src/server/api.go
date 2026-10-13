package main

import (
	"crypto/subtle"
	"encoding/binary"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// JOUCS lobby / host controls. Console commands are written to the engine's
// stdin, which the dedicated server reads every frame on its own thread.

type serverState struct {
	Name       string `json:"name"`
	Map        string `json:"map"`
	MaxPlayers int    `json:"maxPlayers"`
	Bots       int    `json:"bots"`
	Difficulty int    `json:"difficulty"`
	Private    bool   `json:"private"` // the password itself is never sent out
	Players    int    `json:"players"`
}

const maxBots = 12

var (
	stateMu       sync.Mutex
	state         = serverState{Name: "JOUCS", Map: "de_dust2", MaxPlayers: 16, Difficulty: 1}
	lobbyPassword string
	console       *os.File
	mapRe         = regexp.MustCompile(`^[a-z0-9_]+$`)
	passwordRe    = regexp.MustCompile(`^[A-Za-z0-9_-]{1,24}$`)
)

// initConsole replaces stdin with a pipe we control and reads the launch
// settings (+map, +bot_quota, +bot_difficulty) from the command line.
func initConsole() {
	r, w, err := os.Pipe()
	if err != nil {
		panic(err)
	}
	if err := syscall.Dup3(int(r.Fd()), 0, 0); err != nil {
		panic(err)
	}
	console = w
	for i := 0; i+1 < len(os.Args); i++ {
		v := os.Args[i+1]
		switch os.Args[i] {
		case "+map":
			state.Map = v
		case "+bot_quota":
			state.Bots, _ = strconv.Atoi(v)
		case "+bot_difficulty":
			state.Difficulty, _ = strconv.Atoi(v)
		case "+maxplayers":
			state.MaxPlayers, _ = strconv.Atoi(v)
		}
	}
}

type mapInfo struct {
	Name string `json:"name"`
	Nav  bool   `json:"nav"` // bots are ready without generating a nav mesh first
}

func listMaps() []mapInfo {
	files, _ := filepath.Glob("cstrike/maps/*.bsp")
	sort.Strings(files)
	maps := make([]mapInfo, 0, len(files))
	for _, f := range files {
		_, err := os.Stat(strings.TrimSuffix(f, ".bsp") + ".nav")
		maps = append(maps, mapInfo{Name: strings.TrimSuffix(filepath.Base(f), ".bsp"), Nav: err == nil})
	}
	return maps
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(v)
}

func handleAPI(w http.ResponseWriter, r *http.Request) bool {
	switch r.URL.Path {
	case "/api/maps":
		writeJSON(w, listMaps())
	case "/api/status":
		listLock.RLock()
		players := len(peerConnections) + int(gameSockets.Load())
		listLock.RUnlock()
		stateMu.Lock()
		s := state
		stateMu.Unlock()
		s.Players = players
		writeJSON(w, s)
	case "/api/server":
		applySettings(w, r)
	case "/game":
		gameSocketHandler(w, r)
	case "/api/join":
		checkJoin(w, r)
	default:
		if !strings.HasPrefix(r.URL.Path, "/api/nav/") {
			return false
		}
		handleNav(w, r, strings.TrimPrefix(r.URL.Path, "/api/nav/"))
	}
	return true
}

// setNavBspSize rewrites the .bsp size stamped in a v4+ nav header. ReGameDLL
// warns players when it differs from the map it loads, and the browser engine
// cannot stat the .bsp (it stamps 0xFFFFFFFF), so each side gets its own value.
func setNavBspSize(nav []byte, size uint32) {
	if len(nav) >= 12 && binary.LittleEndian.Uint32(nav[4:]) >= 4 {
		binary.LittleEndian.PutUint32(nav[8:], size)
	}
}

// Bot navigation meshes. Generating one takes ~30s in a browser but many
// minutes on the emulated 32-bit server, so offline games upload theirs.
const navMagic = 0xFEEDFACE

func handleNav(w http.ResponseWriter, r *http.Request, name string) {
	if !mapRe.MatchString(name) {
		http.NotFound(w, r)
		return
	}
	path := "cstrike/maps/" + name + ".nav"
	switch r.Method {
	case http.MethodGet:
		data, err := os.ReadFile(path)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		setNavBspSize(data, 0xFFFFFFFF) // what the browser engine reads as the .bsp size
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write(data)
	case http.MethodPost:
		bsp, err := os.Stat("cstrike/maps/" + name + ".bsp")
		if err != nil {
			http.Error(w, "unknown map", http.StatusBadRequest)
			return
		}
		if _, err := os.Stat(path); err == nil {
			w.WriteHeader(http.StatusNoContent) // first upload wins; never overwrite
			return
		}
		data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 16<<20))
		if err != nil || len(data) < 8 || binary.LittleEndian.Uint32(data) != navMagic {
			http.Error(w, "not a nav file", http.StatusBadRequest)
			return
		}
		setNavBspSize(data, uint32(bsp.Size()))
		tmp := path + ".upload"
		if err := os.WriteFile(tmp, data, 0o644); err != nil || os.Rename(tmp, path) != nil {
			http.Error(w, "could not save", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusCreated)
	default:
		http.Error(w, "GET or POST", http.StatusMethodNotAllowed)
	}
}

func applySettings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Password      string `json:"password"` // host password
		Name          string `json:"name"`
		Map           string `json:"map"`
		MaxPlayers    int    `json:"maxPlayers"`
		Bots          int    `json:"bots"`
		Difficulty    int    `json:"difficulty"`
		Private       bool   `json:"private"`
		LobbyPassword string `json:"lobbyPassword"` // empty keeps the current one
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	pass := os.Getenv("ADMIN_PASSWORD")
	if pass == "" {
		http.Error(w, "host controls are off: start the server with ADMIN_PASSWORD set", http.StatusForbidden)
		return
	}
	if subtle.ConstantTimeCompare([]byte(req.Password), []byte(pass)) != 1 {
		http.Error(w, "wrong host password", http.StatusForbidden)
		return
	}
	// validated values are the only thing that reaches the console
	name := strings.TrimSpace(strings.Map(func(r rune) rune {
		if r < ' ' || strings.ContainsRune(`";\\`, r) {
			return -1
		}
		return r
	}, req.Name))
	if name == "" {
		name = "JOUCS"
	}
	if r := []rune(name); len(r) > 32 {
		name = string(r[:32])
	}
	if !mapRe.MatchString(req.Map) || req.MaxPlayers < 2 || req.MaxPlayers > 32 ||
		req.Bots < 0 || req.Bots > maxBots || req.Bots >= req.MaxPlayers || req.Difficulty < 0 || req.Difficulty > 3 {
		http.Error(w, "invalid settings", http.StatusBadRequest)
		return
	}
	if req.LobbyPassword != "" && !passwordRe.MatchString(req.LobbyPassword) {
		http.Error(w, "lobby password: 1-24 letters, numbers, - or _", http.StatusBadRequest)
		return
	}
	if _, err := os.Stat("cstrike/maps/" + req.Map + ".bsp"); err != nil {
		http.Error(w, "unknown map", http.StatusBadRequest)
		return
	}

	stateMu.Lock()
	defer stateMu.Unlock()
	pw := ""
	if req.Private {
		pw = req.LobbyPassword
		if pw == "" {
			pw = lobbyPassword
		}
		if pw == "" {
			http.Error(w, "set a lobby password for a private lobby", http.StatusBadRequest)
			return
		}
	}
	cmds := []string{
		`hostname "` + name + `"`,
		`sv_password "` + pw + `"`,
		"bot_difficulty " + strconv.Itoa(req.Difficulty),
	}
	if req.Difficulty != state.Difficulty {
		cmds = append(cmds, "bot_kick") // quota re-adds them at the new difficulty
	}
	cmds = append(cmds, "bot_quota "+strconv.Itoa(req.Bots))
	if req.MaxPlayers != state.MaxPlayers {
		// player slots only change when the map restarts; everyone has to rejoin
		cmds = append(cmds, "maxplayers "+strconv.Itoa(req.MaxPlayers), "map "+req.Map)
	} else if req.Map != state.Map {
		cmds = append(cmds, "changelevel "+req.Map)
	}
	if _, err := console.WriteString(strings.Join(cmds, "\n") + "\n"); err != nil {
		http.Error(w, "server console unavailable", http.StatusInternalServerError)
		return
	}
	lobbyPassword = pw
	state.Name, state.Map, state.MaxPlayers = name, req.Map, req.MaxPlayers
	state.Bots, state.Difficulty, state.Private = req.Bots, req.Difficulty, pw != ""
	writeJSON(w, state)
}

// checkJoin lets the page verify a private lobby's password before it starts
// the game: the engine only reports a rejection inside its own menu.
func checkJoin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&req)
	stateMu.Lock()
	pw := lobbyPassword
	stateMu.Unlock()
	if pw != "" && subtle.ConstantTimeCompare([]byte(req.Password), []byte(pw)) != 1 {
		time.Sleep(500 * time.Millisecond) // slow down guessing
		http.Error(w, "Wrong lobby password.", http.StatusForbidden)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
