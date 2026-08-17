const fs = require("node:fs");
const path = require("node:path");
const { findNearestSigns } = require("./lib/nearestSigns");
const { evaluate } = require("./lib/ruleEngine");

let signsCache = null;
function loadSigns() {
  if (signsCache) return signsCache;
  const signsPath = path.join(process.cwd(), "data", "processed", "signs.json");
  signsCache = JSON.parse(fs.readFileSync(signsPath, "utf-8"));
  return signsCache;
}

module.exports = (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({ error: "lat and lng query params are required numbers" });
    return;
  }

  let signs;
  try {
    signs = loadSigns();
  } catch (err) {
    res.status(500).json({
      error: "Sign data isn't available yet. Run the data pipeline and redeploy (see README).",
    });
    return;
  }

  const radiusM = Number(req.query.radiusM) || 25;
  const nearby = findNearestSigns(signs, lat, lng, { radiusM, maxResults: 8 });
  const result = evaluate(nearby, new Date());

  res.status(200).json({
    query: { lat, lng, radiusM },
    ...result,
  });
};
