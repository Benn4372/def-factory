// Empty class templates, one per block type (DESIGN.md §7.6).
// Nothing works until the player writes these.

const T = (name, body) => `class ${name}:\n${body}`;

export const CLASS_TEMPLATES = {
  source: T('Source', `    # Ordered crates arrive here one at a time (ordering comes in Phase 3).
    # Push each one onto an adjacent belt.

    def on_place(self):
        pass

    def on_receive(self, item):
        pass
`),

  belt: T('Belt', `    # Runs on every belt. Each belt is its own object (self).
    # Set self.direction to "north", "south", "east" or "west".
    # Push items forward with self.push(item, self.direction).
    # Belts take items from behind and both sides, so lines can turn corners.

    def on_place(self):
        pass

    def on_receive(self, item):
        pass
`),

  splitter: T('Splitter', `    # Like a belt, but can push forward, left or right (never back).

    def on_place(self):
        pass

    def on_receive(self, item):
        pass
`),

  merger: T('Merger', `    # Takes items from behind and both sides, pushes them forward.
    # Optional: can_accept(self, item, from_direction) -> True/False

    def on_place(self):
        pass

    def on_receive(self, item):
        pass
`),

  warehouse: T('Warehouse', `    # Storage arrives in Phase 3.

    def on_place(self):
        pass

    def on_receive(self, item):
        pass
`),

  crafter: T('Crafter', `    # Crafting arrives in Phase 3.

    def on_place(self):
        pass

    def on_receive(self, item):
        pass
`),

  sell: T('Sell', `    # Sell what arrives with self.sell(item).

    def on_place(self):
        pass

    def on_receive(self, item):
        pass
`),
};
