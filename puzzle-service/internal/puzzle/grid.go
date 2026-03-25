package puzzle

// Cell represents a single cell in the cipher grid.
type Cell struct {
	Row       int    `json:"row"`
	Col       int    `json:"col"`
	Plaintext rune   `json:"-"` // never sent to client
	Encrypted rune   `json:"encrypted"`
	Decrypted bool   `json:"decrypted"`
	IsWord    bool   `json:"-"` // true if this cell is part of the target word
}

// CellCoord is a lightweight row/col pair.
type CellCoord struct {
	Row int `json:"row"`
	Col int `json:"col"`
}

// Grid holds the full puzzle grid state.
type Grid struct {
	Rows  int      `json:"rows"`
	Cols  int      `json:"cols"`
	Cells [][]Cell `json:"-"`
}

// NewGrid creates an empty grid of the given dimensions.
func NewGrid(rows, cols int) *Grid {
	cells := make([][]Cell, rows)
	for r := range cells {
		cells[r] = make([]Cell, cols)
		for c := range cells[r] {
			cells[r][c] = Cell{Row: r, Col: c}
		}
	}
	return &Grid{Rows: rows, Cols: cols, Cells: cells}
}

// InBounds checks whether (row, col) is within the grid.
func (g *Grid) InBounds(row, col int) bool {
	return row >= 0 && row < g.Rows && col >= 0 && col < g.Cols
}

// NoiseChars are non-alphabet ASCII characters used to fill the grid.
var NoiseChars = []rune{'#', '@', '%', '&', '*', '│', '─', '░', '▓', '█', '◆', '◇', '○', '●', '□', '■', '△', '▽', '◈', '╳'}
