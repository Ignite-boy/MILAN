async function getJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function refreshStatus() {
  const output = document.getElementById("output");
  const health = document.getElementById("health");
  const storage = document.getElementById("storage");
  const service = document.getElementById("service");
  const version = document.getElementById("version");

  try {
    const [healthData, infoData] = await Promise.all([
      getJson("/health"),
      getJson("/info")
    ]);

    health.textContent = healthData.ok ? "Healthy" : "Unhealthy";
    health.style.color = healthData.ok ? "#63e6be" : "#ff8787";

    service.textContent = healthData.service || "DWN";
    storage.textContent = healthData.storage || "LevelDB";

    version.textContent = infoData.version || infoData.serviceVersion || "0.1.0";
    output.textContent = JSON.stringify({
      health: healthData,
      info: infoData
    }, null, 2);
  } catch (error) {
    health.textContent = "Offline";
    health.style.color = "#ff8787";
    output.textContent = `Unable to reach DWN API.\n\n${error.message}`;
  }
}

document.getElementById("refresh").addEventListener("click", refreshStatus);
refreshStatus();
setInterval(refreshStatus, 15000);
