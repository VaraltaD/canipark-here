const TIMEZONE = "America/Toronto"; // Montreal shares this IANA zone
const DAY_ORDER = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Restrictive = actively blocks parking when its window is active. */
const RESTRICTIVE = new Set(["no_stopping", "no_parking", "permit_required"]);

function nowInMontreal(at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);

  const get = (type) => parts.find((p) => p.type === type)?.value;
  const day = get("weekday").toLowerCase().slice(0, 3); // "mon", "tue", ...
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const month = Number(get("month"));
  const date = Number(get("day"));
  return { day, minutes: hour * 60 + minute, month, date };
}

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Is `nowMinutes` inside [start, end), handling windows that cross midnight. */
function withinWindow(nowMinutes, startHHMM, endHHMM) {
  const start = timeToMinutes(startHHMM);
  const end = timeToMinutes(endHHMM);
  if (start === end) return true; // 24h window
  if (start < end) return nowMinutes >= start && nowMinutes < end;
  return nowMinutes >= start || nowMinutes < end; // crosses midnight
}

/** Is today's month/day inside a seasonal range, e.g. April 1 - Dec 1. */
function withinSeason(when, season) {
  if (!season) return true;
  const cur = when.month * 100 + when.date;
  const start = season.startMonth * 100 + season.startDay;
  const end = season.endMonth * 100 + season.endDay;
  if (start <= end) return cur >= start && cur <= end;
  return cur >= start || cur <= end; // wraps across the new year
}

/**
 * Is this rule "active" (i.e. its restriction currently applies) right now?
 */
function isRuleActiveNow(rule, when) {
  if (!withinSeason(when, rule.season)) return false;
  if (rule.exceptions?.includes(when.day)) return false;
  if (rule.days?.length && !rule.days.includes(when.day)) return false;
  if (!rule.windows?.length) {
    return rule.days?.length > 0;
  }
  return rule.windows.some((w) => withinWindow(when.minutes, w.start, w.end));
}

/**
 * Next minute-of-week (0-10079) at which `rule`'s active-state flips.
 * Note: this doesn't account for seasonal start/end dates -- if a rule is
 * currently out of season, this still reports the next weekly time it
 * would flip *if* it were in season. Good enough for "what time today",
 * not fully correct right at a season boundary.
 */
function nextTransition(rule, when) {
  const nowDow = DAY_ORDER.indexOf(when.day);
  const nowAbsolute = nowDow * 1440 + when.minutes;
  const candidates = [];

  for (const w of rule.windows?.length ? rule.windows : [{ start: "00:00", end: "00:00" }]) {
    for (let dow = 0; dow < 7; dow++) {
      const day = DAY_ORDER[dow];
      if (rule.days?.length && !rule.days.includes(day)) continue;
      if (rule.exceptions?.includes(day)) continue;
      for (const edge of [w.start, w.end]) {
        const abs = dow * 1440 + timeToMinutes(edge);
        const delta = ((abs - nowAbsolute) % 10080 + 10080) % 10080;
        if (delta > 0) candidates.push(delta);
      }
    }
  }
  if (!candidates.length) return null;
  return Math.min(...candidates);
}

function formatDelta(minutesFromNow, when) {
  const nowDow = DAY_ORDER.indexOf(when.day);
  const nowAbsolute = nowDow * 1440 + when.minutes;
  const target = (nowAbsolute + minutesFromNow) % 10080;
  const targetDow = Math.floor(target / 1440);
  const targetMinOfDay = target % 1440;
  const h = Math.floor(targetMinOfDay / 60);
  const m = targetMinOfDay % 60;
  const label = String(h % 24).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  const daysAhead = (targetDow - nowDow + 7) % 7;
  if (daysAhead === 0) return { time: label, dayLabel: "today" };
  if (daysAhead === 1) return { time: label, dayLabel: "tomorrow" };
  return { time: label, dayLabel: DAY_ORDER[targetDow] };
}

// Specific reason text when the sign names who it's actually for. Falls
// back to the generic restriction text below when no category matched.
// bus_only and disabled_loading_zone are confirmed against real city data
// (2026-08-17); the rest are educated guesses pending confirmation --
// see the CATEGORY_KEYWORDS comment in data/parse_rtp.py.
const CATEGORY_TEXT = {
  disabled_loading_zone: "Accessible-parking permit holders only right now -- pick-up/drop-off zone (handicap\u00e9s / d\u00e9barcad\u00e8re).",
  emergency: "Reserved for emergency vehicles (ambulance) right now.",
  police_only: "Reserved for police vehicles right now.",
  fire_lane: "Fire lane / hydrant access -- no stopping right now.",
  taxi_only: "Taxi stand -- reserved for taxis right now.",
  bus_only: "Bus zone -- reserved for buses right now.",
  disabled_only: "Reserved for accessible-parking permit holders right now.",
  diplomatic: "Reserved for diplomatic vehicles right now.",
  loading_zone: "Loading zone (d\u00e9barcad\u00e8re) -- drop-off/pick-up only, no parking, right now.",
  permit_zone: "Permit-holders only (vignette / SRRR) -- a residential sticker is required right now.",
};

function describeRestriction(rule) {
  if (rule.category && CATEGORY_TEXT[rule.category]) {
    return CATEGORY_TEXT[rule.category];
  }
  switch (rule.restriction) {
    case "no_stopping":
      return "No stopping in effect right now (stricter than no parking -- moving your car isn't enough, it can't be left standing at all).";
    case "no_parking":
      return "No parking in effect right now.";
    case "permit_required":
      return "Permit/residential-sticker zone in effect right now.";
    default:
      return "A parking restriction is in effect right now.";
  }
}

/**
 * Given the signs found near a location, decide YES / NO / NOT_SURE for
 * right now, plus when that next changes and why.
 */
function evaluate(signsNearby, at = new Date()) {
  const when = nowInMontreal(at);

  if (!signsNearby.length) {
    return {
      status: "NOT_SURE",
      reason: "No signed parking regulation found within range of this location.",
      nearestSigns: [],
    };
  }

  const lowConfidence = signsNearby.filter((s) => s.rule.confidence === "low");
  const usable = signsNearby.filter((s) => s.rule.confidence !== "low");

  if (!usable.length) {
    return {
      status: "NOT_SURE",
      reason: "Found signage here, but couldn't confidently decode the restriction. Check the sign in person.",
      nearestSigns: signsNearby,
    };
  }

  const active = usable
    .map((s) => ({ sign: s, isActive: isRuleActiveNow(s.rule, when) }))
    .filter((x) => x.isActive && RESTRICTIVE.has(x.sign.rule.restriction));

  if (active.length > 0) {
    const blocking = active[0].sign;
    const transition = nextTransition(blocking.rule, when);
    const next = transition != null ? formatDelta(transition, when) : null;
    return {
      status: "NO",
      reason: describeRestriction(blocking.rule),
      nextChange: next,
      governingSign: blocking,
      lowConfidenceNearby: lowConfidence.length,
    };
  }

  let soonestTransition = null;
  let soonestSign = null;
  for (const s of usable) {
    if (!RESTRICTIVE.has(s.rule.restriction)) continue;
    const t = nextTransition(s.rule, when);
    if (t != null && (soonestTransition == null || t < soonestTransition)) {
      soonestTransition = t;
      soonestSign = s;
    }
  }

  return {
    status: "YES",
    reason: "No active parking restriction found for this time.",
    nextChange: soonestTransition != null ? formatDelta(soonestTransition, when) : null,
    governingSign: soonestSign,
    lowConfidenceNearby: lowConfidence.length,
  };
}

module.exports = { evaluate };
