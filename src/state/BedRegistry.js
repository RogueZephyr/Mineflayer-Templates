// src/state/BedRegistry.js
export default class BedRegistry {
  static usedBeds = new Set();

  static claim(bedPosKey) {
    if (this.usedBeds.has(bedPosKey)) return false;
    this.usedBeds.add(bedPosKey);
    return true;
  }

  static release(bedPosKey) {
    this.usedBeds.delete(bedPosKey);
  }

  static toKey(pos) {
    return `${pos.x},${pos.y},${pos.z}`;
  }
}
