import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * File inventory: what is in this tree, by extension.
 *
 * OPEN NOTHING WHOSE TYPE HAS NOT BEEN ESTABLISHED. This walker only ever
 * calls lstat and readdir, and it classifies every entry BEFORE deciding what
 * to do with it. That is not defensive padding. lstat never follows a symlink
 * and never blocks, whereas a stat on a path that turns out to be a named pipe
 * with no peer blocks in the kernel until a peer appears, and a block is not
 * an exception so no try/catch reaches it. A tree walker is exactly the shape
 * that meets a path it did not create.
 *
 * A SYMLINK IS COUNTED AND NEVER FOLLOWED. Following would let a link to a
 * parent directory turn the walk into an unbounded loop, and the inventory's
 * question is "what is in this tree", to which a symlink is a complete answer
 * by itself.
 */

/** Entry kinds this walker distinguishes. Anything else is `other`. */
export const KINDS = ["file", "directory", "symlink", "other"];

export function classifyEntry(path) {
  let stats;
  try {
    stats = lstatSync(path);
  } catch (error) {
    return { kind: "unreadable", reason: error.code || String(error) };
  }
  if (stats.isSymbolicLink()) return { kind: "symlink", size: 0 };
  if (stats.isDirectory()) return { kind: "directory", size: 0 };
  if (stats.isFile()) return { kind: "file", size: stats.size };
  return { kind: "other", size: 0 };
}

/**
 * The extension an inventory counts a name under.
 *
 * A DOTFILE HAS NO EXTENSION. `.gitignore` is a file called gitignore, not a
 * file of type gitignore, and counting it as one produces an inventory whose
 * largest category is an artefact of the naming convention. A name with no dot
 * after its first character is reported as `(none)`.
 */
export function extensionOf(name) {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "(none)";
  return name.slice(dot).toLowerCase();
}

/**
 * Walk `root` and return the inventory.
 *
 * `skip` is the set of directory NAMES not descended into. It is a parameter
 * rather than a constant because which directories are noise is a property of
 * the tree being measured, not of the measuring.
 */
export function inventory(root, options = {}) {
  const skip = new Set(options.skip ?? [".git", "node_modules"]);
  const counts = new Map();
  const totals = { files: 0, directories: 0, symlinks: 0, other: 0, unreadable: 0, bytes: 0 };
  const unreadable = [];

  const walk = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory);
    } catch (error) {
      totals.unreadable += 1;
      unreadable.push({ path: directory, reason: error.code || String(error) });
      return;
    }
    for (const name of entries.sort()) {
      const path = join(directory, name);
      const entry = classifyEntry(path);
      if (entry.kind === "unreadable") {
        totals.unreadable += 1;
        unreadable.push({ path, reason: entry.reason });
        continue;
      }
      if (entry.kind === "directory") {
        totals.directories += 1;
        if (!skip.has(name)) walk(path);
        continue;
      }
      if (entry.kind === "symlink") {
        totals.symlinks += 1;
        continue;
      }
      if (entry.kind === "other") {
        totals.other += 1;
        continue;
      }
      totals.files += 1;
      totals.bytes += entry.size;
      const extension = extensionOf(name);
      counts.set(extension, (counts.get(extension) ?? 0) + 1);
    }
  };

  walk(root);

  const byExtension = [...counts.entries()]
    .map(([extension, count]) => ({ extension, count }))
    // Descending by count, then by name, so the output is stable across runs
    // and two inventories of the same tree are byte-comparable.
    .sort((a, b) => b.count - a.count || a.extension.localeCompare(b.extension));

  return { root, totals, byExtension, unreadable };
}
