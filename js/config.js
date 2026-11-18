// All tunable numbers live here. See DESIGN.md §5–§6.

export const GRID = {
  cols: 24,
  rows: 16,
  tile: 40, // logical pixels per tile; the canvas scales to fit
};

export const START_MONEY = 500;

// Block catalog. `size` is the footprint in tiles (square).
// `free` is how many can be placed before they start costing `price`.
export const BLOCKS = {
  source:    { label: 'Source',    size: 1, free: 1,  price: 200, color: '#4f8fd6', icon: 'IN'  },
  belt:      { label: 'Belt',      size: 1, free: 20, price: 2,   color: '#8a8f98', icon: '='   },
  splitter:  { label: 'Splitter',  size: 1, free: 2,  price: 20,  color: '#b08a3c', icon: '<>'  },
  merger:    { label: 'Merger',    size: 1, free: 2,  price: 20,  color: '#9a6fc4', icon: '><'  },
  warehouse: { label: 'Warehouse', size: 2, free: 1,  price: 150, color: '#5c9e6a', icon: 'WH'  },
  crafter:   { label: 'Crafter',   size: 1, free: 2,  price: 100, color: '#d0743c', icon: 'CR'  },
  sell:      { label: 'Sell',      size: 1, free: 1,  price: 100, color: '#d4b23f', icon: '$'   },
};

// Items: buy price (Phase 3 ordering), sell price, and a color for drawing.
export const ITEMS = {
  iron:   { buy: 2, sell: 1,   color: '#a9b4c2' },
  copper: { buy: 3, sell: 1,   color: '#d98b4a' },
  wood:   { buy: 1, sell: 0.5, color: '#9c6b3c' },
  gear:   { sell: 7,  color: '#7f8ea3' },
  spring: { sell: 4,  color: '#c7d0db' },
  wire:   { sell: 5,  color: '#e0a060' },
  plank:  { sell: 2,  color: '#c49a62' },
  motor:  { sell: 30, color: '#5fa8d3' },
  clock:  { sell: 25, color: '#e8c547' },
};

export const BLOCK_ORDER =['source', 'belt', 'splitter', 'merger', 'warehouse', 'crafter', 'sell'];
