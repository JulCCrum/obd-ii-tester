/**
 * Transport contract:
 * - connect(): Promise<void>
 * - disconnect(): Promise<void>
 * - send(rawText): Promise<void>
 * - receiveUntilPrompt(timeoutMs): Promise<string>
 * - isConnected(): boolean
 *
 * Transport implementations only move ASCII text. They do not parse OBD.
 */
export class Transport {
  async connect() {
    throw new Error("connect() not implemented");
  }

  async disconnect() {
    throw new Error("disconnect() not implemented");
  }

  async send(_rawText) {
    throw new Error("send() not implemented");
  }

  async receiveUntilPrompt(_timeoutMs) {
    throw new Error("receiveUntilPrompt() not implemented");
  }

  isConnected() {
    return false;
  }
}
