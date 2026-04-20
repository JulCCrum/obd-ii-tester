import test from "node:test";
import assert from "node:assert/strict";
import { parseVIN } from "../parsers/vin_parser.js";

test("assembles multi-line Mode 09 VIN responses", () => {
  const result = parseVIN("4902015741575A5A5A314A5A58\r49020257303030303031\r>");
  assert.equal(result.vin, "WAWZZZ1JZXW000001");
  assert.equal(result.partial, false);
});

test("marks short VIN parses as partial", () => {
  const result = parseVIN("4902015741575A\r>");
  assert.equal(result.vin, "WAWZ");
  assert.equal(result.partial, true);
});

test("assembles multi-frame ISO-TP VIN response from real OBDLink output", () => {
  const raw = "014\r0:4902015741575A\r1:5A5A314A5A5857\r2:303030303031\r>";
  const result = parseVIN(raw);
  assert.equal(result.vin, "WAWZZZ1JZXW000001");
  assert.equal(result.partial, false);
});
