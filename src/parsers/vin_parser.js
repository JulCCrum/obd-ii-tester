import { ErrorCode, OBDError } from "../errors.js";
import { getPayloadLines, hexToBytes, stripIsoTpPrefix } from "./response_utils.js";

function tryHexToBytes(hex) {
  if (!/^[0-9A-F]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(Number.parseInt(hex.slice(i, i + 2), 16));
  }
  return bytes;
}

function collectPayload(raw) {
  const lines = getPayloadLines(raw);
  const chunks = new Map();
  let multiFrame = false;
  const singleLineBytes = [];

  for (const line of lines) {
    const mfMatch = line.match(/^([0-9A-F]+):([0-9A-F]+)$/i);
    if (mfMatch) {
      chunks.set(Number.parseInt(mfMatch[1], 16), mfMatch[2].toUpperCase());
      multiFrame = true;
      continue;
    }
    const bytes = tryHexToBytes(line);
    if (!bytes) continue;
    if (bytes.length <= 2) continue;
    singleLineBytes.push(bytes);
  }

  if (multiFrame) {
    const sortedKeys = [...chunks.keys()].sort((a, b) => a - b);
    const assembledHex = sortedKeys.map((k) => chunks.get(k)).join("");
    const assembled = tryHexToBytes(assembledHex);
    if (assembled && assembled[0] === 0x49 && assembled[1] === 0x02) {
      return assembled.slice(3);
    }
    return null;
  }

  let assembled = [];
  for (const bytes of singleLineBytes) {
    const stripped = stripIsoTpPrefix(bytes);
    if (stripped[0] !== 0x49 || stripped[1] !== 0x02) continue;
    assembled.push(...stripped.slice(3));
  }
  return assembled.length ? assembled : null;
}

export function parseVIN(raw) {
  const data = collectPayload(raw);

  if (!data) {
    throw new OBDError(ErrorCode.MALFORMED_RESPONSE, "Missing Mode 09 VIN response", { raw });
  }

  const asciiBytes = data.filter((byte) => byte !== 0x00);
  const vin = String.fromCharCode(...asciiBytes).replace(/[^\x20-\x7E]/g, "").trim();

  return {
    raw,
    vin,
    partial: vin.length !== 17,
    lines: getPayloadLines(raw)
  };
}
