import test from "node:test";
import assert from "node:assert/strict";
import { ErrorCode, OBDError } from "../errors.js";
import { parseCoolantTemp, parseEngineLoad, parseFuelLevel, parseRPM, parseSpeed, parseSupportedPids } from "../parsers/pid_parser.js";

test("parses supported PID bitmap without decoding it", () => {
  assert.deepEqual(parseSupportedPids("4100BE3EA813\r>").bitmapHex, "BE3EA813");
});

test("parses RPM", () => {
  assert.equal(parseRPM("410C0FA0\r>"), 1000);
});

test("parses speed in km/h and mph", () => {
  assert.deepEqual(parseSpeed("410D28\r>"), { kmh: 40, mph: 24.9 });
});

test("parses coolant temperature", () => {
  assert.deepEqual(parseCoolantTemp("410564\r>"), { celsius: 60, fahrenheit: 140 });
});

test("parses engine load percentage", () => {
  assert.equal(parseEngineLoad("41047F\r>"), 49.8);
});

test("parses fuel level percentage", () => {
  assert.equal(parseFuelLevel("412F80\r>"), 50.2);
});

test("throws no_data on NO DATA responses", () => {
  assert.throws(
    () => parseRPM("NO DATA\r>"),
    (error) => error instanceof OBDError && error.code === ErrorCode.NO_DATA
  );
});

test("validates expected service and PID", () => {
  assert.throws(
    () => parseRPM("410D28\r>"),
    (error) => error instanceof OBDError && error.code === ErrorCode.MALFORMED_RESPONSE
  );
});

test("rejects malformed hex", () => {
  assert.throws(
    () => parseRPM("410C0ZZZ\r>"),
    (error) => error instanceof OBDError && error.code === ErrorCode.MALFORMED_RESPONSE
  );
});
