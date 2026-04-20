import { ErrorCode, OBDError } from "../errors.js";
import { normalizeRawResponse, responseHasNoData } from "../parsers/response_utils.js";

const INIT_COMMANDS = Object.freeze([
  ["ATZ", "Reset adapter"],
  ["ATE0", "Echo off"],
  ["ATL0", "Linefeeds off"],
  ["ATS0", "Spaces off"],
  ["ATH0", "Headers off"],
  ["ATSP0", "Automatic protocol"],
  ["ATDP", "Display protocol"]
]);

export class OBDAdapter {
  constructor(transport, { timeoutMs = 3000, logger = console } = {}) {
    this.transport = transport;
    this.timeoutMs = timeoutMs;
    this.logger = logger;
    this.initialized = false;
    this.protocol = null;
    this.initLog = [];
    this.pendingRequest = Promise.resolve();
  }

  async connect() {
    await this.transport.connect();
    this.logger.info?.("[transport] connected");
  }

  async disconnect() {
    await this.transport.disconnect();
    this.initialized = false;
    this.logger.info?.("[transport] disconnected");
  }

  isConnected() {
    return this.transport.isConnected();
  }

  async initialize() {
    this.initLog = [];
    for (const [command, description] of INIT_COMMANDS) {
      const raw = await this.sendAdapterCommand(command, { retryOnce: true });
      this.initLog.push({ command, description, raw });
      this.logger.info?.(`[adapter] ${command} ${description}: ${JSON.stringify(raw)}`);

      if (command === "ATDP") {
        this.protocol = normalizeRawResponse(raw).join(" ").replace(/^AUTO,\s*/i, "");
      }
    }
    this.initialized = true;

    const warmupTimeout = Math.max(this.timeoutMs, 8000);
    try {
      const warmup = await this.sendRaw("0100", { retryOnce: true, timeoutMs: warmupTimeout });
      this.initLog.push({ command: "0100", description: "Warm up auto-protocol", raw: warmup });
      this.logger.info?.(`[adapter] 0100 Warm up: ${JSON.stringify(warmup)}`);
      const updatedProtocol = await this.sendAdapterCommand("ATDP", { retryOnce: true });
      this.protocol = normalizeRawResponse(updatedProtocol).join(" ").replace(/^AUTO,\s*/i, "");
    } catch (error) {
      this.logger.warn?.(`[adapter] warm-up 0100 failed: ${error.message}`);
    }

    return {
      initialized: true,
      protocol: this.protocol,
      log: this.initLog
    };
  }

  async sendAdapterCommand(command, { retryOnce = true } = {}) {
    return this.sendRaw(command, { retryOnce, requireInitialized: false });
  }

  async request(command) {
    if (!this.initialized) {
      throw new OBDError(ErrorCode.ADAPTER_NOT_INITIALIZED, "Adapter has not been initialized", {
        command
      });
    }
    return this.sendRaw(command, { retryOnce: true, requireInitialized: true });
  }

  async sendRaw(command, { retryOnce = true, timeoutMs } = {}) {
    const run = this.pendingRequest.then(
      () => this._sendRawNow(command, { retryOnce, timeoutMs }),
      () => this._sendRawNow(command, { retryOnce, timeoutMs })
    );
    this.pendingRequest = run.catch(() => {});
    return run;
  }

  async _sendRawNow(command, { retryOnce = true, timeoutMs } = {}) {
    if (!this.transport.isConnected()) {
      throw new OBDError(ErrorCode.TRANSPORT_DISCONNECTED, "Transport is disconnected", { command });
    }

    const normalized = command.trim().toUpperCase();
    const effectiveTimeout = timeoutMs ?? this.timeoutMs;
    let lastError = null;
    const attempts = retryOnce ? 2 : 1;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        this.logger.info?.(`[tx] ${normalized}`);
        await this.transport.send(`${normalized}\r`);
        const raw = await this.transport.receiveUntilPrompt(effectiveTimeout);
        this.logger.info?.(`[rx] ${JSON.stringify(raw)}`);
        if (responseHasNoData(raw)) {
          throw new OBDError(ErrorCode.NO_DATA, "Adapter returned NO DATA", { command: normalized, raw });
        }
        return raw;
      } catch (error) {
        lastError = error;
        if (!(error instanceof OBDError) || error.code !== ErrorCode.TIMEOUT || attempt === attempts) {
          break;
        }
        this.logger.warn?.(`[adapter] timeout for ${normalized}; retrying once`);
      }
    }

    if (lastError instanceof OBDError) {
      lastError.details = { ...lastError.details, command: normalized, attempts };
      throw lastError;
    }

    throw lastError;
  }
}
