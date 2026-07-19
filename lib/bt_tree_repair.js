/**
 * bt_tree_repair.js — Fix tree structure issues that prevent runtime ticking.
 */

const DECORATOR_TYPES = new Set(["inverter", "cooldown"]);

/**
 * Hoist nodes attached via .child on non-decorator parents into the parent's
 * children array so composites actually tick them at runtime.
 * @param {Object} node
 * @param {Object|null} parent
 * @param {number|string|null} index
 */
export function repair_misplaced_child_nodes(node, parent = null, index = null) {
  if (!node) return;

  if (node.children) {
    for (let i = node.children.length - 1; i >= 0; i--) {
      repair_misplaced_child_nodes(node.children[i], node, i);
    }
  }

  if (node.child && DECORATOR_TYPES.has(node.type)) {
    repair_misplaced_child_nodes(node.child, node, "child");
  }

  if (node.child && !DECORATOR_TYPES.has(node.type)) {
    const misplaced = node.child;
    delete node.child;
    if (parent?.children && typeof index === "number") {
      parent.children.splice(index + 1, 0, misplaced);
    }
  }
}
