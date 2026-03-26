package main

import (
	"embed"
	"log"
	"net/http"
	"os"

	"github.com/frontier-corm/puzzle-service/internal/corm"
	"github.com/frontier-corm/puzzle-service/internal/handlers"
	"github.com/frontier-corm/puzzle-service/internal/puzzle"
	"github.com/frontier-corm/puzzle-service/internal/server"
	"github.com/frontier-corm/puzzle-service/internal/words"
)

//go:embed internal/templates/*.html
var templateFS embed.FS

//go:embed static/*
var staticFS embed.FS

func main() {
	port := os.Getenv("PUZZLE_PORT")
	if port == "" {
		port = "3300"
	}

	// Load word list
	archive, err := words.LoadArchive()
	if err != nil {
		log.Fatalf("failed to load word archive: %v", err)
	}
	log.Printf("loaded %d archive words", archive.Len())

	// Initialize stores
	sessionStore := puzzle.NewSessionStore()
	adapter := &puzzle.SessionStoreAdapter{Store: sessionStore}
	relay := corm.NewRelay(adapter)

	// Initialize handlers
	h := handlers.New(templateFS, archive, sessionStore, relay)

	// Build router
	gh := server.GameHandlers{
		Health:         h.Health,
		Phase0Page:     h.Phase0Page,
		Phase0Interact: h.Phase0Interact,
		PuzzlePage:     h.PuzzlePage,
		PuzzleDecrypt:  h.PuzzleDecrypt,
		PuzzleSubmit:   h.PuzzleSubmit,
		PuzzleGrid:     h.PuzzleGrid,
		Stream:         h.Stream,
		Status:         h.Status,
		ContractsPage:  h.ContractsPage,
	}
	mux := server.NewRouter(gh, sessionStore, relay, staticFS)

	log.Printf("puzzle-service listening on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
