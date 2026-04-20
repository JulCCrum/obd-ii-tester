#!/usr/bin/env node
import http from "node:http";
import { OBDAdapter } from "./adapter/obd_adapter.js";
import { OBDService } from "./services/obd_service.js";
import { SerialTransport } from "./transport/real_transport.js";
import { OBDError } from "./errors.js";

const args = process.argv.slice(2);
const state = {
  connected: false,
  initialized: false,
  protocol: null,
  observedCheckEngineLight: hasFlag("--check-engine-light"),
  observedBatteryLight: hasFlag("--battery-light"),
  lastError: null,
  lastRaw: [],
  live: {},
  dtcs: null,
  vin: null,
  monitor: null,
  adapterVoltage: null
};

const logger = {
  info(message) {
    state.lastRaw = [...state.lastRaw.slice(-40), message];
    console.error(message);
  },
  warn(message) {
    state.lastRaw = [...state.lastRaw.slice(-40), message];
    console.error(message);
  }
};

const serialPath = getFlag("--serial");
if (!serialPath) {
  console.error("Usage: node src/gui.js --serial <path> [--baud 115200] [--timeout 8000] [--port 3008]");
  console.error("Example: node src/gui.js --serial /dev/cu.OBDLinkMX01162");
  process.exit(2);
}
const transport = new SerialTransport({ path: serialPath, baudRate: Number(getFlag("--baud", 115200)) });
const adapter = new OBDAdapter(transport, { logger, timeoutMs: Number(getFlag("--timeout", 8000)) });
const service = new OBDService(adapter);

function getFlag(name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? true;
}

function hasFlag(name) {
  return args.includes(name);
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body, null, 2));
}

function ok(data = {}, { clearError = true } = {}) {
  if (clearError) state.lastError = null;
  return { ok: true, state: { ...state, ...data } };
}

function fail(error) {
  state.lastError = serializeError(error);
  return { ok: false, error: state.lastError, state };
}

function serializeError(error) {
  if (error instanceof OBDError) {
    return { code: error.code, message: error.message, details: error.details };
  }
  return { code: "error", message: error.message ?? String(error), details: {} };
}

async function ensureConnected() {
  if (!adapter.isConnected()) {
    await adapter.connect();
  }
  state.connected = adapter.isConnected();
}

async function ensureInitialized() {
  await ensureConnected();
  if (!adapter.initialized) {
    const init = await adapter.initialize();
    state.initialized = true;
    state.protocol = init.protocol;
  }
}

async function routeApi(pathname, request, response) {
  try {
    if (pathname === "/api/state") {
      json(response, 200, ok({}, { clearError: false }));
      return;
    }

    if (pathname === "/api/connect") {
      await ensureConnected();
      json(response, 200, ok());
      return;
    }

    if (pathname === "/api/init") {
      await ensureInitialized();
      await readAdapterVoltage().catch(() => null);
      json(response, 200, ok());
      return;
    }

    if (pathname === "/api/live") {
      await ensureInitialized();
      await readLive();
      json(response, 200, ok());
      return;
    }

    if (pathname === "/api/codes") {
      await ensureInitialized();
      await readCodes();
      json(response, 200, ok());
      return;
    }

    if (pathname === "/api/vin") {
      await ensureInitialized();
      state.vin = await service.getVIN();
      json(response, 200, ok());
      return;
    }

    if (pathname === "/api/snapshot") {
      await ensureInitialized();
      await readLive();
      await readCodes().catch(() => null);
      await service.getVIN().then((vin) => { state.vin = vin; }).catch(() => null);
      json(response, 200, ok());
      return;
    }

    if (pathname === "/api/clear-dtc") {
      await ensureInitialized();
      const url = new URL(request.url, "http://localhost");
      const confirm = url.searchParams.get("confirm") === "true";
      const result = await service.clearDTCs({ confirm });
      json(response, 200, ok({ clearResult: result }));
      return;
    }

    json(response, 404, { ok: false, error: { message: "Not found" } });
  } catch (error) {
    json(response, 200, fail(error));
  }
}

async function readLive() {
  const [monitor, voltage, rpm, speed, coolant, load, fuel] = await Promise.allSettled([
    service.getMonitorStatus(),
    readAdapterVoltage(),
    service.getRPM(),
    service.getSpeed(),
    service.getCoolantTemp(),
    service.getEngineLoad(),
    service.getFuelLevel()
  ]);

  if (monitor.status === "fulfilled") state.monitor = monitor.value;
  if (voltage.status === "fulfilled") state.adapterVoltage = voltage.value;
  state.live = {
    rpm: valueOrError(rpm, "rpm"),
    speed: valueOrError(speed, "speed"),
    coolant: valueOrError(coolant, "coolant"),
    engineLoad: valueOrError(load, "engineLoad"),
    fuel: valueOrError(fuel, "fuel")
  };
}

async function readAdapterVoltage() {
  state.adapterVoltage = await service.getAdapterVoltage();
  return state.adapterVoltage;
}

async function readCodes() {
  const [stored, pending] = await Promise.allSettled([
    service.readStoredDTCs(),
    service.readPendingDTCs()
  ]);
  state.dtcs = {
    stored: valueOrError(stored, "stored"),
    pending: valueOrError(pending, "pending")
  };
}

function valueOrError(result, label) {
  if (result.status === "fulfilled") return result.value;
  return { error: serializeError(result.reason), label };
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    routeApi(url.pathname, request, response);
    return;
  }

  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(renderHtml());
});

const port = Number(getFlag("--port", 3008));
server.listen(port, "127.0.0.1", () => {
  console.log(`OBD GUI running at http://localhost:${port}`);
  console.log(`Using serial transport ${serialPath}`);
});

process.on("SIGINT", async () => {
  await adapter.disconnect().catch(() => {});
  server.close(() => process.exit(0));
});

function renderHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OBD-II · Diagnostic Bay</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Big+Shoulders+Display:wght@600;800;900&family=JetBrains+Mono:wght@300;400;500;700&display=swap">
  <style>
    :root {
      color-scheme: dark;
      --bg-deep: #07090a;
      --bg: #0c1012;
      --surface: #11171a;
      --surface-2: #161e22;
      --line: #1f2a30;
      --line-soft: #161e22;
      --bone: #ecede4;
      --text: #d6d8cd;
      --muted: #6b7680;
      --muted-soft: #4a545c;
      --amber: #ffb000;
      --amber-soft: rgba(255, 176, 0, 0.18);
      --amber-glow: rgba(255, 176, 0, 0.45);
      --hazard: #ff3b2f;
      --hazard-soft: rgba(255, 59, 47, 0.16);
      --hazard-glow: rgba(255, 59, 47, 0.55);
      --scope: #56ffb1;
      --scope-soft: rgba(86, 255, 177, 0.15);
      --ice: #6ad7ff;
      --grid: rgba(60, 90, 110, 0.07);
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 13px;
      line-height: 1.5;
      letter-spacing: 0.01em;
      min-height: 100vh;
      background-image:
        radial-gradient(ellipse 1200px 600px at 50% -100px, rgba(255, 176, 0, 0.06), transparent 60%),
        radial-gradient(ellipse 800px 500px at 90% 0%, rgba(106, 215, 255, 0.04), transparent 60%),
        linear-gradient(var(--grid) 1px, transparent 1px),
        linear-gradient(90deg, var(--grid) 1px, transparent 1px);
      background-size: auto, auto, 32px 32px, 32px 32px;
      background-attachment: fixed;
    }

    /* ── Top status rail ─────────────────────────────────────────── */
    .rail {
      display: flex; align-items: center; gap: 16px;
      padding: 10px 22px;
      background: linear-gradient(180deg, #0a0d0f 0%, #0c1012 100%);
      border-bottom: 1px solid var(--line);
      font-size: 11px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--muted);
      position: sticky; top: 0; z-index: 5;
    }
    .rail .brand {
      font-family: "Big Shoulders Display", sans-serif;
      font-weight: 900;
      font-size: 18px;
      letter-spacing: 0.08em;
      color: var(--bone);
      display: inline-flex; align-items: center; gap: 10px;
    }
    .rail .brand::before {
      content: "";
      width: 10px; height: 10px; border-radius: 999px;
      background: var(--amber);
      box-shadow: 0 0 12px var(--amber-glow);
      animation: ember 2.4s ease-in-out infinite;
    }
    @keyframes ember {
      0%,100% { opacity: 0.65; box-shadow: 0 0 6px var(--amber-glow); }
      50%     { opacity: 1;    box-shadow: 0 0 18px var(--amber-glow); }
    }
    .rail .sep { width: 1px; height: 20px; background: var(--line); }
    .rail .stamp { font-feature-settings: "tnum" 1; color: var(--text); }
    .rail .session { margin-left: auto; display: flex; gap: 18px; align-items: center; }

    /* ── Layout ─────────────────────────────────────────────────── */
    main { padding: 28px 22px 80px; max-width: 1400px; margin: 0 auto; }

    .hero {
      display: grid;
      grid-template-columns: minmax(260px, 320px) 1fr minmax(280px, 360px);
      gap: 18px;
      margin-bottom: 22px;
    }
    @media (max-width: 1100px) { .hero { grid-template-columns: 1fr 1fr; } .mil-card { grid-column: 1 / -1; } }
    @media (max-width: 720px) { .hero { grid-template-columns: 1fr; } }

    .panel {
      position: relative;
      background: linear-gradient(180deg, var(--surface) 0%, #0e1316 100%);
      border: 1px solid var(--line);
      border-radius: 4px;
      padding: 16px 18px 18px;
    }
    .panel::before {
      content: "";
      position: absolute; left: 14px; top: -1px; height: 2px; width: 36px;
      background: var(--amber);
      box-shadow: 0 0 8px var(--amber-glow);
    }
    .panel.cool::before { background: var(--ice); box-shadow: 0 0 8px rgba(106, 215, 255, 0.5); }
    .panel.hot::before  { background: var(--hazard); box-shadow: 0 0 10px var(--hazard-glow); }
    .panel.calm::before { background: var(--scope); box-shadow: 0 0 8px rgba(86, 255, 177, 0.45); }

    .panel-head {
      display: flex; align-items: baseline; justify-content: space-between;
      gap: 12px; margin-bottom: 10px;
    }
    .panel-title {
      font-family: "Big Shoulders Display", sans-serif;
      font-weight: 800;
      font-size: 14px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--bone);
    }
    .panel-tag { font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); }

    /* ── MIL idiot light ────────────────────────────────────────── */
    .mil-card {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 14px; min-height: 280px; padding: 24px;
      text-align: center;
    }
    .mil-light {
      width: 168px; height: 122px;
      display: flex; align-items: center; justify-content: center;
      filter: grayscale(1) brightness(0.32);
      transition: filter 400ms ease;
    }
    .mil-card.on .mil-light {
      filter: none;
      animation: milPulse 1.6s ease-in-out infinite;
    }
    @keyframes milPulse {
      0%,100% { filter: drop-shadow(0 0 6px rgba(255, 176, 0, 0.35)); }
      50%     { filter: drop-shadow(0 0 22px rgba(255, 176, 0, 0.95)); }
    }
    .mil-status {
      font-family: "Anton", sans-serif;
      font-size: 38px;
      letter-spacing: 0.06em;
      color: var(--muted);
      line-height: 1;
    }
    .mil-card.on .mil-status { color: var(--amber); text-shadow: 0 0 14px var(--amber-glow); }
    .mil-sub { font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); }
    .mil-card.on .mil-sub { color: var(--bone); }

    /* ── RPM radial ─────────────────────────────────────────────── */
    .rpm-card { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 280px; padding: 14px 18px 18px; }
    .gauge-wrap { position: relative; width: 100%; max-width: 380px; aspect-ratio: 1.2 / 1; }
    .gauge-num {
      position: absolute; left: 50%; top: 60%;
      transform: translate(-50%, -50%);
      font-family: "Anton", sans-serif;
      font-size: clamp(56px, 9vw, 96px);
      letter-spacing: 0.02em;
      color: var(--bone);
      font-feature-settings: "tnum" 1;
    }
    .gauge-unit {
      position: absolute; left: 50%; top: 84%;
      transform: translateX(-50%);
      font-size: 10px; letter-spacing: 0.32em; color: var(--muted);
      text-transform: uppercase;
    }

    /* ── Speed digital ─────────────────────────────────────────── */
    .speed-card { display: flex; flex-direction: column; min-height: 280px; gap: 18px; }
    .speed-head { display: flex; justify-content: space-between; align-items: baseline; }
    .speed-num {
      font-family: "Anton", sans-serif;
      font-size: clamp(96px, 18vw, 152px);
      line-height: 0.85;
      color: var(--bone);
      font-feature-settings: "tnum" 1;
      letter-spacing: -0.01em;
    }
    .speed-num small { font-family: "JetBrains Mono", monospace; font-size: 14px; color: var(--muted); letter-spacing: 0.18em; margin-left: 8px; vertical-align: super; }
    .speed-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .meta-cell { display: flex; flex-direction: column; gap: 2px; }
    .meta-label { font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--muted); }
    .meta-value { font-family: "Anton", sans-serif; font-size: 24px; color: var(--bone); letter-spacing: 0.02em; font-feature-settings: "tnum" 1; }
    .meta-value.scope { color: var(--scope); }

    /* ── Bar gauges (fuel / coolant / load / voltage) ─────────── */
    .bars { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 22px; }
    @media (max-width: 900px) { .bars { grid-template-columns: repeat(2, 1fr); } }

    .bar-card { padding: 14px 16px; }
    .bar-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
    .bar-name { font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); }
    .bar-value {
      font-family: "Anton", sans-serif; font-size: 28px;
      color: var(--bone); letter-spacing: 0.02em; line-height: 1;
      font-feature-settings: "tnum" 1;
    }
    .bar-value small { font-family: "JetBrains Mono", monospace; font-size: 11px; color: var(--muted); letter-spacing: 0.18em; margin-left: 4px; }
    .bar-track {
      position: relative;
      height: 8px;
      background: #0a0e10;
      border: 1px solid var(--line);
      border-radius: 2px;
      overflow: hidden;
    }
    .bar-track::after {
      content: "";
      position: absolute; inset: 0;
      background-image: linear-gradient(90deg, transparent 0 95%, rgba(255,255,255,0.05) 95% 100%);
      background-size: 10% 100%;
      pointer-events: none;
    }
    .bar-fill {
      position: absolute; inset: 0;
      width: var(--p, 0%);
      background: linear-gradient(90deg, var(--scope), var(--amber));
      box-shadow: 0 0 12px rgba(255, 176, 0, 0.35);
      transition: width 600ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .bar-fill.cool { background: linear-gradient(90deg, var(--ice), var(--scope)); box-shadow: 0 0 12px rgba(106, 215, 255, 0.3); }
    .bar-fill.hot  { background: linear-gradient(90deg, var(--amber), var(--hazard)); box-shadow: 0 0 14px var(--hazard-glow); }
    .bar-fill.calm { background: var(--scope); box-shadow: 0 0 10px rgba(86, 255, 177, 0.35); }
    .bar-fill.is-error, .bar-value.is-error { color: var(--hazard); }
    .bar-foot { display: flex; justify-content: space-between; margin-top: 6px; font-size: 10px; color: var(--muted-soft); letter-spacing: 0.16em; }

    /* ── Health strip ─────────────────────────────────────────── */
    .strip {
      display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
      padding: 12px 18px; margin-bottom: 22px;
      background: linear-gradient(180deg, var(--surface) 0%, #0d1214 100%);
      border: 1px solid var(--line);
      border-left: 3px solid var(--muted-soft);
      border-radius: 4px;
      font-size: 12px;
    }
    .strip.good { border-left-color: var(--scope); }
    .strip.warn { border-left-color: var(--amber); }
    .strip.bad  { border-left-color: var(--hazard); }
    .strip-text { color: var(--text); }
    .strip-tags { display: flex; gap: 12px; margin-left: auto; flex-wrap: wrap; }
    .tag {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase;
      color: var(--muted);
    }
    .tag::before { content: ""; width: 7px; height: 7px; border-radius: 999px; background: var(--muted-soft); }
    .tag.live::before  { background: var(--scope); box-shadow: 0 0 8px rgba(86, 255, 177, 0.5); animation: heartbeat 1.4s ease-in-out infinite; }
    .tag.warn::before  { background: var(--amber); box-shadow: 0 0 8px var(--amber-glow); }
    .tag.bad::before   { background: var(--hazard); box-shadow: 0 0 10px var(--hazard-glow); }
    @keyframes heartbeat { 0%,100% { opacity: 0.55; transform: scale(1); } 50% { opacity: 1; transform: scale(1.15); } }

    /* ── Action toolbar ───────────────────────────────────────── */
    .actions {
      display: flex; flex-wrap: wrap; gap: 8px;
      padding: 10px;
      margin-bottom: 22px;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 4px;
    }
    .btn {
      appearance: none;
      font-family: "JetBrains Mono", monospace;
      font-weight: 500;
      font-size: 12px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--text);
      background: transparent;
      border: 1px solid var(--line);
      border-radius: 3px;
      padding: 9px 14px;
      cursor: pointer;
      transition: background 120ms, color 120ms, border-color 120ms;
      display: inline-flex; align-items: center; gap: 8px;
    }
    .btn .key {
      font-size: 10px; color: var(--muted); border: 1px solid var(--line);
      padding: 1px 5px; border-radius: 2px;
    }
    .btn:hover { background: #18222a; border-color: #2a3942; color: var(--bone); }
    .btn:active { transform: translateY(1px); }
    .btn:disabled { opacity: 0.4; cursor: progress; }
    .btn.primary { color: #0a0d0f; background: var(--amber); border-color: var(--amber); }
    .btn.primary:hover { background: #ffc233; border-color: #ffc233; }
    .btn.primary .key { color: rgba(10,13,15,0.65); border-color: rgba(10,13,15,0.25); }
    .btn.danger { color: var(--hazard); border-color: rgba(255, 59, 47, 0.4); }
    .btn.danger:hover { background: rgba(255, 59, 47, 0.12); border-color: var(--hazard); color: #ff7269; }
    .actions .grow { flex: 1; }

    /* ── Codes panel ──────────────────────────────────────────── */
    .codes-panel { margin-bottom: 22px; padding: 18px 20px; }
    .codes-empty {
      display: flex; align-items: center; gap: 10px;
      color: var(--scope);
      font-family: "Big Shoulders Display", sans-serif;
      font-weight: 800; font-size: 22px; letter-spacing: 0.08em;
    }
    .codes-empty::before { content: ""; width: 14px; height: 14px; border-radius: 999px; background: var(--scope); box-shadow: 0 0 14px rgba(86, 255, 177, 0.6); }
    .codes-error { color: var(--hazard); font-size: 13px; }
    .codes-list { display: grid; gap: 8px; margin-top: 6px; }
    .code-row {
      display: grid; grid-template-columns: auto auto 1fr; align-items: baseline;
      gap: 14px; padding: 11px 14px;
      background: var(--surface-2);
      border: 1px solid var(--line);
      border-left: 3px solid var(--hazard);
      border-radius: 3px;
    }
    .code-row.pending { border-left-color: var(--amber); }
    .code-row .code-id {
      font-family: "Anton", sans-serif; font-size: 22px; letter-spacing: 0.04em;
      color: var(--bone); line-height: 1;
    }
    .code-row .code-kind {
      font-size: 9px; letter-spacing: 0.22em; text-transform: uppercase;
      color: var(--hazard); padding: 2px 6px; border: 1px solid var(--hazard);
      border-radius: 2px;
    }
    .code-row.pending .code-kind { color: var(--amber); border-color: var(--amber); }
    .code-row .code-desc { color: var(--text); font-size: 12.5px; line-height: 1.45; }
    .code-row .code-desc.unknown { color: var(--muted); font-style: italic; }

    /* ── Diagnostics meta (VIN, protocol) ─────────────────────── */
    .diag-meta { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 14px; margin-bottom: 22px; }
    @media (max-width: 760px) { .diag-meta { grid-template-columns: 1fr; } }
    .meta-tile { padding: 12px 16px; }
    .meta-tile .meta-label { margin-bottom: 4px; }
    .meta-tile .meta-text {
      font-family: "JetBrains Mono", monospace; font-size: 16px; font-weight: 500;
      color: var(--bone); letter-spacing: 0.04em; word-break: break-all;
    }
    .meta-tile .meta-text.muted { color: var(--muted); font-style: italic; }

    /* ── Telemetry / log ──────────────────────────────────────── */
    .console {
      background: #07090a;
      border: 1px solid var(--line);
      border-radius: 3px;
      font-family: "JetBrains Mono", monospace;
      font-size: 11.5px;
      line-height: 1.55;
      padding: 14px 16px;
      max-height: 320px;
      overflow: auto;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      color: var(--text);
    }
    .console.error { color: var(--hazard); background: rgba(255, 59, 47, 0.06); }
    .console .tx { color: var(--amber); }
    .console .rx { color: var(--scope); }
    .console .meta { color: var(--muted); }
    .telemetry-grid { display: grid; grid-template-columns: 1fr 1.2fr; gap: 14px; }
    @media (max-width: 900px) { .telemetry-grid { grid-template-columns: 1fr; } }

    /* ── Footnote ─────────────────────────────────────────────── */
    footer {
      margin-top: 28px; padding-top: 14px;
      border-top: 1px dashed var(--line);
      font-size: 10px; color: var(--muted-soft);
      letter-spacing: 0.16em; text-transform: uppercase;
      display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap;
    }

    /* ── Reveal animation ─────────────────────────────────────── */
    .reveal { opacity: 0; transform: translateY(8px); animation: rise 600ms cubic-bezier(0.2, 0.8, 0.2, 1) forwards; }
    .reveal.d1 { animation-delay: 60ms; } .reveal.d2 { animation-delay: 140ms; }
    .reveal.d3 { animation-delay: 220ms; } .reveal.d4 { animation-delay: 300ms; }
    .reveal.d5 { animation-delay: 380ms; } .reveal.d6 { animation-delay: 460ms; }
    @keyframes rise { to { opacity: 1; transform: translateY(0); } }

    .stale { color: var(--muted-soft); }
  </style>
</head>
<body>
  <div class="rail">
    <span class="brand">OBD-II · DIAGNOSTIC BAY</span>
    <span class="sep"></span>
    <span class="stamp">UNIT // <span id="r-protocol" class="stale">PROTOCOL OFFLINE</span></span>
    <span class="sep"></span>
    <span class="stamp">VBAT // <span id="r-voltage" class="stale">--.- V</span></span>
    <span class="session">
      <span class="tag" id="t-link">Link</span>
      <span class="tag" id="t-init">Init</span>
      <span class="tag" id="t-mil">MIL</span>
      <span class="stamp" id="r-clock">--:--:--</span>
    </span>
  </div>

  <main>
    <div id="health" class="strip reveal d1">
      <span class="strip-text" id="healthText">Standing by. Connect the adapter to begin.</span>
      <span class="strip-tags">
        <span class="tag" id="t-codes">CODES --</span>
        <span class="tag" id="t-cmds">CMDS --</span>
      </span>
    </div>

    <section class="hero">
      <article id="milCard" class="panel mil-card reveal d2">
        <div class="panel-head"><span class="panel-title">Check Engine</span><span class="panel-tag">PID 0101</span></div>
        <div class="mil-light" aria-hidden="true">
          <svg viewBox="0 0 168 122" width="168" height="122">
            <defs>
              <linearGradient id="milGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#ffd24a"/>
                <stop offset="100%" stop-color="#ff8a00"/>
              </linearGradient>
            </defs>
            <path d="M14 84 Q 14 52 42 50 L 56 50 Q 60 30 78 30 L 110 30 Q 128 30 132 50 L 146 50 L 146 38 L 158 38 L 158 84 Q 158 100 142 100 L 30 100 Q 14 100 14 84 Z"
                  fill="url(#milGrad)" stroke="#7a4a00" stroke-width="2"/>
            <rect x="50" y="58" width="68" height="14" rx="3" fill="#1a0f00" opacity="0.5"/>
            <circle cx="40" cy="84" r="6" fill="#1a0f00" opacity="0.5"/>
            <circle cx="132" cy="84" r="6" fill="#1a0f00" opacity="0.5"/>
            <path d="M84 18 L 92 4 L 100 18" stroke="#ffae00" stroke-width="3" fill="none" stroke-linecap="round"/>
          </svg>
        </div>
        <div class="mil-status" id="milStatus">UNKNOWN</div>
        <div class="mil-sub" id="milSub">Awaiting diagnostic read</div>
      </article>

      <article class="panel rpm-card reveal d3">
        <div class="panel-head" style="width:100%;"><span class="panel-title">Tachometer</span><span class="panel-tag">PID 010C · ×4 ÷</span></div>
        <div class="gauge-wrap">
          <svg viewBox="0 0 200 170" width="100%" height="100%" aria-hidden="true">
            <defs>
              <linearGradient id="rpmTrack" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stop-color="#56ffb1"/>
                <stop offset="55%" stop-color="#ffb000"/>
                <stop offset="100%" stop-color="#ff3b2f"/>
              </linearGradient>
            </defs>
            <path d="M20 140 A 80 80 0 1 1 180 140"
                  fill="none" stroke="#11181c" stroke-width="14" stroke-linecap="round"/>
            <path d="M20 140 A 80 80 0 1 1 180 140"
                  fill="none" stroke="url(#rpmTrack)" stroke-width="14" stroke-linecap="round"
                  stroke-dasharray="377" id="rpmArc" stroke-dashoffset="377"/>
            <g id="rpmTicks" stroke="#3c4a52" stroke-width="2"></g>
            <g id="rpmLabels" font-family="JetBrains Mono, monospace" font-size="10" fill="#5b6770" text-anchor="middle"></g>
          </svg>
          <div class="gauge-num" id="rpmNum">----</div>
          <div class="gauge-unit">×1000 rpm</div>
        </div>
      </article>

      <article class="panel speed-card reveal d4">
        <div class="speed-head"><span class="panel-title">Velocity</span><span class="panel-tag">PID 010D</span></div>
        <div class="speed-num"><span id="speedNum">--</span><small>km/h</small></div>
        <div class="speed-meta">
          <div class="meta-cell"><span class="meta-label">MPH</span><span class="meta-value" id="speedMph">--</span></div>
          <div class="meta-cell"><span class="meta-label">Engine Load</span><span class="meta-value scope" id="loadValue">--<small style="font-size:13px;color:var(--muted);">%</small></span></div>
        </div>
      </article>
    </section>

    <section class="bars">
      <article class="panel bar-card reveal d3">
        <div class="bar-row">
          <span class="bar-name">Coolant</span>
          <span class="bar-value" id="coolantNum">--<small>°C</small></span>
        </div>
        <div class="bar-track"><div class="bar-fill cool" id="coolantBar"></div></div>
        <div class="bar-foot"><span>−40°</span><span>OPTIMAL 80–105°</span><span>140°</span></div>
      </article>

      <article class="panel bar-card reveal d4">
        <div class="bar-row">
          <span class="bar-name">Fuel</span>
          <span class="bar-value" id="fuelNum">--<small>%</small></span>
        </div>
        <div class="bar-track"><div class="bar-fill" id="fuelBar"></div></div>
        <div class="bar-foot"><span>EMPTY</span><span>PID 012F</span><span>FULL</span></div>
      </article>

      <article class="panel bar-card reveal d5">
        <div class="bar-row">
          <span class="bar-name">Engine Load</span>
          <span class="bar-value" id="loadBarNum">--<small>%</small></span>
        </div>
        <div class="bar-track"><div class="bar-fill calm" id="loadBar"></div></div>
        <div class="bar-foot"><span>IDLE</span><span>PID 0104</span><span>WOT</span></div>
      </article>

      <article class="panel bar-card reveal d6">
        <div class="bar-row">
          <span class="bar-name">Adapter Voltage</span>
          <span class="bar-value" id="vbatNum">--<small>V</small></span>
        </div>
        <div class="bar-track"><div class="bar-fill" id="vbatBar"></div></div>
        <div class="bar-foot"><span>10V</span><span>NORMAL 12.4–14.7V</span><span>16V</span></div>
      </article>
    </section>

    <section class="actions reveal d2">
      <button class="btn" data-action onclick="callApi('/api/connect', this)">Connect <span class="key">C</span></button>
      <button class="btn primary" data-action onclick="callApi('/api/init', this)">Initialize <span class="key">I</span></button>
      <button class="btn" data-action onclick="callApi('/api/live', this)">Live <span class="key">L</span></button>
      <button class="btn" data-action onclick="callApi('/api/codes', this)">Codes <span class="key">D</span></button>
      <button class="btn" data-action onclick="callApi('/api/vin', this)">VIN <span class="key">V</span></button>
      <button class="btn" data-action onclick="callApi('/api/snapshot', this)">Full Snapshot <span class="key">S</span></button>
      <span class="grow"></span>
      <button class="btn danger" data-action onclick="clearCodes(this)">Clear DTCs</button>
    </section>

    <section class="diag-meta">
      <article class="panel meta-tile reveal d3">
        <div class="meta-label">Vehicle Identification</div>
        <div class="meta-text muted" id="vinValue">unread</div>
      </article>
      <article class="panel meta-tile reveal d4">
        <div class="meta-label">Stored Count</div>
        <div class="meta-text" id="storedCount">--</div>
      </article>
      <article class="panel meta-tile reveal d5">
        <div class="meta-label">Pending Count</div>
        <div class="meta-text" id="pendingCount">--</div>
      </article>
    </section>

    <section class="panel codes-panel reveal d3">
      <div class="panel-head"><span class="panel-title">Trouble Codes</span><span class="panel-tag">Mode 03 / 07</span></div>
      <div id="codesBody">
        <div class="codes-empty" style="opacity:0.4">Awaiting diagnostic read</div>
      </div>
    </section>

    <section class="telemetry-grid">
      <article class="panel reveal d4">
        <div class="panel-head"><span class="panel-title">Last Error</span><span class="panel-tag">JSON</span></div>
        <div class="console" id="errorConsole">// no errors</div>
      </article>
      <article class="panel calm reveal d5">
        <div class="panel-head"><span class="panel-title">Transport Log</span><span class="panel-tag" id="logCount">0 lines</span></div>
        <div class="console" id="rawConsole">// no traffic</div>
      </article>
    </section>

    <footer>
      <span>OBD-II · DIAGNOSTIC BAY</span>
      <span>ELM327 / STN11xx · ISO 15765-4 · Mode 01 / 03 / 07 / 09</span>
      <span>localhost:${port}</span>
    </footer>
  </main>

  <script>
    let inFlight = 0;
    drawTach();
    setInterval(updateClock, 1000); updateClock();

    async function callApi(path, button) {
      inFlight += 1;
      const buttons = document.querySelectorAll('button[data-action]');
      buttons.forEach(b => b.disabled = true);
      try {
        const response = await fetch(path, { method: 'POST' });
        const data = await response.json();
        render(data.state || {});
        if (!data.ok && data.error) renderError(data.error);
      } finally {
        inFlight -= 1;
        if (inFlight === 0) buttons.forEach(b => b.disabled = false);
      }
    }

    async function clearCodes(button) {
      const confirmed = window.confirm('Clear stored trouble codes? This may reset readiness monitors.');
      if (!confirmed) return;
      await callApi('/api/clear-dtc?confirm=true', button);
    }

    function render(state) {
      // top rail
      setTextOrStale('r-protocol', state.protocol, 'PROTOCOL OFFLINE');
      setVoltageRail('r-voltage', state.adapterVoltage);
      setTagState('t-link', state.connected, 'Link', state.connected ? 'live' : 'muted');
      setTagState('t-init', state.initialized, 'Init', state.initialized ? 'live' : 'muted');

      // MIL
      const milKnown = state.monitor && typeof state.monitor.milOn === 'boolean';
      const milOn = Boolean((state.monitor && state.monitor.milOn) || state.observedCheckEngineLight);
      setTagState('t-mil', milOn, 'MIL', milOn ? 'bad' : (milKnown ? 'live' : 'muted'));
      const milCard = document.getElementById('milCard');
      milCard.classList.toggle('on', milOn);
      milCard.classList.toggle('hot', milOn);
      const milStatus = document.getElementById('milStatus');
      const milSub = document.getElementById('milSub');
      if (milOn) { milStatus.textContent = 'CHECK ENGINE'; milSub.textContent = milCount(state); }
      else if (milKnown) { milStatus.textContent = 'CLEAR'; milSub.textContent = 'No active fault'; }
      else { milStatus.textContent = 'UNKNOWN'; milSub.textContent = 'Awaiting diagnostic read'; }

      // RPM
      const rpm = liveValue(state.live?.rpm, 'rpm');
      setRpmGauge(rpm);

      // Speed
      const kmh = liveValue(state.live?.speed, 'kmh');
      const mph = liveValue(state.live?.speed, 'mph');
      setNum('speedNum', kmh);
      setNum('speedMph', mph);

      // Engine load (in two places)
      const load = liveValue(state.live?.engineLoad, 'percent');
      setNumWithUnit('loadValue', load, '%');
      setBar('load', load, 0, 100, false);

      // Coolant
      const coolant = liveValue(state.live?.coolant, 'celsius');
      setNumWithUnit('coolantNum', coolant, '°C');
      setBar('coolant', coolant, -40, 140, false, (v) => v >= 80 && v <= 105 ? 'cool' : (v > 110 ? 'hot' : 'cool'));

      // Fuel
      const fuel = liveValue(state.live?.fuel, 'percent');
      setNumWithUnit('fuelNum', fuel, '%');
      setBar('fuel', fuel, 0, 100, false, (v) => v < 15 ? 'hot' : 'default');

      // Voltage bar
      const vbat = state.adapterVoltage?.volts;
      setNumWithUnit('vbatNum', vbat, 'V');
      setBar('vbat', vbat, 10, 16, false, (v) => (v < 12.0 ? 'hot' : (v > 14.9 ? 'hot' : 'calm')));

      // VIN / counts
      const vin = state.vin?.vin;
      const vinNode = document.getElementById('vinValue');
      if (vin) { vinNode.textContent = vin; vinNode.classList.remove('muted'); }
      else { vinNode.textContent = state.vin === null || state.vin === undefined ? 'unread' : 'unavailable'; vinNode.classList.add('muted'); }

      const stored = state.dtcs?.stored?.codes ?? null;
      const pending = state.dtcs?.pending?.codes ?? null;
      const monitorCount = state.monitor?.storedDtcCount;
      document.getElementById('storedCount').textContent = stored ? String(stored.length) : (monitorCount ?? '--');
      document.getElementById('pendingCount').textContent = pending ? String(pending.length) : '--';

      renderCodes(state.dtcs);
      renderHealth(state);
      renderRaw(state.lastRaw);
      renderError(state.lastError);

      const cmds = Array.isArray(state.lastRaw) ? state.lastRaw.filter(l => /^\\[tx\\]/.test(l)).length : 0;
      const codesCount = (stored?.length ?? 0) + (pending?.length ?? 0);
      setTagText('t-cmds', 'CMDS ' + cmds, cmds > 0 ? 'live' : 'muted');
      setTagText('t-codes', 'CODES ' + codesCount, codesCount > 0 ? 'bad' : (stored !== null ? 'live' : 'muted'));
    }

    function liveValue(result, key) {
      if (!result || result.error) return null;
      const v = result[key];
      return (v === undefined || v === null) ? null : v;
    }

    function milCount(state) {
      const n = state.monitor?.storedDtcCount;
      if (typeof n !== 'number') return 'Code stored — read diagnostics';
      return n + (n === 1 ? ' code stored' : ' codes stored');
    }

    function setNum(id, value) {
      const node = document.getElementById(id);
      if (value === null || value === undefined) { node.textContent = '--'; node.classList.add('stale'); }
      else { node.textContent = formatNumber(value); node.classList.remove('stale'); }
    }
    function setNumWithUnit(id, value, unit) {
      const node = document.getElementById(id);
      const prefix = (value === null || value === undefined) ? '--' : formatNumber(value);
      const cls = (value === null || value === undefined) ? ' stale' : '';
      const small = node.querySelector('small');
      if (small) {
        node.firstChild ? (node.firstChild.nodeType === 3 ? node.firstChild.textContent = prefix : null) : null;
        node.innerHTML = '';
        const t = document.createTextNode(prefix);
        node.appendChild(t);
        const s = document.createElement('small');
        s.textContent = unit; node.appendChild(s);
      } else {
        node.textContent = prefix + ' ' + unit;
      }
      node.classList.toggle('stale', value === null || value === undefined);
      void cls;
    }
    function setTextOrStale(id, value, fallback) {
      const node = document.getElementById(id);
      if (value) { node.textContent = value; node.classList.remove('stale'); }
      else { node.textContent = fallback; node.classList.add('stale'); }
    }
    function setVoltageRail(id, voltage) {
      const node = document.getElementById(id);
      if (voltage && (voltage.volts || voltage.volts === 0)) { node.textContent = formatNumber(voltage.volts) + ' V'; node.classList.remove('stale'); }
      else { node.textContent = '--.- V'; node.classList.add('stale'); }
    }
    function formatNumber(n) {
      if (typeof n !== 'number') return n;
      if (Number.isInteger(n)) return n.toLocaleString();
      return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }

    function setBar(prefix, value, min, max, invert, classifier) {
      const fill = document.getElementById(prefix + 'Bar');
      if (value === null || value === undefined || isNaN(value)) {
        fill.style.setProperty('--p', '0%');
        fill.classList.remove('cool','hot','calm');
        return;
      }
      const span = max - min;
      let pct = ((value - min) / span) * 100;
      if (invert) pct = 100 - pct;
      pct = Math.max(0, Math.min(100, pct));
      fill.style.setProperty('--p', pct.toFixed(1) + '%');
      fill.classList.remove('cool','hot','calm');
      if (classifier) {
        const k = classifier(value);
        if (k && k !== 'default') fill.classList.add(k);
      }
    }

    function setRpmGauge(rpm) {
      const node = document.getElementById('rpmNum');
      const arc = document.getElementById('rpmArc');
      if (rpm === null || rpm === undefined) {
        node.textContent = '----';
        node.classList.add('stale');
        arc.setAttribute('stroke-dashoffset', '377');
        return;
      }
      node.classList.remove('stale');
      node.textContent = rpm.toLocaleString();
      const max = 8000;
      const clamped = Math.max(0, Math.min(max, rpm));
      const length = 377;
      arc.setAttribute('stroke-dashoffset', String((1 - clamped / max) * length));
    }

    function drawTach() {
      const ticks = document.getElementById('rpmTicks');
      const labels = document.getElementById('rpmLabels');
      const cx = 100, cy = 140, r = 80;
      const startAngle = 180; const endAngle = 360; const span = endAngle - startAngle;
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const angle = (startAngle + t * span) * Math.PI / 180;
        const x1 = cx + (r - 4) * Math.cos(angle);
        const y1 = cy + (r - 4) * Math.sin(angle);
        const inset = i % 2 === 0 ? 14 : 8;
        const x2 = cx + (r - inset) * Math.cos(angle);
        const y2 = cy + (r - inset) * Math.sin(angle);
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1); line.setAttribute('y1', y1);
        line.setAttribute('x2', x2); line.setAttribute('y2', y2);
        if (i >= 6) line.setAttribute('stroke', '#ff3b2f');
        if (i % 2 === 0) {
          const lx = cx + (r - 26) * Math.cos(angle);
          const ly = cy + (r - 26) * Math.sin(angle) + 3;
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('x', lx); text.setAttribute('y', ly);
          text.textContent = String(i);
          if (i >= 6) text.setAttribute('fill', '#ff3b2f');
          labels.appendChild(text);
        }
        ticks.appendChild(line);
      }
    }

    function renderCodes(dtcs) {
      const body = document.getElementById('codesBody');
      if (!dtcs) {
        body.innerHTML = '<div class="codes-empty" style="opacity:0.4">Awaiting diagnostic read</div>';
        return;
      }
      const storedErr = dtcs.stored?.error;
      const pendingErr = dtcs.pending?.error;
      const stored = dtcs.stored?.codes || [];
      const pending = dtcs.pending?.codes || [];
      if (storedErr && pendingErr) {
        body.innerHTML = '<div class="codes-error">' + escapeHtml(errorLabel(storedErr)) + '</div>';
        return;
      }
      if (!stored.length && !pending.length) {
        body.innerHTML = '<div class="codes-empty">NO ACTIVE FAULTS</div>';
        return;
      }
      const rows = [
        ...stored.map(c => codeRow(c, 'stored')),
        ...pending.map(c => codeRow(c, 'pending'))
      ];
      body.innerHTML = '<div class="codes-list">' + rows.join('') + '</div>';
    }

    function codeRow(entry, kind) {
      const code = typeof entry === 'string' ? entry : entry?.code;
      const desc = typeof entry === 'object' && entry?.description ? entry.description : null;
      const descClass = desc ? '' : ' unknown';
      const descText = desc || 'No description in catalog';
      return '<div class="code-row ' + kind + '">' +
        '<span class="code-id">' + escapeHtml(code || '') + '</span>' +
        '<span class="code-kind">' + kind + '</span>' +
        '<span class="code-desc' + descClass + '">' + escapeHtml(descText) + '</span>' +
        '</div>';
    }

    function renderHealth(state) {
      const node = document.getElementById('health');
      const text = document.getElementById('healthText');
      let cls = '', msg;
      if (state.initialized) {
        cls = 'good';
        msg = '◢ Adapter initialized on ' + (state.protocol || 'unknown protocol') + ' — ECU live.';
      } else if (state.lastError?.code === 'timeout') {
        cls = 'bad';
        msg = '⚠ Serial port opened, but the adapter did not return a prompt. Re-pair Bluetooth and try again.';
      } else if (state.connected) {
        cls = 'warn';
        msg = '◌ Serial port opened. Initialize the adapter to begin reading.';
      } else {
        msg = '⊘ Standing by. Connect the adapter to begin.';
      }
      node.className = 'strip reveal d1' + (cls ? ' ' + cls : '');
      text.textContent = msg;
    }

    function renderError(error) {
      const node = document.getElementById('errorConsole');
      if (!error) { node.textContent = '// no errors'; node.classList.remove('error'); return; }
      node.textContent = JSON.stringify(error, null, 2);
      node.classList.add('error');
    }

    function renderRaw(log) {
      const node = document.getElementById('rawConsole');
      const count = document.getElementById('logCount');
      if (!Array.isArray(log) || log.length === 0) {
        node.textContent = '// no traffic';
        count.textContent = '0 lines';
        return;
      }
      count.textContent = log.length + ' lines';
      const html = log.map(line => {
        const safe = escapeHtml(line);
        if (/^\\[tx\\]/.test(line)) return '<span class="tx">' + safe + '</span>';
        if (/^\\[rx\\]/.test(line)) return '<span class="rx">' + safe + '</span>';
        return '<span class="meta">' + safe + '</span>';
      }).join('\\n');
      node.innerHTML = html;
      node.scrollTop = node.scrollHeight;
    }

    function setTagState(id, active, label, mode) {
      const node = document.getElementById(id);
      node.className = 'tag' + (mode && mode !== 'muted' ? ' ' + mode : '');
      node.textContent = label;
    }
    function setTagText(id, text, mode) {
      const node = document.getElementById(id);
      node.className = 'tag' + (mode && mode !== 'muted' ? ' ' + mode : '');
      node.textContent = text;
    }

    function errorLabel(error) {
      const c = error?.code;
      if (c === 'no_data') return 'Not supported by this vehicle';
      if (c === 'timeout') return 'Adapter timed out';
      if (c === 'malformed_response') return 'Bad response from adapter';
      if (c === 'transport_disconnected') return 'Transport disconnected';
      return error?.message || 'Error';
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    function updateClock() {
      const d = new Date();
      const t = [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2,'0')).join(':');
      document.getElementById('r-clock').textContent = t;
    }

    document.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const map = { c:'/api/connect', i:'/api/init', l:'/api/live', d:'/api/codes', v:'/api/vin', s:'/api/snapshot' };
      const path = map[e.key.toLowerCase()];
      if (path) { e.preventDefault(); callApi(path); }
    });

    fetch('/api/state').then(r => r.json()).then(d => render(d.state || {}));
  </script>
</body>
</html>`;
}
