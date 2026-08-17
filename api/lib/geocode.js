// Turns a sign's lat/lng into a human-readable street address using
// OpenStreetMap's free Nominatim service. No API key needed, but their
// usage policy asks for max ~1 request/second and a real User-Agent --
// fine for a small personal app, but if this ever gets real traffic,
// swap in a paid geocoder (Mapbox, Google) or self-hosted Nominatim.
// See: https://operations.osmfoundation.org/policies/nominatim/

// Cached per warm serverless instance -- many users will ask about the
// same signs, so this avoids re-geocoding the same spot repeatedly.
// Resets on cold start, which is fine; it's a courtesy cache, not a
// guarantee.
const cache = new Map();

async function reverseGeocode(lat, lng) {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (cache.has(key)) return cache.get(key);

  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
      `&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
    const resp = await fetch(url, {
      headers: {
        // Nominatim requires an identifiable User-Agent. Replace the
        // contact with your own if you want bounce-backs about the app.
        "User-Agent": "canipark-here/1.0 (personal project)",
      },
      signal: AbortSignal.timeout(4000),
    });
    if (!resp.ok) throw new Error(`geocode responded ${resp.status}`);

    const data = await resp.json();
    const a = data.address || {};
    const road = a.road || a.pedestrian || a.footway || a.cycleway || "";
    const houseNumber = a.house_number || "";
    const address =
      (houseNumber && road ? `${houseNumber} ${road}` : road) ||
      (data.display_name ? data.display_name.split(",")[0] : null);

    cache.set(key, address || null);
    return address || null;
  } catch (err) {
    // Address is a nice-to-have, not core to the YES/NO answer -- fail
    // quietly rather than breaking the whole response.
    cache.set(key, null);
    return null;
  }
}

module.exports = { reverseGeocode };
