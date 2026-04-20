import test from "node:test";
import assert from "node:assert/strict";
import { decodeDtcBytes, parsePendingDTCs, parseStoredDTCs } from "../parsers/dtc_parser.js";

test("decodes SAE DTC nibbles", () => {
  assert.equal(decodeDtcBytes(0x01, 0x33), "P0133");
  assert.equal(decodeDtcBytes(0x45, 0x67), "C0567");
  assert.equal(decodeDtcBytes(0x89, 0xab), "B09AB");
  assert.equal(decodeDtcBytes(0xcd, 0xef), "U0DEF");
});

test("decodes a single-frame stored DTC with description", () => {
  const result = parseStoredDTCs("4301013300\r>");
  assert.deepEqual(result.codes.map((c) => c.code), ["P0133"]);
  assert.equal(result.codes[0].description, "O2 Sensor Circuit Slow Response (Bank 1, Sensor 1)");
});

test("parses empty pending DTC response", () => {
  assert.deepEqual(parsePendingDTCs("4700000000\r>").codes, []);
});

test("parses bare empty stored response (4300) from healthy CAN ECU", () => {
  assert.deepEqual(parseStoredDTCs("4300\r\r>").codes, []);
});

test("assembles multi-frame ISO-TP DTC response from real OBDLink output", () => {
  const raw = "00A\r0:430420020401\r1:240F0401000000\r4300\r\r>";
  const result = parseStoredDTCs(raw);
  assert.deepEqual(result.codes.map((c) => c.code), ["P2002", "P0401", "P240F", "P0401"]);
  assert.equal(result.codes[0].description, "Diesel Particulate Filter Efficiency Below Threshold (Bank 1)");
});

test("returns categorical fallback for unknown codes", () => {
  const result = parseStoredDTCs("4301010300\r>");
  assert.equal(result.codes[0].code, "P0103");
  assert.ok(result.codes[0].description.includes("Mass or Volume Air Flow"));
});
