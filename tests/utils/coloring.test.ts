import { describe, expect, it } from "vitest";
import { new_color_graph, color_graph, greedy_coloring, AdjList } from "../../src/utils/coloring";

function build_adj_list(edges: [string, string][]): AdjList {
  const map = {} as AdjList;
  for (const [a, b] of edges) {
    if (!(a in map)) map[a] = [];
    if (!(b in map)) map[b] = [];
    if (!map[a].includes(b)) map[a].push(b);
    if (!map[b].includes(a)) map[b].push(a);
  }
  return map;
}

describe("greedy_coloring", () => {
  it("returns 1 for empty graph (no colors used + 1)", () => {
    expect(greedy_coloring([])).toBe(1);
  });

  it("returns 1 for single node", () => {
    expect(greedy_coloring([[]])).toBe(1);
  });

  it("returns 2 for two connected nodes", () => {
    expect(greedy_coloring([[1], [0]])).toBe(2);
  });

  it("returns 1 for two disconnected nodes", () => {
    expect(greedy_coloring([[], []])).toBe(1);
  });

  it("returns correct chromatic number for a line graph of 3 nodes", () => {
    // 0 -- 1 -- 2
    expect(greedy_coloring([[1], [0, 2], [1]])).toBe(2);
  });

  it("returns 3 for a complete graph K3", () => {
    // All nodes connected
    expect(greedy_coloring([[1, 2], [0, 2], [0, 1]])).toBe(3);
  });

  it("handles larger graphs without error", () => {
    // A more complex graph
    const adj: number[][] = [[1, 2], [0, 2, 3], [0, 1], [1, 4], [3]];
    const result = greedy_coloring(adj);
    expect(result).toBeGreaterThan(0);
  });
});

describe("new_color_graph", () => {
  it("colors a simple line graph with 2 colors", () => {
    const graph = build_adj_list([["0", "1"], ["1", "2"]]);
    const result = new_color_graph(graph, 2, {
      good_nodes: (c) => c[0],
      bad_nodes: (c) => c[0],
    });

    expect(result.bad_nodes).toEqual([]);
    expect(result.color_map["0"]).not.toBe(result.color_map["1"]);
    expect(result.color_map["1"]).not.toBe(result.color_map["2"]);
  });

  it("spills a node when graph requires more colors than available", () => {
    // K3 needs 3 colors, give only 2
    const graph = build_adj_list([["0", "1"], ["1", "2"], ["0", "2"]]);
    const result = new_color_graph(graph, 2, {
      good_nodes: (c) => c[0],
      bad_nodes: (c) => c[0],
    });

    expect(result.bad_nodes.length).toBeGreaterThanOrEqual(1);
    const spilledNode = result.bad_nodes[0];
    expect(result.color_map[spilledNode]).toBe(-1);
  });

  it("no adjacent nodes share the same color for non-spilled nodes", () => {
    // A 4-node ring: 0-1-2-3-0
    const graph = build_adj_list([["0", "1"], ["1", "2"], ["2", "3"], ["3", "0"]]);
    const result = new_color_graph(graph, 4, {
      good_nodes: (c) => c[0],
      bad_nodes: (c) => c[0],
    });

    const colors: { [key: string]: number } = result.color_map;
    // Check each edge
    expect(colors["0"]).not.toBe(colors["1"]);
    expect(colors["1"]).not.toBe(colors["2"]);
    expect(colors["2"]).not.toBe(colors["3"]);
    expect(colors["3"]).not.toBe(colors["0"]);
  });

  it("handles empty graph", () => {
    const result = new_color_graph({}, 2, {
      good_nodes: (c) => c[0],
      bad_nodes: (c) => c[0],
    });

    expect(result.bad_nodes).toEqual([]);
    expect(result.color_map).toEqual({});
  });

  it("respects heuristics good_nodes selection", () => {
    const graph = build_adj_list([["0", "1"]]);
    let goodCalled = false;
    const result = new_color_graph(graph, 2, {
      good_nodes: (c) => {
        goodCalled = true;
        return c[0];
      },
      bad_nodes: (c) => c[0],
    });

    expect(goodCalled).toBe(true);
    expect(result.bad_nodes).toEqual([]);
  });

  it("assigns colors in order for simple cases", () => {
    const graph = build_adj_list([["0", "1"], ["1", "2"]]);
    const result = new_color_graph(graph, 2, {
      good_nodes: (c) => c[0],
      bad_nodes: (c) => c[0],
    });

    // All nodes should be colored (not spilled) with 2 colors available for a line
    expect(result.bad_nodes).toEqual([]);
    for (const key of ["0", "1", "2"]) {
      expect(result.color_map[key]).toBeDefined();
      expect(result.color_map[key]).toBeGreaterThanOrEqual(0);
      expect(result.color_map[key]).toBeLessThan(2);
    }
  });
});

describe("color_graph", () => {
  it("colors a simple graph without heuristics", () => {
    const graph = build_adj_list([["0", "1"], ["1", "2"]]);
    const result = color_graph(graph, 2);

    expect(result.bad_nodes.length).toBe(0);
    expect(result.color_map["0"]).not.toBe(result.color_map["1"]);
    expect(result.color_map["1"]).not.toBe(result.color_map["2"]);
  });

  it("handles K3 with 2 colors (spills one)", () => {
    const graph = build_adj_list([["0", "1"], ["1", "2"], ["0", "2"]]);
    const result = color_graph(graph, 2);

    expect(result.bad_nodes.length).toBeGreaterThanOrEqual(1);
  });

  it("returns valid color_map for empty graph", () => {
    const result = color_graph({}, 2);
    expect(result.bad_nodes).toEqual([]);
    expect(result.color_map).toEqual({});
  });
});
