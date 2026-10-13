package main

import (
	"math/rand"
	"net/http"
	"sync"
	"sync/atomic"

	"github.com/gorilla/websocket"
	goxash3d_fwgs "github.com/yohimik/goxash3d-fwgs/pkg"
)

// Game packets over a WebSocket, one binary message per packet. Unlike the
// WebRTC path this needs no open UDP port, so players can join through an
// HTTPS tunnel even behind CGNAT. Each player gets an engine address from the
// same pool the WebRTC peers use; SendTo looks the writer up by its first byte.

var gameSockets atomic.Int32

type socketWriter struct {
	mu   sync.Mutex
	conn *websocket.Conn
}

func (s *socketWriter) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.conn.WriteMessage(websocket.BinaryMessage, p); err != nil {
		return 0, err
	}
	return len(p), nil
}

func gameSocketHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	conn.SetReadLimit(messageSize)

	index, err := pool.TryGet()
	if err != nil {
		return // server full
	}
	defer pool.TryPut(index)
	ip := [4]byte{index, byte(rand.Intn(256)), byte(rand.Intn(256)), byte(rand.Intn(256))}

	connections[index] = &socketWriter{conn: conn}
	gameSockets.Add(1)
	defer gameSockets.Add(-1)

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		net.PushPacket(goxash3d_fwgs.Packet{
			Addr: goxash3d_fwgs.Addr{IP: ip, Port: 1000},
			Data: data,
		})
	}
}
