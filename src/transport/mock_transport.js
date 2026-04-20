import { ErrorCode, OBDError } from "../errors.js";

export const defaultMockResponses = Object.freeze({
  ATZ: "ELM327 v1.3a\r>",
  ATE0: "OK\r>",
  ATL0: "OK\r>",
  ATS0: "OK\r>",
  ATH0: "OK\r>",
  ATSP0: "OK\r>",
  ATDP: "AUTO, ISO 15765-4 (CAN 11/500)\r>",
  "0100": "4100BE3EA813\r>",
  "0101": "410181000000\r>",
  "010C": "410C0FA0\r>",
  "010D": "410D28\r>",
  "0105": "410564\r>",
  "0104": "41047F\r>",
  "012F": "412F80\r>",
  "03": "4301013300\r>",
  "07": "4700000000\r>",
  "04": "OK\r>",
  ATRV: "12.4V\r>",
  "0902": "4902015741575A5A5A314A5A58\r49020257303030303031\r>"
});

export class MockTransport {
  constructor(responses = defaultMockResponses, options = {}) {
    this.responses = new Map(Object.entries(responses));
    this.connected = false;
    this.lastCommand = null;
    this.commandLog = [];
    this.timeouts = new Set(options.timeouts ?? []);
  }

  async connect() {
    this.connected = true;
  }

  async disconnect() {
    this.connected = false;
  }

  async send(rawText) {
    this.assertConnected();
    this.lastCommand = rawText.trim().toUpperCase();
    this.commandLog.push(this.lastCommand);
  }

  async receiveUntilPrompt(_timeoutMs = 3000) {
    this.assertConnected();
    if (this.timeouts.has(this.lastCommand)) {
      this.timeouts.delete(this.lastCommand);
      throw new OBDError(ErrorCode.TIMEOUT, `Timed out waiting for ${this.lastCommand}`, {
        command: this.lastCommand
      });
    }

    if (!this.responses.has(this.lastCommand)) {
      return "NO DATA\r>";
    }

    return this.responses.get(this.lastCommand);
  }

  isConnected() {
    return this.connected;
  }

  assertConnected() {
    if (!this.connected) {
      throw new OBDError(ErrorCode.TRANSPORT_DISCONNECTED, "Transport is disconnected");
    }
  }
}
