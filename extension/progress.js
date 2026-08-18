const percentEl = document.getElementById("percent");
const bar = document.getElementById("bar");
const stop = document.getElementById("stop");

function render(current, total) {
  const percent = Math.min(99, Math.round((current / Math.max(total, 1)) * 100));
  percentEl.textContent = `${percent}%`;
  bar.style.width = `${percent}%`;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== "progress") return;
  if (message.type === "fpc-progress") render(message.current, message.total);
  if (message.type === "fpc-done") window.close();
});

stop.addEventListener("click", () => {
  stop.textContent = "Stopping…";
  stop.disabled = true;
  chrome.runtime.sendMessage({ target: "background", type: "fpc-cancel" });
});

// The popup can open mid-capture, so pull the current state rather than
// waiting for the next push.
const state = await chrome.runtime.sendMessage({ target: "background", type: "fpc-progress-ready" });
if (state && state.total) render(state.current, state.total);
