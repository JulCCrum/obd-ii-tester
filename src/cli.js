#!/usr/bin/env node
import { OBDAdapter } from "./adapter/obd_adapter.js";
import { OBDService } from "./services/obd_service.js";
import { SerialTransport } from "./transport/real_transport.js";
import { OBDError } from "./errors.js";

const args = process.argv.slice(2);

function getFlag(name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? true;
}

function hasFlag(name) {
  return args.includes(name);
}

function commandArgs() {
  return args.filter((arg, index) => {
    if (arg.startsWith("--")) return false;
    const previous = args[index - 1];
    return !(previous?.startsWith("--") && previous !== "--confirm");
  });
}

function createTransport() {
  const path = getFlag("--serial");
  if (!path) {
    throw new Error("--serial <path> is required (e.g. /dev/cu.OBDLinkMX01162)");
  }
  return new SerialTransport({
    path,
    baudRate: Number(getFlag("--baud", 115200))
  });
}

async function createClient({ initialize = false } = {}) {
  const transport = createTransport();
  const adapter = new OBDAdapter(transport, {
    logger: {
      info: (message) => console.error(message),
      warn: (message) => console.error(message)
    }
  });
  const service = new OBDService(adapter);
  await adapter.connect();
  if (initialize) await adapter.initialize();
  return { adapter, service };
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const [primary, secondary] = commandArgs();

  if (!primary || hasFlag("--help")) {
    printHelp();
    return;
  }

  const needsInit = ["read", "snapshot", "demo"].includes(primary);
  const { adapter, service } = await createClient({ initialize: needsInit });

  try {
    if (primary === "connect") {
      printJson({ connected: adapter.isConnected() });
      return;
    }

    if (primary === "init") {
      printJson(await adapter.initialize());
      return;
    }

    if (primary === "snapshot") {
      printJson(await service.snapshot());
      return;
    }

    if (primary === "demo") {
      const rpm = await service.getRPM();
      const speed = await service.getSpeed();
      const dtcs = await service.readStoredDTCs();
      printJson({
        initialized: adapter.initialized,
        protocol: adapter.protocol,
        rpm: rpm.rpm,
        speedKmh: speed.kmh,
        storedDTCs: dtcs.codes,
        raw: {
          rpm: rpm.raw,
          speed: speed.raw,
          dtc: dtcs.raw
        }
      });
      return;
    }

    if (primary === "clear" && secondary === "dtc") {
      printJson(await service.clearDTCs({ confirm: hasFlag("--confirm") }));
      return;
    }

    if (primary === "read") {
      await handleRead(service, secondary);
      return;
    }

    throw new Error(`Unknown command: ${[primary, secondary].filter(Boolean).join(" ")}`);
  } finally {
    await adapter.disconnect().catch(() => {});
  }
}

async function handleRead(service, subject) {
  switch (subject) {
    case "supported":
    case "pids":
      printJson(await service.getSupportedPIDs());
      break;
    case "rpm":
      printJson(await service.getRPM());
      break;
    case "speed":
      printJson(await service.getSpeed());
      break;
    case "coolant":
      printJson(await service.getCoolantTemp());
      break;
    case "load":
      printJson(await service.getEngineLoad());
      break;
    case "fuel":
      printJson(await service.getFuelLevel());
      break;
    case "dtc":
      printJson({
        stored: await service.readStoredDTCs(),
        pending: await service.readPendingDTCs()
      });
      break;
    case "vin":
      printJson(await service.getVIN());
      break;
    default:
      throw new Error(`Unknown read target: ${subject}`);
  }
}

function printHelp() {
  console.log(`Basic OBD-II tester for OBDLink MX+

Usage:
  node src/cli.js --serial <path> init
  node src/cli.js --serial /dev/cu.OBDLinkMX01162 snapshot
  node src/cli.js --serial /dev/cu.OBDLinkMX01162 read rpm

Commands:
  connect
  init
  read supported
  read rpm
  read speed
  read coolant
  read load
  read fuel
  read dtc
  read vin
  clear dtc --confirm
  snapshot
  demo

Options:
  --serial <path>         Serial/Bluetooth SPP device path (required)
  --baud <number>         Serial baud rate, defaults to 115200
  --confirm               Required for clear dtc`);
}

main().catch((error) => {
  if (error instanceof OBDError) {
    console.error(JSON.stringify({
      error: {
        code: error.code,
        message: error.message,
        details: error.details
      }
    }, null, 2));
    process.exitCode = 2;
    return;
  }

  console.error(error.stack ?? String(error));
  process.exitCode = 1;
});
