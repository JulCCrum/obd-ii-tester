import { ErrorCode, OBDError } from "../errors.js";

export class SerialTransport {
  constructor({ path, baudRate = 115200 } = {}) {
    this.path = path;
    this.baudRate = baudRate;
    this.port = null;
    this.buffer = "";
  }

  async connect() {
    if (!this.path) {
      throw new Error("Serial path is required, for example /dev/tty.OBDLinkMX-SPP");
    }

    const { SerialPort } = await import("serialport");
    this.port = new SerialPort({ path: this.path, baudRate: this.baudRate, autoOpen: false });
    this.port.on("data", (chunk) => {
      this.buffer += chunk.toString("ascii");
    });

    await new Promise((resolve, reject) => {
      this.port.open((error) => (error ? reject(error) : resolve()));
    });

    await this.waitForChannel();
  }

  async waitForChannel({ initialWaitMs = 3000, probeWaitMs = 1500, retries = 2 } = {}) {
    await new Promise((resolve) => setTimeout(resolve, initialWaitMs));

    for (let attempt = 0; attempt < retries; attempt += 1) {
      this.buffer = "";
      await this.writeRaw("\r");
      if (await this.waitForBytes(probeWaitMs)) return;
    }

    throw new OBDError(ErrorCode.TIMEOUT, "Adapter did not respond after open; BT-SPP channel may not have established", {
      path: this.path
    });
  }

  async waitForBytes(timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (this.buffer.length > 0) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  }

  async writeRaw(text) {
    await new Promise((resolve, reject) => {
      this.port.write(text, "ascii", (error) => (error ? reject(error) : resolve()));
    });
    await new Promise((resolve, reject) => {
      this.port.drain((error) => (error ? reject(error) : resolve()));
    });
  }

  async disconnect() {
    if (!this.port?.isOpen) return;
    await new Promise((resolve, reject) => {
      this.port.close((error) => (error ? reject(error) : resolve()));
    });
  }

  async send(rawText) {
    if (!this.isConnected()) {
      throw new OBDError(ErrorCode.TRANSPORT_DISCONNECTED, "Transport is disconnected");
    }
    const command = rawText.endsWith("\r") ? rawText : `${rawText}\r`;
    await this.writeRaw(command);
  }

  async receiveUntilPrompt(timeoutMs = 3000) {
    if (!this.isConnected()) {
      throw new OBDError(ErrorCode.TRANSPORT_DISCONNECTED, "Transport is disconnected");
    }

    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const promptIndex = this.buffer.indexOf(">");
      if (promptIndex !== -1) {
        const raw = this.buffer.slice(0, promptIndex + 1);
        this.buffer = this.buffer.slice(promptIndex + 1);
        return raw;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    throw new OBDError(ErrorCode.TIMEOUT, "Timed out waiting for adapter prompt");
  }

  isConnected() {
    return Boolean(this.port?.isOpen);
  }
}
