export const VEHICLE_TUNING = {
  // Chassis
  chassisHalfExtents: { x: 0.9, y: 0.4, z: 2.1 },
  mass: 1300,
  centerOfMassOffsetY: -0.2,

  // Wheels (relative to chassis center)
  wheelRadius: 0.36,
  wheelHalfWidth: 0.18,
  suspensionRestLength: 0.35,
  suspensionStiffness: 28,
  dampingCompression: 2.2,
  dampingRelaxation: 2.8,
  maxSuspensionTravel: 0.4,
  maxSuspensionForce: 20000,
  frictionSlip: 1.8,

  // Positions: x left/right, y vertical (slightly below chassis), z forward/back.
  // Body-local -Z is the car's forward direction (matches camera's forward).
  wheelAnchors: [
    { x: -0.85, y: -0.25, z: -1.4 }, // front left
    { x: 0.85, y: -0.25, z: -1.4 }, // front right
    { x: -0.85, y: -0.25, z: 1.4 }, // rear left
    { x: 0.85, y: -0.25, z: 1.4 }, // rear right
  ],

  // Drive
  maxEngineForce: 2200,
  maxBrakeForce: 90,
  maxHandbrakeForce: 250,
  maxSteerAngle: 0.55, // radians

  // Feel
  steerSpeed: 3.5, // how fast steer approaches target
  steerSpeedAtHighSpeed: 1.6, // dampened at high speed
  throttleSmoothing: 4.0,

  // Top speed softcut (m/s)
  topSpeed: 82,
};
