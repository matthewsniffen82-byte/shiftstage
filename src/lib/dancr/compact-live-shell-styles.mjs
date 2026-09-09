import postcss from "postcss";

// Build-time formatting only: no selector/value rewriting, deduplication or reordering.
export function compactLiveShellStyles(css) {
  const root = postcss.parse(css);
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
  return root.toString();
}
