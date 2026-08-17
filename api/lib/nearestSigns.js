const EARTH_RADIUS_M = 6371000;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}
function toDeg(rad) {
  return (rad * 180) / Math.PI;
}

/** Distance in meters between two lat/lng points. */
function haversine(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** 8-point compass direction from (lat1,lng1) looking toward (lat2,lng2). */
function bearingLabel(lat1, lng1, lat2, lng2) {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLambda = toRad(lng2 - lng1);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const deg = (toDeg(Math.atan2(y, x)) + 360) % 360;
  return COMPASS[Math.round(deg / 45) % 8];
}

/**
 * Returns the signs closest to (lat, lng), within radiusM, sorted nearest
 * first, capped at maxResults. A curb-side sign is what governs a given
 * stretch of street, so we only want the handful physically nearest the
 * user, not every sign in the city.
 */
function findNearestSigns(signs, lat, lng, { radiusM = 30, maxResults = 8 } = {}) {
  const withDistance = [];
  for (const sign of signs) {
    const d = haversine(lat, lng, sign.lat, sign.lng);
    if (d <= radiusM) {
      withDistance.push({ ...sign, distanceM: Math.round(d * 10) / 10 });
    }
  }
  withDistance.sort((a, b) => a.distanceM - b.distanceM);
  return withDistance.slice(0, maxResults);
}

module.exports = { haversine, bearingLabel, findNearestSigns };
