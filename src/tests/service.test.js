import test from "node:test";
import assert from "node:assert/strict";
import { OBDAdapter } from "../adapter/obd_adapter.js";
import { OBDService } from "../services/obd_service.js";
import { MockTransport } from "../transport/mock_transport.js";
import { ErrorCode, OBDError } from "../errors.js";

const silentLogger = { info() {}, warn() {} };

async function createMockService() {
  const adapter = new OBDAdapter(new MockTransport(), { logger: silentLogger });
  await adapter.connect();
  await adapter.initialize();
  return new OBDService(adapter);
}

test("snapshot returns the requested shape", async () => {
  const service = await createMockService();

  assert.deepEqual(await service.snapshot(), {
    connected: true,
    protocol: "ISO 15765-4 (CAN 11/500)",
    rpm: 1000,
    speedKmh: 40,
    coolantTempC: 60,
    engineLoadPct: 49.8,
    fuelLevelPct: 50.2,
    vin: "WAWZZZ1JZXW000001"
  });
});

test("clear DTC requires explicit confirmation", async () => {
  const service = await createMockService();

  await assert.rejects(
    () => service.clearDTCs(),
    (error) => error instanceof OBDError && error.code === ErrorCode.CLEAR_CONFIRMATION_REQUIRED
  );
});
