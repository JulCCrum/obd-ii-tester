#!/usr/bin/env node
import noble from "@abandonware/noble";

const SCAN_MS = 15000;
const NAME_FILTER = /obdlink|stn|obd|elm/i;

const seen = new Map();
let target = null;
let scanTimer = null;

noble.on("stateChange", async (state) => {
  if (state !== "poweredOn") {
    console.error(`[probe] BLE state: ${state}`);
    if (state === "unauthorized") {
      console.error("[probe] Grant Bluetooth permission to your terminal app:");
      console.error("[probe]   System Settings -> Privacy & Security -> Bluetooth");
    } else if (state === "poweredOff") {
      console.error("[probe] Bluetooth is off. Turn it on and rerun.");
    }
    process.exit(1);
  }
  console.error(`[probe] Bluetooth ready. Scanning for ${SCAN_MS / 1000}s...`);
  console.error("[probe] (devices will appear as discovered)\n");
  await noble.startScanningAsync([], false);

  scanTimer = setTimeout(finishScan, SCAN_MS);
});

noble.on("discover", (peripheral) => {
  const uuid = peripheral.uuid;
  if (seen.has(uuid)) return;
  const name = peripheral.advertisement?.localName || "(unnamed)";
  const rssi = peripheral.rssi;
  const services = peripheral.advertisement?.serviceUuids ?? [];
  seen.set(uuid, { name, rssi, services });

  const matched = NAME_FILTER.test(name);
  const marker = matched ? "***" : "   ";
  console.error(
    `[probe] ${marker} ${name.padEnd(28)} uuid=${uuid} rssi=${rssi} services=[${services.join(",") || "-"}]`
  );

  if (matched && !target) target = peripheral;
});

async function finishScan() {
  await noble.stopScanningAsync();
  console.error(`\n[probe] Scan complete. ${seen.size} device(s) seen.`);

  if (!target) {
    console.error("[probe] No OBDLink/STN/OBD/ELM device advertised over BLE.");
    console.error("[probe] Possible reasons:");
    console.error("[probe]   (a) MX+ doesn't expose a public BLE GATT profile on macOS (MFi/iAP-only).");
    console.error("[probe]   (b) Adapter is currently bonded over BT-Classic and not advertising BLE.");
    console.error("[probe]       Try: System Settings -> Bluetooth -> remove OBDLinkMX, replug, rerun.");
    console.error("[probe]   (c) Adapter is unpowered. Confirm it's plugged into the OBD-II port with ignition/accessory on.");
    process.exit(0);
  }

  console.error(`\n[probe] Connecting to ${target.advertisement?.localName} (${target.uuid})...`);
  try {
    await target.connectAsync();
    console.error(`[probe] Connected. MTU=${target.mtu ?? "unknown"}. Discovering...\n`);

    const services = await target.discoverServicesAsync([]);
    for (const service of services) {
      console.log(`SERVICE  ${service.uuid}`);
      const chars = await service.discoverCharacteristicsAsync([]);
      for (const char of chars) {
        const props = char.properties.join(",");
        console.log(`  CHAR   ${char.uuid}   [${props}]`);
      }
    }

    console.error("\n[probe] Done. Disconnecting...");
    await target.disconnectAsync();
    process.exit(0);
  } catch (error) {
    console.error(`[probe] Connect/discover failed: ${error.message}`);
    process.exit(2);
  }
}

process.on("SIGINT", async () => {
  if (scanTimer) clearTimeout(scanTimer);
  try { await noble.stopScanningAsync(); } catch {}
  if (target?.state === "connected") {
    try { await target.disconnectAsync(); } catch {}
  }
  process.exit(130);
});
