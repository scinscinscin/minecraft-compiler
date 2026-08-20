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

// const mapping = color_graph(
//   {
//     a: ["b", "d", "f", "g"],
//     b: ["a", "c", "d", "e"],
//     c: ["b", "d", "e"],
//     d: ["a", "b", "c", "f", "g"],
//     e: ["b", "c", "f", "g"],
//     f: ["a", "d", "e", "g"],
//     g: ["a", "d", "f"],
//   },
//   4,
// );

// const mapping = color_graph(
//   {
//     a: ["b", "c", "d"],
//     b: ["a", "c", "d", "e", "f"],
//     c: ["a", "b", "d", "e"],
//     d: ["a", "b", "c"],
//     e: ["b", "c", "f"],
//     f: ["b", "e"],
//     g: [],
//   },
//   3,
// );

// console.log(mapping);
