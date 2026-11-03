import postcss from "postcss";

// Build-time formatting and exact duplicate removal; never rewrite selectors or values.
export function compactLiveShellStyles(css) {
  const root = postcss.parse(css);
  // An identical later rule in the same container always wins. Keep the last
  // occurrence, preserving the cascade relative to intervening overrides.
  const deduplicate = container => {
    const seen = new Set();
    for (const node of [...(container.nodes || [])].reverse()) {
      if (node.type === "rule") {
        const key = node.toString().replace(/\r\n?/g, "\n");
        if (seen.has(key)) node.remove();
        else seen.add(key);
      } else if (node.type === "atrule" && /^(media|supports|container)$/i.test(node.name)) deduplicate(node);
    }
  };
  root.walk(node => {
    node.raws.before = "";
    if (node.type === "decl") node.raws.between = ":";
    else if (node.type === "rule" || node.type === "atrule") {
      if (node.nodes) node.raws.between = "";
      node.raws.after = "";
      node.raws.semicolon = false;
    }
  });
  root.raws.after = "";
  deduplicate(root);
  return root.toString();
}
