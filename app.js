// The API lives at /api on the same domain — nothing to configure.
const API_BASE = "";

const els = {
  idle: document.getElementById("state-idle"),
  loading: document.getElementById("state-loading"),
  result: document.getElementById("state-result"),
  error: document.getElementById("state-error"),
  checkBtn: document.getElementById("check-btn"),
  againBtn: document.getElementById("again-btn"),
  retryBtn: document.getElementById("retry-btn"),
  badge: document.getElementById("result-badge"),
  reason: document.getElementById("result-reason"),
  next: document.getElementById("result-next"),
  location: document.getElementById("result-location"),
  sign: document.getElementById("result-sign"),
  errorMessage: document.getElementById("error-message"),
};

function showOnly(section) {
  for (const s of [els.idle, els.loading, els.result, els.error]) {
    s.classList.toggle("hidden", s !== section);
  }
}

function getLocation() {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("This browser doesn't support location."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos.coords),
      (err) => reject(new Error(mapGeoError(err))),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

function mapGeoError(err) {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return "Location access was denied. Allow it in your browser settings and try again.";
    case err.POSITION_UNAVAILABLE:
      return "Couldn't get a location fix. Try moving somewhere with a clearer sky view.";
    case err.TIMEOUT:
      return "Location took too long. Try again.";
    default:
      return "Couldn't get your location.";
  }
}

async function checkParking() {
  showOnly(els.loading);
  try {
    const { latitude, longitude } = await getLocation();
    const url = `${API_BASE}/api/check?lat=${latitude}&lng=${longitude}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Server error (${resp.status})`);
    const data = await resp.json();
    render(data);
  } catch (err) {
    els.errorMessage.textContent = err.message || "Something went wrong.";
    showOnly(els.error);
  }
}

function render(data) {
  const map = {
    YES: { label: "YES", cls: "yes" },
    NO: { label: "NO", cls: "no" },
    NOT_SURE: { label: "NOT SURE", cls: "not-sure" },
  };
  const badge = map[data.status] || map.NOT_SURE;

  els.badge.textContent = badge.label;
  els.badge.className = `badge ${badge.cls}`;
  els.reason.textContent = data.reason || "";

  if (data.nextChange) {
    const verb = data.status === "NO" ? "Legal again" : "Changes";
    els.next.textContent = `${verb} ${data.nextChange.dayLabel} at ${data.nextChange.time}`;
  } else {
    els.next.textContent = "";
  }

  els.location.textContent = buildLocationLine(data);
  els.sign.innerHTML = data.governingSign ? signSVG(data.governingSign.rule, data.status) : "";
  els.sign.classList.toggle("hidden", !data.governingSign);

  showOnly(els.result);
}

function buildLocationLine(data) {
  const sign = data.governingSign;
  if (!sign) return "";
  const parts = [];
  if (data.address) parts.push(`Near ${data.address}`);
  if (data.direction && sign.distanceM != null) {
    parts.push(`${Math.round(sign.distanceM)}m to your ${data.direction}`);
  }
  return parts.join(" — ");
}

// --- Schematic sign rendering -------------------------------------------
// Not a photo of the real sign (the city's photo archive is old and
// incomplete) -- this redraws what the API actually decoded, so it's a
// direct visual check against the physical sign in front of you.

const STATUS_ACCENT = { YES: "#1a7f4e", NO: "#c23b3b", NOT_SURE: "#b8860b" };
const DAY_LABEL = { mon: "LUN", tue: "MAR", wed: "MER", thu: "JEU", fri: "VEN", sat: "SAM", sun: "DIM" };
const MONTH_LABEL = ["", "JAN", "FÉV", "MARS", "AVR", "MAI", "JUIN", "JUIL", "AOÛT", "SEPT", "OCT", "NOV", "DÉC"];

function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function dayText(days) {
  if (!days || !days.length) return "";
  if (days.length === 7) return "TOUS LES JOURS";
  const order = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const sorted = [...days].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (sorted.length === 1) return DAY_LABEL[sorted[0]];
  const isConsecutive = sorted.every((d, i) => i === 0 || order.indexOf(d) === order.indexOf(sorted[i - 1]) + 1);
  if (isConsecutive) return `${DAY_LABEL[sorted[0]]}-${DAY_LABEL[sorted[sorted.length - 1]]}`;
  return sorted.map((d) => DAY_LABEL[d]).join(" ");
}

function timeText(windows) {
  if (!windows || !windows.length) return "";
  if (windows.length === 1 && windows[0].start === "00:00" && windows[0].end === "00:00") {
    return "EN TOUT TEMPS";
  }
  return windows.map((w) => `${w.start}-${w.end}`).join(" ET ");
}

function seasonText(season) {
  if (!season) return "";
  return `${season.startDay} ${MONTH_LABEL[season.startMonth]} AU ${season.endDay} ${MONTH_LABEL[season.endMonth]}`;
}

function signSVG(rule, status) {
  const accent = STATUS_ACCENT[status] || "#6b6455";
  const symbol = rule.restriction === "no_stopping" ? "A" : rule.restriction === "no_parking" ? "P" : "?";
  const lines = [timeText(rule.windows), dayText(rule.days), seasonText(rule.season)].filter(Boolean);

  const lineSvg = lines
    .map((line, i) => `<text x="100" y="${172 + i * 20}" text-anchor="middle" font-size="14" font-family="Arial, sans-serif" font-weight="${i === 0 ? 700 : 400}" fill="#1a1a1a">${esc(line)}</text>`)
    .join("");

  return `
<svg viewBox="0 0 200 240" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Schematic of the decoded sign">
  <rect x="4" y="4" width="192" height="232" rx="14" fill="#ffffff" stroke="${accent}" stroke-width="3"/>
  <circle cx="100" cy="76" r="46" fill="none" stroke="#c23b3b" stroke-width="6"/>
  <line x1="66" y1="42" x2="134" y2="110" stroke="#c23b3b" stroke-width="6"/>
  <text x="100" y="90" text-anchor="middle" font-size="52" font-family="Arial, sans-serif" font-weight="800" fill="#1a1a1a">${symbol}</text>
  ${lineSvg}
</svg>`.trim();
}

els.checkBtn.addEventListener("click", checkParking);
els.againBtn.addEventListener("click", checkParking);
els.retryBtn.addEventListener("click", checkParking);
