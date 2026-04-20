import { ErrorCode, OBDError } from "../errors.js";
import { describeDtc } from "../data/dtc_descriptions.js";
import { getPayloadLines, hexToBytes } from "./response_utils.js";

const DTC_PREFIX = Object.freeze({
  0x0: "P0",
  0x1: "P1",
  0x2: "P2",
  0x3: "P3",
  0x4: "C0",
  0x5: "C1",
  0x6: "C2",
  0x7: "C3",
  0x8: "B0",
  0x9: "B1",
  0xa: "B2",
  0xb: "B3",
  0xc: "U0",
  0xd: "U1",
  0xe: "U2",
  0xf: "U3"
});

export function decodeDtcBytes(firstByte, secondByte) {
  if (firstByte === 0x00 && secondByte === 0x00) return null;
  const prefix = DTC_PREFIX[(firstByte & 0xf0) >> 4];
  const remaining = `${(firstByte & 0x0f).toString(16)}${secondByte.toString(16).padStart(2, "0")}`;
  return `${prefix}${remaining}`.toUpperCase();
}

function tryHexToBytes(hex) {
  if (!/^[0-9A-F]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(Number.parseInt(hex.slice(i, i + 2), 16));
  }
  return bytes;
}

function collectServicePayloads(raw, expectedService) {
  const lines = getPayloadLines(raw);
  const payloads = [];
  const multiFrame = new Map();

  for (const line of lines) {
    const mfMatch = line.match(/^([0-9A-F]+):([0-9A-F]+)$/i);
    if (mfMatch) {
      multiFrame.set(Number.parseInt(mfMatch[1], 16), mfMatch[2].toUpperCase());
      continue;
    }
    const bytes = tryHexToBytes(line);
    if (!bytes || bytes.length < 1) continue;
    if (bytes[0] !== expectedService) continue;
    payloads.push(bytes.slice(1));
  }

  if (multiFrame.size > 0) {
    const sortedKeys = [...multiFrame.keys()].sort((a, b) => a - b);
    const assembledHex = sortedKeys.map((k) => multiFrame.get(k)).join("");
    const assembled = tryHexToBytes(assembledHex);
    if (assembled && assembled[0] === expectedService) {
      payloads.push(assembled.slice(1));
    }
  }

  return payloads;
}

export function parseDTCs(raw, expectedServiceHex) {
  const expectedService = Number.parseInt(expectedServiceHex, 16);
  const payloads = collectServicePayloads(raw, expectedService);

  if (payloads.length === 0) {
    throw new OBDError(ErrorCode.MALFORMED_RESPONSE, "Missing expected DTC service response", {
      raw,
      expectedService: expectedServiceHex
    });
  }

  const codes = [];
  const allBytes = [];

  for (const payload of payloads) {
    if (payload.length === 0) continue;
    const count = payload[0];
    const dtcBytes = payload.slice(1, 1 + count * 2);
    allBytes.push(...payload);
    if (dtcBytes.length < count * 2) continue;
    for (let i = 0; i + 1 < dtcBytes.length; i += 2) {
      const code = decodeDtcBytes(dtcBytes[i], dtcBytes[i + 1]);
      if (code) codes.push({ code, description: describeDtc(code) });
    }
  }

  return {
    raw,
    codes,
    bytes: allBytes
  };
}

export function parseStoredDTCs(raw) {
  return parseDTCs(raw, "43");
}

export function parsePendingDTCs(raw) {
  return parseDTCs(raw, "47");
}
