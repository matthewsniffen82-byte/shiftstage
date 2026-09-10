import { minify } from "terser";

// Keep the classic script's globals and function names: inline handlers and
// companion scripts call them. Only shorten local bindings and remove formatting;
// do not rewrite expressions, remove code, or rename object/DOM properties.
export async function compactLiveShellScript(source) {
  const { code } = await minify(source, {
    compress: false,
    mangle: { toplevel: false, eval: false },
    keep_fnames: true,
    keep_classnames: true,
    format: { comments: false },
  });
  if (!code) throw new Error("The production home script could not be generated.");
  return code + "\n";
}
