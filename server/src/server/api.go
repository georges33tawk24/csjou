package main

import (
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
)

// JOUCS host controls. Console commands are written to the engine's stdin,
// which the dedicated server reads every frame on its own thread.

type serverState struct {
	Map        string `json:"map"`
	Bots       int    `json:"bots"`
	Difficulty int    `json:"difficulty"`
	Players    int    `json:"players"`
}

const maxBots = 12

var (
	stateMu sync.Mutex
	state   = serverState{Map: "de_dust2", Difficulty: 1}
	console *os.File
	mapRe   = regexp.MustCompile(`^[a-z0-9_]+$`)
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
		}
	}
}

func listMaps() []string {
	files, _ := filepath.Glob("cstrike/maps/*.bsp")
	maps := make([]string, 0, len(files))
	for _, f := range files {
		maps = append(maps, strings.TrimSuffix(filepath.Base(f), ".bsp"))
	}
	sort.Strings(maps)
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
		players := len(peerConnections)
		listLock.RUnlock()
		stateMu.Lock()
		s := state
		stateMu.Unlock()
		s.Players = players
		writeJSON(w, s)
	case "/api/server":
		applySettings(w, r)
	default:
		return false
	}
	return true
}

func applySettings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Password   string `json:"password"`
		Map        string `json:"map"`
		Bots       int    `json:"bots"`
		Difficulty int    `json:"difficulty"`
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
	if !mapRe.MatchString(req.Map) || req.Bots < 0 || req.Bots > maxBots || req.Difficulty < 0 || req.Difficulty > 3 {
		http.Error(w, "invalid settings", http.StatusBadRequest)
		return
	}
	if _, err := os.Stat("cstrike/maps/" + req.Map + ".bsp"); err != nil {
		http.Error(w, "unknown map", http.StatusBadRequest)
		return
	}

	stateMu.Lock()
	defer stateMu.Unlock()
	cmds := []string{"bot_difficulty " + strconv.Itoa(req.Difficulty)}
	if req.Difficulty != state.Difficulty {
		cmds = append(cmds, "bot_kick") // quota re-adds them at the new difficulty
	}
	cmds = append(cmds, "bot_quota "+strconv.Itoa(req.Bots))
	if req.Map != state.Map {
		cmds = append(cmds, "changelevel "+req.Map)
	}
	if _, err := console.WriteString(strings.Join(cmds, "\n") + "\n"); err != nil {
		http.Error(w, "server console unavailable", http.StatusInternalServerError)
		return
	}
	state.Map, state.Bots, state.Difficulty = req.Map, req.Bots, req.Difficulty
	writeJSON(w, state)
}
