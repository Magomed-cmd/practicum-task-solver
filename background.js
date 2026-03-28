import {
  AUTOMATION_PHASES,
  COMMANDS,
  MESSAGE_TYPES,
  PAGE_AUTOMATION_RULES,
  createAutomationState,
  extractTaskIdFromUrl,
  isPracticumUrl
} from "./config.js";
import {
  clearAutomationState,
  getAutomationState,
  setAutomationState
} from "./automationStateStore.js";
import {
  advanceThroughPageInPage,
  submitSolutionsInPage
} from "./pageActions.js";
import { createLogger, queueLogEntries } from "./logger.js";

const processingTabs = new Set();
const LOADING_WATCHDOG_ALARM_PREFIX = "loading-watchdog:";
const log = createLogger("background");

registerListeners();

function registerListeners() {
  chrome.alarms.onAlarm.addListener(handleAlarm);
  chrome.commands.onCommand.addListener(handleCommand);
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  chrome.tabs.onUpdated.addListener(handleTabUpdated);
  chrome.tabs.onRemoved.addListener(handleTabRemoved);
}

function handleAlarm(alarm) {
  if (!alarm?.name?.startsWith(LOADING_WATCHDOG_ALARM_PREFIX)) {
    return;
  }

  const tabId = Number(alarm.name.slice(LOADING_WATCHDOG_ALARM_PREFIX.length));

  if (!Number.isInteger(tabId)) {
    return;
  }

  runWithLoggedError("Ошибка watchdog загрузки:", () => handleLoadingWatchdogAlarm(tabId));
}

function handleCommand(command) {
  if (command !== COMMANDS.runSolver) {
    return;
  }

  log.info("Получена команда запуска", { command });
  runWithLoggedError("Не удалось запустить авто-решение:", startAutomationOnActiveTab);
}

function handleRuntimeMessage(message, _sender, sendResponse) {
  if (message?.type === MESSAGE_TYPES.runSolver) {
    log.info("Получено сообщение запуска", { type: message.type });
    respondWithTask(sendResponse, startAutomationOnActiveTab, "Не удалось запустить авто-решение");
    return true;
  }

  if (message?.type === MESSAGE_TYPES.stopSolver) {
    log.info("Получено сообщение остановки", { type: message.type });
    respondWithTask(sendResponse, stopAutomationOnActiveTab, "Не удалось остановить авто-решение");
    return true;
  }

  if (message?.type === MESSAGE_TYPES.getStatus) {
    respondWithTask(sendResponse, getAutomationStatusForActiveTab, "Не удалось получить статус авто-цикла");
    return true;
  }

  return false;
}

function handleTabUpdated(tabId, changeInfo, tab) {
  if (!isPracticumUrl(tab.url)) {
    return;
  }

  if (changeInfo.status === "loading") {
    runWithLoggedError("Не удалось запустить watchdog загрузки:", () => armLoadingWatchdog(tabId));
    return;
  }

  if (changeInfo.status !== "complete") {
    return;
  }

  log.info("Вкладка обновлена", { tabId, url: tab.url, status: changeInfo.status });
  runWithLoggedError("Ошибка автоматического цикла:", async () => {
    await clearLoadingWatchdog(tabId);
    await resetLoadingRecoveryCount(tabId);
    await processAutomationForTab(tabId, tab);
  });
}

function handleTabRemoved(tabId) {
  log.info("Вкладка закрыта, очищаю состояние", { tabId });
  runWithLoggedError("Не удалось очистить состояние вкладки:", async () => {
    await clearLoadingWatchdog(tabId);
    await clearAutomationState(tabId);
  });
}

async function runWithLoggedError(label, task) {
  try {
    await task();
  } catch (error) {
    log.error(label, {
      message: error?.message,
      stack: error?.stack
    });
  }
}

async function startAutomationOnActiveTab() {
  const tab = await getActivePracticumTab();
  const currentState = await getAutomationState(tab.id);

  if (currentState && !currentState.stopRequested) {
    log.info("Цикл уже запущен на активной вкладке", { tabId: tab.id, phase: currentState.phase });
    return getAutomationStatusForTab(tab.id, tab);
  }

  log.info("Запускаю автоматизацию на активной вкладке", { tabId: tab.id, url: tab.url });
  await setAutomationState(tab.id, createAutomationState({
    detailText: "Цикл запущен"
  }));
  void processAutomationForTab(tab.id, tab).catch((error) => {
    log.error("Фоновая обработка цикла завершилась ошибкой", {
      tabId: tab.id,
      message: error?.message,
      stack: error?.stack
    });
  });

  return getAutomationStatusForTab(tab.id, tab);
}

async function stopAutomationOnActiveTab() {
  const tab = await getActiveTab();

  if (!tab?.id || !tab.url || !isPracticumUrl(tab.url)) {
    throw new Error("Открой страницу Practicum с задачей");
  }

  const state = await getAutomationState(tab.id);

  if (!state) {
    log.info("Цикл уже остановлен", { tabId: tab.id });
    return getAutomationStatusForTab(tab.id, tab);
  }

  if (processingTabs.has(tab.id)) {
    await setAutomationState(tab.id, {
      ...state,
      stopRequested: true,
      detailText: "Остановка после текущего шага"
    });
    log.info("Запрошена остановка цикла после текущего шага", { tabId: tab.id, phase: state.phase });
    return getAutomationStatusForTab(tab.id, tab);
  }

  await clearAutomationState(tab.id);
  log.info("Цикл остановлен немедленно", { tabId: tab.id });
  return getAutomationStatusForTab(tab.id, tab);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id || !tab.url) {
    throw new Error("Не удалось найти активную вкладку");
  }

  return tab;
}

async function getActivePracticumTab() {
  const tab = await getActiveTab();

  if (!isPracticumUrl(tab.url)) {
    throw new Error("Открой страницу Practicum с задачей");
  }

  return tab;
}

async function getAutomationStatusForActiveTab() {
  const tab = await getActiveTab();
  return getAutomationStatusForTab(tab.id, tab);
}

async function getAutomationStatusForTab(tabId, knownTab) {
  const tab = knownTab?.id === tabId ? knownTab : await resolveTab(tabId, knownTab);
  const state = await getAutomationState(tabId);
  const isPracticum = isPracticumUrl(tab?.url);
  const isRunning = Boolean(state);
  const isStopping = Boolean(state?.stopRequested);

  return {
    tabId,
    isPracticum,
    canStart: isPracticum,
    isRunning,
    isStopping,
    isBusy: processingTabs.has(tabId),
    phase: state?.phase || null,
    detailText: state?.detailText || "",
    lastSolveReport: state?.lastSolveReport || null,
    buttonLabel: getStatusButtonLabel({ isPracticum, isRunning, isStopping }),
    statusText: getStatusText({ isPracticum, isRunning, isStopping, phase: state?.phase })
  };
}

function getLoadingWatchdogAlarmName(tabId) {
  return `${LOADING_WATCHDOG_ALARM_PREFIX}${tabId}`;
}

async function armLoadingWatchdog(tabId) {
  const state = await getAutomationState(tabId);

  if (!state || state.stopRequested) {
    return;
  }

  const delayInMinutes = Math.max(PAGE_AUTOMATION_RULES.loadingWatchdogDelayMs / 60000, 0.5);
  await chrome.alarms.clear(getLoadingWatchdogAlarmName(tabId));
  await chrome.alarms.create(getLoadingWatchdogAlarmName(tabId), { delayInMinutes });
  log.info("Запускаю watchdog долгой загрузки", {
    tabId,
    delayMs: PAGE_AUTOMATION_RULES.loadingWatchdogDelayMs,
    recoveryCount: state.loadingRecoveryCount || 0
  });
}

async function clearLoadingWatchdog(tabId) {
  await chrome.alarms.clear(getLoadingWatchdogAlarmName(tabId));
}

async function resetLoadingRecoveryCount(tabId) {
  const state = await getAutomationState(tabId);

  if (!state || !state.loadingRecoveryCount) {
    return;
  }

  await setAutomationState(tabId, {
    ...state,
    loadingRecoveryCount: 0,
    detailText: state.detailText || "Загрузка восстановилась"
  });
  log.info("Сбрасываю счётчик восстановлений после успешной загрузки", { tabId });
}

async function handleLoadingWatchdogAlarm(tabId) {
  const state = await getAutomationState(tabId);

  if (!state) {
    await clearLoadingWatchdog(tabId);
    return;
  }

  const tab = await resolveTab(tabId).catch(() => null);

  if (!tab?.url || !isPracticumUrl(tab.url)) {
    await clearLoadingWatchdog(tabId);
    return;
  }

  const nextRecoveryCount = (state.loadingRecoveryCount || 0) + 1;

  if (nextRecoveryCount > PAGE_AUTOMATION_RULES.loadingWatchdogMaxReloads) {
    log.error("Долгая загрузка не восстановилась после лимита перезагрузок", {
      tabId,
      url: tab.url,
      maxReloads: PAGE_AUTOMATION_RULES.loadingWatchdogMaxReloads
    });
    await clearLoadingWatchdog(tabId);
    await clearAutomationState(tabId);
    return;
  }

  await setAutomationState(tabId, {
    ...state,
    loadingRecoveryCount: nextRecoveryCount,
    detailText: `Страница долго грузится, делаю reload (${nextRecoveryCount}/${PAGE_AUTOMATION_RULES.loadingWatchdogMaxReloads})`
  });
  log.warn("Страница грузится слишком долго, перезагружаю вкладку", {
    tabId,
    url: tab.url,
    recoveryAttempt: nextRecoveryCount,
    maxReloads: PAGE_AUTOMATION_RULES.loadingWatchdogMaxReloads
  });
  await chrome.tabs.reload(tabId);
}

async function processAutomationForTab(tabId, knownTab) {
  if (processingTabs.has(tabId)) {
    log.info("Пропускаю обработку, вкладка уже в работе", { tabId });
    return;
  }

  processingTabs.add(tabId);

  try {
    const state = await ensureAutomationCanContinue(tabId, "before-processing");

    if (!state) {
      log.info("Состояние автоматизации не найдено", { tabId });
      return;
    }

    const tab = await resolveTab(tabId, knownTab);
    log.info("Обрабатываю вкладку", {
      tabId,
      url: tab?.url,
      phase: state.phase,
      lastSolvedTaskId: state.lastSolvedTaskId,
      allowSameTaskId: state.allowSameTaskId
    });

    if (!isPracticumUrl(tab?.url)) {
      log.warn("URL больше не относится к Practicum, очищаю состояние", { tabId, url: tab?.url });
      await clearAutomationState(tabId);
      return;
    }

    if (shouldAdvanceBeforeSolving(state, tab.url)) {
      log.info("Текущая страница не задача, пытаюсь перейти дальше", { tabId, url: tab.url });
      await advanceToNextRelevantPage(tabId);
      return;
    }

    if (shouldResumeSolvingAfterAdvance(state, tab.url)) {
      const currentTaskId = extractTaskIdFromUrl(tab.url);
      log.info("После перехода уже открыта новая задача, переключаюсь на решение", {
        tabId,
        url: tab.url,
        currentTaskId,
        lastSolvedTaskId: state.lastSolvedTaskId
      });
      await setAutomationState(
        tabId,
        createAutomationState({
          phase: AUTOMATION_PHASES.solving,
          lastSolvedTaskId: state.lastSolvedTaskId,
          allowSameTaskId: false,
          stopRequested: state.stopRequested,
          detailText: "Новая задача уже открыта",
          lastSolveReport: state.lastSolveReport
        })
      );
      await solveCurrentTask(tabId);
      return;
    }

    if (state.phase === AUTOMATION_PHASES.solving) {
      await solveCurrentTask(tabId);
      return;
    }

    if (state.phase === AUTOMATION_PHASES.awaitingNext) {
      await advanceToNextRelevantPage(tabId);
      return;
    }

    await clearAutomationState(tabId);
  } finally {
    log.info("Освобождаю вкладку после обработки", { tabId });
    processingTabs.delete(tabId);
  }
}

function shouldAdvanceBeforeSolving(state, url) {
  return state.phase === AUTOMATION_PHASES.solving && !extractTaskIdFromUrl(url);
}

function shouldResumeSolvingAfterAdvance(state, url) {
  if (state.phase !== AUTOMATION_PHASES.awaitingNext) {
    return false;
  }

  const currentTaskId = extractTaskIdFromUrl(url);
  return Boolean(currentTaskId && currentTaskId !== state.lastSolvedTaskId);
}

async function resolveTab(tabId, knownTab) {
  if (knownTab?.id === tabId) {
    return knownTab;
  }

  return chrome.tabs.get(tabId);
}

async function solveCurrentTask(tabId) {
  const currentState = await ensureAutomationCanContinue(tabId, "before-solve");

  if (!currentState) {
    return;
  }

  if (PAGE_AUTOMATION_RULES.preSolveDelayMs > 0) {
    await updateAutomationState(tabId, {
      detailText: "Жду стабилизацию страницы перед решением"
    });
    log.info("Жду стабилизацию страницы перед решением", {
      tabId,
      delayMs: PAGE_AUTOMATION_RULES.preSolveDelayMs
    });
    await wait(PAGE_AUTOMATION_RULES.preSolveDelayMs);

    if (!await ensureAutomationCanContinue(tabId, "after-pre-solve-delay")) {
      return;
    }
  }

  await updateAutomationState(tabId, {
    detailText: "Решаю текущую задачу"
  });
  log.info("Пытаюсь решить текущую задачу", {
    tabId,
    lastSolvedTaskId: currentState.lastSolvedTaskId,
    allowSameTaskId: currentState.allowSameTaskId
  });
  const result = await executeMainWorldScript(tabId, submitSolutionsInPage, [
    currentState.lastSolvedTaskId,
    Boolean(currentState.allowSameTaskId),
    PAGE_AUTOMATION_RULES
  ]);

  if (!await ensureAutomationCanContinue(tabId, "after-solve")) {
    return;
  }

  if (!result?.success) {
    log.error("Решение задачи завершилось ошибкой", { tabId, result });
    await clearAutomationState(tabId);
    throw new Error(result?.error || "Не удалось отправить решения");
  }

  log.info("Задача решена, перезагружаю вкладку", { tabId, taskId: result.taskId });
  const lastSolveReport = createLastSolveReport(result.taskId, result.results);
  await setAutomationState(
    tabId,
    createAutomationState({
      phase: AUTOMATION_PHASES.awaitingNext,
      lastSolvedTaskId: result.taskId,
      allowSameTaskId: false,
      detailText: "Жду перед перезагрузкой вкладки",
      lastSolveReport
    })
  );

  if (PAGE_AUTOMATION_RULES.preReloadDelayMs > 0) {
    log.info("Жду перед перезагрузкой вкладки", {
      tabId,
      delayMs: PAGE_AUTOMATION_RULES.preReloadDelayMs
    });
    await wait(PAGE_AUTOMATION_RULES.preReloadDelayMs);

    if (!await ensureAutomationCanContinue(tabId, "after-pre-reload-delay")) {
      return;
    }
  }

  await chrome.tabs.reload(tabId);
}

async function advanceToNextRelevantPage(tabId) {
  try {
    const currentState = await ensureAutomationCanContinue(tabId, "before-advance");

    if (!currentState) {
      return;
    }

    log.info("Пытаюсь перейти к следующему релевантному экрану", {
      tabId,
      lastSolvedTaskId: currentState.lastSolvedTaskId
    });
    await updateAutomationState(tabId, {
      detailText: "Ищу следующий экран"
    });
    const result = await executeMainWorldScript(tabId, advanceThroughPageInPage, [
      currentState.lastSolvedTaskId,
      PAGE_AUTOMATION_RULES
    ]);

    if (!await ensureAutomationCanContinue(tabId, "after-advance")) {
      return;
    }

    if (result === null) {
      const tab = await resolveTab(tabId);
      const currentTaskId = extractTaskIdFromUrl(tab?.url);

      if (currentTaskId && currentTaskId !== currentState.lastSolvedTaskId) {
        log.info("Переход завершился без ответа скрипта, но новая задача уже открыта", {
          tabId,
          url: tab?.url,
          currentTaskId,
          lastSolvedTaskId: currentState.lastSolvedTaskId
        });
        await setAutomationState(
          tabId,
          createAutomationState({
            phase: AUTOMATION_PHASES.solving,
            lastSolvedTaskId: currentState.lastSolvedTaskId,
            allowSameTaskId: false,
            stopRequested: currentState.stopRequested,
            detailText: "Новая задача уже открыта",
            lastSolveReport: currentState.lastSolveReport
          })
        );
        await solveCurrentTask(tabId);
        return;
      }

      if (isPracticumUrl(tab?.url)) {
        log.warn("Скрипт перехода вернул null во время навигации, сохраняю состояние до следующего обновления вкладки", {
          tabId,
          url: tab?.url,
          phase: currentState.phase,
          lastSolvedTaskId: currentState.lastSolvedTaskId
        });
        return;
      }
    }

    if (!result?.success) {
      log.warn("Автоцикл завершён без перехода", { tabId, result });
      await clearAutomationState(tabId);
      console.info("Авто-цикл завершен:", result?.error || "кнопка перехода не найдена");
      return;
    }

    log.info("Переход выполнен", { tabId, reason: result.reason, taskId: result.taskId });
    const nextState = createAutomationState({
      phase: AUTOMATION_PHASES.solving,
      lastSolvedTaskId: currentState.lastSolvedTaskId,
      allowSameTaskId: result.reason === "check-button-found",
      detailText: "Следующий экран найден",
      lastSolveReport: currentState.lastSolveReport
    });

    await setAutomationState(tabId, nextState);
    await solveCurrentTask(tabId);
  } catch (error) {
    log.error("Ошибка при переходе к следующему экрану", { tabId, error: error.message });
    await clearAutomationState(tabId);
    throw error;
  }
}

async function executeMainWorldScript(tabId, func, args) {
  log.info("Инжектирую скрипт в MAIN world", { tabId, functionName: func.name });
  const executionResults = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
    world: "MAIN"
  });

  const result = executionResults?.[0]?.result ?? null;
  if (Array.isArray(result?.logs) && result.logs.length > 0) {
    queueLogEntries(result.logs);
  }

  log.info("Скрипт вернул результат", {
    tabId,
    functionName: func.name,
    result: summarizeScriptResult(result)
  });
  return result;
}

function summarizeScriptResult(result) {
  if (!result || typeof result !== "object") {
    return result;
  }

  const { logs, ...rest } = result;

  return {
    ...rest,
    logCount: Array.isArray(logs) ? logs.length : 0
  };
}

function wait(timeoutMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}

async function ensureAutomationCanContinue(tabId, reason) {
  const state = await getAutomationState(tabId);

  if (!state) {
    return null;
  }

  if (!state.stopRequested) {
    return state;
  }

  log.info("Остановка цикла подтверждена", { tabId, reason, phase: state.phase });
  await clearAutomationState(tabId);
  return null;
}

async function updateAutomationState(tabId, patch) {
  const state = await getAutomationState(tabId);

  if (!state) {
    return null;
  }

  const nextState = {
    ...state,
    ...patch
  };

  await setAutomationState(tabId, nextState);
  return nextState;
}

function createLastSolveReport(taskId, results) {
  const normalizedResults = Array.isArray(results) ? results : [];

  return {
    taskId,
    successCount: normalizedResults.filter((result) => result?.ok).length,
    requestCount: normalizedResults.length,
    statuses: normalizedResults.map((result) => result?.status ?? "ERR"),
    updatedAt: Date.now()
  };
}

function getStatusButtonLabel({ isPracticum, isRunning, isStopping }) {
  if (!isPracticum) {
    return "Открой Practicum";
  }

  if (isStopping) {
    return "Останавливается...";
  }

  return isRunning ? "Остановить цикл" : "Запустить цикл";
}

function getStatusText({ isPracticum, isRunning, isStopping, phase }) {
  if (!isPracticum) {
    return "Открой страницу Practicum";
  }

  if (!isRunning) {
    return "Цикл выключен";
  }

  if (isStopping) {
    return "Остановка после текущего шага";
  }

  if (phase === AUTOMATION_PHASES.awaitingNext) {
    return "Жду следующий экран";
  }

  return "Цикл запущен";
}

function respondWithTask(sendResponse, task, errorLabel) {
  task()
    .then((status) => sendResponse({ ok: true, status }))
    .catch((error) => {
      log.error(errorLabel, {
        message: error?.message,
        stack: error?.stack
      });
      sendResponse({ ok: false, error: error?.message || errorLabel });
    });
}
