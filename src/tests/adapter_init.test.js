import test from "node:test";
import assert from "node:assert/strict";
import { OBDAdapter } from "../adapter/obd_adapter.js";
import { MockTransport } from "../transport/mock_transport.js";
import { ErrorCode, OBDError } from "../errors.js";

const silentLogger = { info() {}, warn() {} };

test("adapter initialization sends expected commands in order", async () => {
  const transport = new MockTransport();
  const adapter = new OBDAdapter(transport, { logger: silentLogger });
  await adapter.connect();

  const result = await adapter.initialize();

  assert.equal(result.initialized, true);
  assert.equal(result.protocol, "ISO 15765-4 (CAN 11/500)");
  assert.deepEqual(transport.commandLog, ["ATZ", "ATE0", "ATL0", "ATS0", "ATH0", "ATSP0", "ATDP", "0100", "ATDP"]);
});

test("adapter retries one timeout during init", async () => {
  const transport = new MockTransport(undefined, { timeouts: ["ATE0"] });
  const adapter = new OBDAdapter(transport, { logger: silentLogger });
  await adapter.connect();

  await adapter.initialize();

  assert.deepEqual(transport.commandLog, ["ATZ", "ATE0", "ATE0", "ATL0", "ATS0", "ATH0", "ATSP0", "ATDP", "0100", "ATDP"]);
});

test("adapter requires initialization before OBD requests", async () => {
  const transport = new MockTransport();
  const adapter = new OBDAdapter(transport, { logger: silentLogger });
  await adapter.connect();

  await assert.rejects(
    () => adapter.request("010C"),
    (error) => error instanceof OBDError && error.code === ErrorCode.ADAPTER_NOT_INITIALIZED
  );
});
