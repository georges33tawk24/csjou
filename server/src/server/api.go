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
