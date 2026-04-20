#!/usr/bin/env node
import { SerialTransport } from "./transport/real_transport.js";

const args = process.argv.slice(2);
const path = flag("--serial");
const baudRate = Number(flag("--baud", 115200));
const command = flag("--cmd", "AT");
const timeoutMs = Number(flag("--timeout", 10000));

function flag(name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? true;
}

const transport = new SerialTransport({ path, baudRate });

try {
  await transport.connect();
  console.error(`[probe] connected ${path} @ ${baudRate}`);
  console.error(`[probe] tx ${command}`);
  await transport.send(command);
  const raw = await transport.receiveUntilPrompt(timeoutMs);
  console.log(JSON.stringify({ ok: true, command, raw }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: {
      name: error.name,
      code: error.code,
      message: error.message,
      details: error.details
    }
  }, null, 2));
  process.exitCode = 1;
} finally {
  await transport.disconnect().catch(() => {});
}
