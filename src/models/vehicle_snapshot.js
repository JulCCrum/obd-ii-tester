export function vehicleSnapshot(fields) {
  return {
    connected: Boolean(fields.connected),
    protocol: fields.protocol ?? null,
    rpm: fields.rpm ?? null,
    speedKmh: fields.speedKmh ?? null,
    coolantTempC: fields.coolantTempC ?? null,
    engineLoadPct: fields.engineLoadPct ?? null,
    fuelLevelPct: fields.fuelLevelPct ?? null,
    vin: fields.vin ?? null
  };
}
