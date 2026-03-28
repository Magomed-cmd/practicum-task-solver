import { MESSAGE_TYPES } from "./config.js";

const toggleButton = document.getElementById("toggle");
const statusElement = document.getElementById("status");

let currentStatus = null;
let isBusy = false;
let currentErrorMessage = "";

toggleButton?.addEventListener("click", async () => {
  if (isBusy) {
    return;
  }

  const messageType = currentStatus?.isRunning ? MESSAGE_TYPES.stopSolver : MESSAGE_TYPES.runSolver;

  isBusy = true;
  currentErrorMessage = "";
  renderStatus(currentStatus);

  try {
    currentStatus = await sendRuntimeMessage(messageType);
    currentErrorMessage = "";
    renderStatus(currentStatus);
  } catch (error) {
    currentErrorMessage = error.message;
    renderStatus(currentStatus, currentErrorMessage);
  } finally {
    isBusy = false;
    renderStatus(currentStatus, currentErrorMessage);
  }
});

void refreshStatus();
window.setInterval(() => {
  void refreshStatus({ silent: true });
}, 1000);

async function refreshStatus({ silent = false } = {}) {
  if (isBusy && silent) {
    return;
  }

  if (!silent) {
    isBusy = true;
    currentErrorMessage = "";
    renderStatus(currentStatus);
  }

  try {
    currentStatus = await sendRuntimeMessage(MESSAGE_TYPES.getStatus);
    if (!silent) {
      currentErrorMessage = "";
      renderStatus(currentStatus);
    } else if (currentStatus) {
      currentErrorMessage = "";
      renderStatus(currentStatus);
    }
  } catch (error) {
    if (!silent) {
      currentErrorMessage = error.message;
      renderStatus(currentStatus, currentErrorMessage);
    }
  } finally {
    if (!silent) {
      isBusy = false;
      renderStatus(currentStatus, currentErrorMessage);
    }
  }
}

function sendRuntimeMessage(type) {
  return new Promise((resolve, reject) => {
    let isSettled = false;
    const timeoutId = setTimeout(() => {
      if (isSettled) {
        return;
      }

      isSettled = true;
      reject(new Error("Service worker не ответил вовремя"));
    }, 3000);

    chrome.runtime.sendMessage({ type }, (response) => {
      if (isSettled) {
        return;
      }

      isSettled = true;
      clearTimeout(timeoutId);

      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response) {
        reject(new Error("Service worker не вернул ответ"));
        return;
      }

      if (!response?.ok) {
        reject(new Error(response?.error || "Неизвестная ошибка"));
        return;
      }

      resolve(response.status || null);
    });
  });
}

function renderStatus(status, errorMessage = "") {
  if (!toggleButton || !statusElement) {
    return;
  }

  if (errorMessage) {
    statusElement.textContent = errorMessage;
    statusElement.dataset.tone = "error";
  } else if (!status) {
    statusElement.textContent = isBusy ? "Проверяю статус..." : "Статус недоступен";
    statusElement.dataset.tone = "";
  } else {
    statusElement.textContent = status.statusText;
    statusElement.dataset.tone = status.isStopping ? "stopping" : status.isRunning ? "running" : "";
  }

  if (!status) {
    toggleButton.textContent = isBusy ? "Загрузка..." : "Обнови расширение";
    toggleButton.dataset.mode = "";
    toggleButton.disabled = true;
    return;
  }

  toggleButton.textContent = isBusy
    ? status.isRunning ? "Обрабатываю..." : "Запускаю..."
    : status.buttonLabel;
  toggleButton.dataset.mode = status.isRunning ? "stop" : "start";
  toggleButton.disabled = isBusy || status.isStopping || (!status.isPracticum && !status.isRunning);
}
