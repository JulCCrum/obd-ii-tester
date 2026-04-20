import { firstPidResponseBytes, getPayloadLines } from "./response_utils.js";

export function parseSupportedPids(raw) {
  const { line, payload } = firstPidResponseBytes(raw, "41", "00", 4);
  return {
    raw,
    bitmapHex: payload.slice(0, 4).map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase(),
    response: line
  };
}

export function parseMonitorStatus(raw) {
  const { payload } = firstPidResponseBytes(raw, "41", "01", 4);
  const byteA = payload[0];
  return {
    milOn: Boolean(byteA & 0x80),
    storedDtcCount: byteA & 0x7f,
    raw
  };
}

export function parseRPM(raw) {
  const { payload } = firstPidResponseBytes(raw, "41", "0C", 2);
  return Math.round(((256 * payload[0]) + payload[1]) / 4);
}

export function parseSpeed(raw) {
  const { payload } = firstPidResponseBytes(raw, "41", "0D", 1);
  const kmh = payload[0];
  return {
    kmh,
    mph: Number((kmh * 0.621371).toFixed(1))
  };
}

export function parseCoolantTemp(raw) {
  const { payload } = firstPidResponseBytes(raw, "41", "05", 1);
  const celsius = payload[0] - 40;
  return {
    celsius,
    fahrenheit: Number(((celsius * 9 / 5) + 32).toFixed(1))
  };
}

export function parseEngineLoad(raw) {
  const { payload } = firstPidResponseBytes(raw, "41", "04", 1);
  return Number(((payload[0] / 255) * 100).toFixed(1));
}

export function parseFuelLevel(raw) {
  const { payload } = firstPidResponseBytes(raw, "41", "2F", 1);
  return Number(((100 / 255) * payload[0]).toFixed(1));
}

export function rawHexLines(raw) {
  return getPayloadLines(raw);
}
