# Basic OBD-II Tester for OBDLink MX+

Small generic OBD-II MVP for OBDLink MX+ and other ELM327/STN11xx-compatible adapters. It sends ASCII commands, waits for the `>` prompt, preserves raw responses for debugging, and keeps transport separate from adapter setup, services, and parsers.

This is intentionally not an AlfaOBD-style tool. It only supports basic generic OBD-II reads plus explicitly confirmed Mode 04 clear-codes.

## Project Layout

```text
src/
  transport/
    transport_interface.js
    mock_transport.js
    real_transport.js
  adapter/
    obd_adapter.js
  services/
    obd_service.js
  parsers/
    pid_parser.js
    dtc_parser.js
    vin_parser.js
    response_utils.js
  models/
    obd_value.js
    dtc.js
    vehicle_snapshot.js
  tests/
    *.test.js
```

## Setup

Node 20 or newer is required.

```bash
cd /Users/chasecrummedyo/obd-ii-tester
npm test
```

Mock mode has no required dependencies. Real serial mode uses the optional `serialport` package:

```bash
cd /Users/chasecrummedyo/obd-ii-tester
npm install
```

## Mock Demo

This proves the requested end-to-end path: initialize, read RPM, read speed, and read stored DTCs.

```bash
npm run mock:demo
```

Expected key values:

```json
{
  "initialized": true,
  "rpm": 1000,
  "speedKmh": 40,
  "storedDTCs": ["P0133"]
}
```

## CLI Usage

Mock mode:

```bash
node src/cli.js --mock connect
node src/cli.js --mock init
node src/cli.js --mock read rpm
node src/cli.js --mock read speed
node src/cli.js --mock read coolant
node src/cli.js --mock read load
node src/cli.js --mock read fuel
node src/cli.js --mock read dtc
node src/cli.js --mock read vin
node src/cli.js --mock snapshot
node src/cli.js --mock clear dtc --confirm
```

Real serial/Bluetooth SPP mode:

```bash
node src/cli.js --serial /dev/tty.OBDLinkMX-SPP init
node src/cli.js --serial /dev/tty.OBDLinkMX-SPP read rpm
node src/cli.js --serial /dev/tty.OBDLinkMX-SPP snapshot
```

The actual serial path depends on macOS pairing and device naming. For Wi-Fi or another transport, implement the same transport methods used by `MockTransport` and `SerialTransport`.

## Adapter Initialization

The adapter sends these commands in order and logs raw responses:

1. `ATZ`
2. `ATE0`
3. `ATL0`
4. `ATS0`
5. `ATH0`
6. `ATSP0`
7. `ATDP`

Each command waits for `>`. Timeout errors are retried once and then surfaced as structured errors.

## Supported Reads

Mode 01:

- `0100` supported PIDs bitmap, logged but not decoded in v1
- `010C` RPM
- `010D` speed
- `0105` coolant temperature
- `0104` engine load
- `012F` fuel level

Codes:

- `03` stored DTCs
- `07` pending DTCs
- `04` clear DTCs, only with `{ confirm: true }` or CLI `--confirm`

Mode 09:

- `0902` VIN, including simple multi-line assembly

## Programmatic Use

```js
import { MockTransport } from "./src/transport/mock_transport.js";
import { OBDAdapter } from "./src/adapter/obd_adapter.js";
import { OBDService } from "./src/services/obd_service.js";

const transport = new MockTransport();
const adapter = new OBDAdapter(transport);
const service = new OBDService(adapter);

await adapter.connect();
await adapter.initialize();

console.log(await service.getRPM());
console.log(await service.readStoredDTCs());
console.log(await service.snapshot());
```

## Structured Errors

Errors use `OBDError` with one of these codes:

- `timeout`
- `no_data`
- `malformed_response`
- `adapter_not_initialized`
- `transport_disconnected`
- `clear_confirmation_required`

## Notes

- Logs are verbose by design and include raw adapter responses.
- Raw responses are preserved in service results where useful.
- DTC clearing is never called automatically.
- Parsers are deterministic and covered by unit tests.
- The transport boundary makes Bluetooth, Wi-Fi, serial, and mock implementations interchangeable.
