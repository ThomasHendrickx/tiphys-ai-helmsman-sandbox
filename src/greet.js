/**
 * The toy sandbox project's one source file. It exists so the project has
 * something to test; the M1 exit test never changes it, it only appends a
 * line to the README (kernel plan v1, M1-P6 steps 1 and 3).
 */
export function greet(name) {
  if (typeof name !== "string" || name === "") {
    throw new TypeError("greet requires a non-empty name");
  }
  return `hello, ${name}`;
}
