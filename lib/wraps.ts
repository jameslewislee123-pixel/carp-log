// Wrap distance calculator for carp fishing.
//
// "Wrapping" measures cast distance by walking the line back and forth on
// two banksticks placed one rod-length apart. One round trip (out + back)
// covers two rod lengths — so for a 12ft rod, one wrap = 7.3152m.
//
// We fix rod length at 12ft because it's the dominant choice for UK
// distance carping. Per-spot or per-user rod length might come later.

const ROD_FEET = 12;
const FEET_TO_METERS = 0.3048;
const ROD_METERS = ROD_FEET * FEET_TO_METERS;        // 3.6576
export const ONE_WRAP_METERS = ROD_METERS * 2;       // 7.3152

export function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371000;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLam = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function calculateWraps(
  swimLat: number, swimLng: number,
  spotLat: number, spotLng: number,
): number {
  const meters = haversineMeters(swimLat, swimLng, spotLat, spotLng);
  return Math.round(meters / ONE_WRAP_METERS);
}

// Midpoint along a great-circle line. Good enough for the short distances
// involved in a single swim-to-spot line — we only use it to anchor the
// "X wraps" label, not for navigation.
export function midpoint(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): { lat: number; lng: number } {
  return { lat: (lat1 + lat2) / 2, lng: (lng1 + lng2) / 2 };
}
