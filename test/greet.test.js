import { strict as assert } from "node:assert";
import { test } from "node:test";
import { greet } from "../src/greet.js";

test("greet returns a greeting for a name", () => {
  assert.equal(greet("tiphys"), "hello, tiphys");
});

test("greet rejects an empty name", () => {
  assert.throws(() => greet(""), TypeError);
});
