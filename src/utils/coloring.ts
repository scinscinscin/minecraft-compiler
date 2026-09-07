// Implementation of the Chaitin algorithm for coloring graphs
export type AdjList = {
  [key: string]: string[];
};

function remove_key_from_graph(adj_list: AdjList, key_to_remove: string) {
  let ret = {} as AdjList;

  for (let node in adj_list) {
    if (node === key_to_remove) continue;
    ret[node] = adj_list[node].filter((x) => x !== key_to_remove);
  }

  return ret;
}

/**
 * @param graph Adjacency list, assuems that the graph is valid, undirected
 * @param n The number of colors
 */
export type Heuristics = {
  good_nodes: (candidates: string[]) => string;
  bad_nodes: (candidates: string[]) => string;
};

export function new_color_graph(graph: AdjList, n: number, h: Heuristics) {
  let current_graph = graph;
  const order = [] as string[];
  const bad_nodes = [] as string[];

  // try to find candidates that we can remove from the graph
  next_node: while (Object.keys(current_graph).length > 0) {
    const candidates = Object.keys(current_graph).filter((x) => current_graph[x].length < n);
    if (candidates.length > 0) {
      // We have a set of candidates that we can remove from the graph
      // ask the called which one to remove
      const to_remove = h.good_nodes(candidates);
      order.push(to_remove);
      current_graph = remove_key_from_graph(current_graph, to_remove);
      continue next_node;
    } else {
      // we weren't able to find a node that has less than n neighbors
      // find all candidates that we can remove from the graph

      const bad_node_candidates = Object.keys(current_graph);
      const key = h.bad_nodes(bad_node_candidates);
      bad_nodes.push(key);
      order.push(key);

      current_graph = remove_key_from_graph(current_graph, key);
      continue next_node;
    }
  }

  const color_map = {} as { [key: string]: number };
  const get_neighbouring_colors = (node_key: string): number[] => {
    const neighbors = graph[node_key];
    const ret = [] as number[];
    for (const neighbor of neighbors) if (neighbor in color_map) ret.push(color_map[neighbor]);
    return ret;
  };

  while (order.length > 0) {
    // try to find a color for it based on the nodes that have already been colored
    const node = order.pop()!;
    const is_bad = bad_nodes.includes(node);

    // we're still going to attempt to color even if the node is bad
    const colors = get_neighbouring_colors(node);
    let available_reigster = -1;
    for (let i = 0; i < n; i++) {
      if (colors.includes(i)) continue;
      available_reigster = i;
      break;
    }

    if (available_reigster !== -1) {
      // found an available color for it
      color_map[node] = available_reigster;
      continue;
    } else {
      // this node is spilled and called on demand, it's loaded on the fly
      if (is_bad) color_map[node] = -1;
      else throw new Error("Invariant: Could not find a color for node, and node is not marked delinquint" + node);
    }
  }

  return { bad_nodes, color_map };
}

/**
 * @param graph Adjacency list, assuems that the graph is valid, undirected
 * @param n The number of colors
 */
export function color_graph(graph: AdjList, n: number) {
  let current_graph = graph;
  const order = [] as string[];
  const bad_nodes = [] as string[];

  // from current try to find a node that has less than n neighbors
  next_node: while (Object.keys(current_graph).length > 0) {
    for (const node_key in current_graph) {
      const neighbors = current_graph[node_key];
      if (neighbors.length >= n) continue;

      // its a candidate for removal, so remove it from the graph and it in the queue
      order.push(node_key);
      current_graph = remove_key_from_graph(current_graph, node_key);

      continue next_node;
    }

    // we weren't able to find a node that has less than n neighbors

    // choose a random node and mark it as troublesome
    // NOTE that you can improve the performance of subsequent stages by intelligently choosing the node
    const random_key = Object.keys(current_graph)[0];
    bad_nodes.push(random_key);
    order.push(random_key);
    current_graph = remove_key_from_graph(current_graph, random_key);
    continue next_node;
  }

  const color_map = {} as { [key: string]: number };
  const get_neighbouring_colors = (node_key: string): number[] => {
    const neighbors = graph[node_key];
    const ret = [] as number[];
    for (const neighbor of neighbors) if (neighbor in color_map) ret.push(color_map[neighbor]);
    return ret;
  };

  while (order.length > 0) {
    // try to find a color for it based on the nodes that have already been colored
    const node = order.pop()!;
    const is_bad = bad_nodes.includes(node);

    // we're still going to attempt to color even if the node is bad
    const colors = get_neighbouring_colors(node);
    let available_reigster = -1;
    for (let i = 0; i < n; i++) {
      if (colors.includes(i)) continue;
      available_reigster = i;
      break;
    }

    if (available_reigster !== -1) {
      // found an available color for it
      color_map[node] = available_reigster;
      continue;
    } else {
      // this node is spilled and called on demand, it's loaded on the fly
      if (is_bad) color_map[node] = -1;
      else throw new Error("Invariant: Could not find a color for node, and node is not marked delinquint" + node);
    }
  }

  return { bad_nodes, color_map };
}

export type ChaitinOutput = ReturnType<typeof color_graph>;

export function greedy_coloring(adj_list: number[][]): number {
  const node_count = adj_list.length;
  const colors = new Array(node_count).fill(-1);

  let max_colors = 0;

  for (let v = 0; v < node_count; v++) {
    const used = new Set<number>();

    // for all colored neighbors, add their colors to used
    for (const u of adj_list[v]) if (colors[u] !== -1) used.add(colors[u]);

    // determine the next color available and assign it to the current node being processed
    let color = 0;
    while (used.has(color)) color++;
    colors[v] = color;

    // set max number of colors
    max_colors = Math.max(max_colors, color);
  }

  return max_colors + 1;
}
