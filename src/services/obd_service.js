import { ErrorCode, OBDError } from "../errors.js";
import { parseCoolantTemp, parseEngineLoad, parseFuelLevel, parseMonitorStatus, parseRPM, parseSpeed, parseSupportedPids } from "../parsers/pid_parser.js";
import { parsePendingDTCs, parseStoredDTCs } from "../parsers/dtc_parser.js";
import { parseVIN } from "../parsers/vin_parser.js";
import { vehicleSnapshot } from "../models/vehicle_snapshot.js";

export class OBDService {
  constructor(adapter) {
    this.adapter = adapter;
  }

  async getSupportedPIDs() {
    const raw = await this.adapter.request("0100");
    return parseSupportedPids(raw);
  }

  async getMonitorStatus() {
    const raw = await this.adapter.request("0101");
    return parseMonitorStatus(raw);
  }

  async getAdapterVoltage() {
    const raw = await this.adapter.sendAdapterCommand("ATRV");
    const match = raw.match(/([0-9]+(?:\.[0-9]+)?)\s*V/i);
    return {
      volts: match ? Number(match[1]) : null,
      raw
    };
  }

  async getRPM() {
    const raw = await this.adapter.request("010C");
    return { rpm: parseRPM(raw), raw };
  }

  async getSpeed() {
    const raw = await this.adapter.request("010D");
    return { ...parseSpeed(raw), raw };
  }

  async getCoolantTemp() {
    const raw = await this.adapter.request("0105");
    return { ...parseCoolantTemp(raw), raw };
  }

  async getEngineLoad() {
    const raw = await this.adapter.request("0104");
    return { percent: parseEngineLoad(raw), raw };
  }

  async getFuelLevel() {
    const raw = await this.adapter.request("012F");
    return { percent: parseFuelLevel(raw), raw };
  }

  async readStoredDTCs() {
    const raw = await this.adapter.request("03");
    return parseStoredDTCs(raw);
  }

  async readPendingDTCs() {
    const raw = await this.adapter.request("07");
    return parsePendingDTCs(raw);
  }

  async clearDTCs({ confirm = false } = {}) {
    if (!confirm) {
      throw new OBDError(
        ErrorCode.CLEAR_CONFIRMATION_REQUIRED,
        "clearDTCs requires { confirm: true }; this is never called automatically"
      );
    }

    const raw = await this.adapter.request("04");
    return {
      success: /OK|44/i.test(raw),
      raw
    };
  }

  async getVIN() {
    const raw = await this.adapter.request("0902");
    return parseVIN(raw);
  }

  async snapshot() {
    const [rpm, speed, coolant, engineLoad, fuel, vinResult] = await sequential([
      () => this.getRPM(),
      () => this.getSpeed(),
      () => this.getCoolantTemp(),
      () => this.getEngineLoad(),
      () => this.getFuelLevel(),
      () => this.getVIN().catch((error) => ({ error }))
    ]);

    return vehicleSnapshot({
      connected: this.adapter.isConnected(),
      protocol: this.adapter.protocol,
      rpm: rpm.rpm,
      speedKmh: speed.kmh,
      coolantTempC: coolant.celsius,
      engineLoadPct: engineLoad.percent,
      fuelLevelPct: fuel.percent,
      vin: vinResult.error ? null : vinResult.vin
    });
  }
}

async function sequential(tasks) {
  const results = [];
  for (const task of tasks) {
    results.push(await task());
  }
  return results;
}
