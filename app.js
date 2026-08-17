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

  showOnly(els.result);
}

els.checkBtn.addEventListener("click", checkParking);
els.againBtn.addEventListener("click", checkParking);
els.retryBtn.addEventListener("click", checkParking);
