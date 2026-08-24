Basic c-like compiler targetting a Minecraft Redstone Computer

Ouptut instructions are subject to change as the computer is developed

Things that have been done:
1. Convert the AST to a three address code intermediate representation
2. Create the basic blocks of a given function and form the control flow graph
   1. The first three address instruction in the intermediate code is a leader
   2. Any instruction that is the target of a conditional or unconditional jump is a leader
   3. Any instruction that immediately follows a conditional or unconditional jump is a leader
3. Convert the TAC IR to SSA form
   1. Determine the dominators of the CFG
   2. Determine the dominance frontiers of each node of the CFG
   3. SSA conversion
      1. For each variable, find all blocks that define it
      2. Put phi nodes in the iterated dominance frontier of those blocks
      3. Build dominance tree and perform DFS with stack to add operands to phi nodes and replace variable invocations with SSA ones.
4. Perform liveliness analysis
   1. Compute USE and DEF per block
   2. Compute the live in and live out of each block
   3. Construct the register interference graph
      1. Traverse each basic block backwards with `live` starting as its live out
      2. For each instruction that defines a variable, add an edge from every operand in live to the defined variable
      3. Remove the defined variable from live and add the operands it uses
5. Code generation
   1. Kill the phi nodes by adding new predecessors to block that coalesce register usage
   2. Emit callee preamble that prepares stack frame
   3. Emit code sequentially, replacing jumps with "on-edge" predecessors
   4. Emit callee epilogue that deallocates stack frame
6. Linking and Loading
   1. Each translation unit is linked into a single output, removing labels
   2. Unnecessary jumps (jumps that go to the next instruction) are also removed