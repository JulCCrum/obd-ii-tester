# OBD-II Tester

A small Node.js OBD-II diagnostic tool for OBDLink MX+ and other ELM327/STN11xx-compatible adapters. Sends ASCII commands over Bluetooth-SPP (or any serial-compatible transport), parses live PIDs, trouble codes, and VIN, and exposes a live-data dashboard in the browser.

## Features

- **Adapter layer**: serialized request queue, init sequence with warm-up read so ELM327 auto-protocol search settles before the first real OBD command, retries on timeout, structured errors.
- **Parsers**: handles both single-frame and **multi-frame ISO-TP** responses (the `0:` / `1:` / `N:` chunk format OBDLink produces for Mode 03/07 DTCs and Mode 09 VIN), honors the Mode 03/07 count byte, and attaches human-readable SAE J2012 descriptions to each code.
- **Dashboard**: dark diagnostic-service-bay UI — radial RPM tachometer with redline, horizontal liquid bars for fuel/coolant/load/voltage, MIL idiot-light that pulses when active, color-coded DTC rows with descriptions, keyboard shortcuts, live transport log.
- **CLI**: scriptable one-shot reads for any supported PID or diagnostic mode.

## Install

Requires Node 20 or newer.

```bash
git clone <this-repo>
cd obd-ii-tester
npm install
npm test   # 23/23
```

The `serialport` package is an optional dependency — only needed if you actually talk to a real adapter.

## Quick start — dashboard

Pair your OBDLink with macOS first (System Settings → Bluetooth → Connect). Confirm your device file with:

```bash
ls /dev/cu.OBDLinkMX*
```

Then launch the dashboard:

```bash
node src/gui.js --serial /dev/cu.OBDLinkMX01162
```

Open http://localhost:3008 and hit **Initialize** then **Snapshot**. Keyboard shortcuts: `C` Connect · `I` Initialize · `L` Live · `D` Codes · `V` VIN · `S` Full snapshot.

## Quick start — CLI

```bash
node src/cli.js --serial /dev/cu.OBDLinkMX01162 init
node src/cli.js --serial /dev/cu.OBDLinkMX01162 snapshot
node src/cli.js --serial /dev/cu.OBDLinkMX01162 read rpm
node src/cli.js --serial /dev/cu.OBDLinkMX01162 read dtc
node src/cli.js --serial /dev/cu.OBDLinkMX01162 read vin
node src/cli.js --serial /dev/cu.OBDLinkMX01162 clear dtc --confirm
```

Flags: `--serial <path>` (required), `--baud <n>` (default 115200), `--timeout <ms>` (default 8000), `--confirm` (required for clear).

## Supported reads

Mode 01:
- `0100` supported PIDs bitmap
- `010C` RPM · `010D` speed · `0105` coolant · `0104` load · `012F` fuel

Diagnostics:
- `03` stored DTCs (single- and multi-frame) with descriptions
- `07` pending DTCs with descriptions
- `04` clear DTCs (`--confirm` required)

Mode 09:
- `0902` VIN (single- and multi-frame)

Adapter meta:
- `ATRV` battery voltage · `ATDP` protocol

## Project layout

```text
src/
  transport/
    transport_interface.js    # minimal transport contract
    real_transport.js         # serial/BT-SPP transport
    mock_transport.js         # test-only stub
  adapter/
    obd_adapter.js            # command queue, init, retries
  services/
    obd_service.js            # typed PID reads and snapshot
  parsers/
    pid_parser.js             # Mode 01 decoders
    dtc_parser.js             # Mode 03/07 + multi-frame
    vin_parser.js             # Mode 09 + multi-frame
    response_utils.js
  data/
    dtc_descriptions.js       # SAE J2012 code catalog
  models/
    obd_value.js · dtc.js · vehicle_snapshot.js
  gui.js                      # HTTP server + embedded dashboard
  cli.js                      # scriptable CLI
  tests/
    *.test.js                 # 23 tests
```

## Programmatic use

```js
import { SerialTransport } from "./src/transport/real_transport.js";
import { OBDAdapter } from "./src/adapter/obd_adapter.js";
import { OBDService } from "./src/services/obd_service.js";

const transport = new SerialTransport({ path: "/dev/cu.OBDLinkMX01162" });
const adapter = new OBDAdapter(transport, { timeoutMs: 8000 });
const service = new OBDService(adapter);

await adapter.connect();
await adapter.initialize();

console.log(await service.getRPM());
console.log(await service.readStoredDTCs());
console.log(await service.snapshot());
```

## Structured errors

`OBDError` instances carry a `code` field — one of:

- `timeout` · `no_data` · `malformed_response`
- `adapter_not_initialized` · `transport_disconnected`
- `clear_confirmation_required`

## Known limitation: macOS Bluetooth-SPP reliability

The OBDLink MX+ exposes two Bluetooth paths: classic **BT-SPP** (what this project uses via `/dev/cu.*`) and a proprietary **BLE GATT** protocol (what the official OBDLink phone app uses).

On macOS, the classic BT-SPP path is genuinely unreliable with this adapter — the RFCOMM channel often fails to negotiate on `port.open()` even when the link layer reports connected, and once a single open fails, the path usually stays wedged until a fresh System Settings re-pair or a Mac reboot. The reliability ceiling seems to be roughly one successful session per fresh pair.

This is not a bug in this project — the adapter is healthy (the iOS/Android app works perfectly) and the protocol parser handles real-world responses correctly when the channel does come up. It's an interaction between Apple's BT-Classic serial driver and OBDLink's firmware that neither vendor cleanly supports.

The eventual fix is a BLE GATT transport speaking OBDLink's proprietary protocol directly; that's not in this repo yet.

## License

MIT (unless you add one — this repo has none yet).
