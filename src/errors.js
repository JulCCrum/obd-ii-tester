export const ErrorCode = Object.freeze({
  TIMEOUT: "timeout",
  NO_DATA: "no_data",
  MALFORMED_RESPONSE: "malformed_response",
  ADAPTER_NOT_INITIALIZED: "adapter_not_initialized",
  TRANSPORT_DISCONNECTED: "transport_disconnected",
  CLEAR_CONFIRMATION_REQUIRED: "clear_confirmation_required"
});

export class OBDError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "OBDError";
    this.code = code;
    this.details = details;
  }
}
