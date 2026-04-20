import { ErrorCode, OBDError } from "../errors.js";

export function normalizeRawResponse(raw) {
  return String(raw ?? "")
    .replace(/SEARCHING\.\.\./gi, "")
    .replace(/>/g, "")
    .split(/\r?\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function hexOnly(line) {
  return line.replace(/\s+/g, "").toUpperCase();
}

export function responseHasNoData(raw) {
  return /NO\s*DATA/i.test(String(raw ?? ""));
}

export function getPayloadLines(raw) {
  if (responseHasNoData(raw)) {
    throw new OBDError(ErrorCode.NO_DATA, "Adapter returned NO DATA", { raw });
  }

  return normalizeRawResponse(raw)
    .filter((line) => !/^OK$/i.test(line))
    .map(hexOnly)
    .filter(Boolean);
}

export function hexToBytes(hex, raw) {
  if (!/^[0-9A-F]*$/i.test(hex) || hex.length % 2 !== 0) {
    throw new OBDError(ErrorCode.MALFORMED_RESPONSE, "Response is not valid hex", { raw });
  }

  const bytes = [];
  for (let index = 0; index < hex.length; index += 2) {
    bytes.push(Number.parseInt(hex.slice(index, index + 2), 16));
  }
  return bytes;
}

export function firstPidResponseBytes(raw, serviceByte, pidByte, minPayloadBytes) {
  const lines = getPayloadLines(raw);
  const expectedService = Number.parseInt(serviceByte, 16);
  const expectedPid = Number.parseInt(pidByte, 16);

  for (const line of lines) {
    const bytes = hexToBytes(line, raw);
    if (bytes[0] === expectedService && bytes[1] === expectedPid) {
      const payload = bytes.slice(2);
      if (payload.length < minPayloadBytes) {
        throw new OBDError(ErrorCode.MALFORMED_RESPONSE, "Response has too few payload bytes", {
          raw,
          expectedPayloadBytes: minPayloadBytes,
          actualPayloadBytes: payload.length
        });
      }
      return { bytes, payload, line };
    }
  }

  throw new OBDError(ErrorCode.MALFORMED_RESPONSE, "Missing expected service/PID response", {
    raw,
    expectedService: serviceByte,
    expectedPid: pidByte
  });
}

export function stripIsoTpPrefix(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0x10) return bytes.slice(2);
  if (bytes.length >= 2 && bytes[0] >= 0x21 && bytes[0] <= 0x2f) return bytes.slice(1);
  return bytes;
}
