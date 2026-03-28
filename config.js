export const PRACTICUM_URL_PREFIX = "https://practicum.yandex.ru/";
export const AUTOMATION_STATE_KEY = "automationStates";

export const COMMANDS = Object.freeze({
  runSolver: "send-solutions"
});

export const MESSAGE_TYPES = Object.freeze({
  runSolver: "run-solver",
  stopSolver: "stop-solver",
  getStatus: "get-status"
});

export const LOCAL_LOG_SERVER = Object.freeze({
  enabled: true,
  endpoint: "http://127.0.0.1:8787/log",
  source: "task-solver-extension"
});

export const AUTOMATION_PHASES = Object.freeze({
  solving: "solving",
  awaitingNext: "awaiting-next"
});

const TASK_ID_PATTERN = /\/task\/([a-f0-9-]+)/i;

export const PAGE_AUTOMATION_RULES = Object.freeze({
  debug: true,
  requestCount: 3,
  requestSpacingMs: 125,
  requestPathTemplate: "/api/tasks/{taskId}/solutions/",
  requestBody: Object.freeze({ panes: [], solved: true }),
  preSolveDelayMs: 450,
  preReloadDelayMs: 325,
  preClickDelayMs: 75,
  postClickWaitMs: 600,
  domMutationWaitMs: 600,
  continueTimeoutMs: 45000,
  duplicateClickCooldownMs: 800,
  blockedContinueSelectors: Object.freeze([
    "button[data-test-id='review-status-body__button']",
    "[data-test-id='review-status-body__button']",
    "[data-test-id='review-status-body__button-content']",
    "button.review-status-body__button",
    ".review-status-body__button"
  ]),
  exactContinueTexts: Object.freeze([
    "далее",
    "спасибо за подсказку!"
  ]),
  continueTextPrefixes: Object.freeze([
    "следующий урок",
    "к следующему уроку",
    "к следующей теме",
    "перейти к заданию"
  ]),
  standardContinueSelectors: Object.freeze([
    "button[data-test-id='next-task-button']",
    "[data-test-id='next-task-button']",
    "[data-test-id='next-task-button-content']",
    "button[data-test-id='next-lesson-control-button']",
    "[data-test-id='next-lesson-control-button']",
    "[data-test-id='next-lesson-control-button-content']",
    "button.trainer-footer__solution-button",
    ".trainer-footer__solution-button",
    "button.next-lesson-control__button",
    ".next-lesson-control__button"
  ]),
  theoryActionSelectors: Object.freeze([
    "button[data-test-id^='theory-action-button-'].content-expander__button",
    "button[data-test-id^='theory-action-button-']",
    "[data-test-id^='theory-action-button-']"
  ]),
  genericSingleChoiceSelectors: Object.freeze([
    "button.content-expander__button.button2_type_primary",
    "button.content-expander__button"
  ]),
  checkSelectors: Object.freeze([
    "button[data-test-id='check-task-button']",
    "[data-test-id='check-task-button']",
    "[data-test-id='check-task-button-content']",
    "button.trainer-footer__check-button",
    ".trainer-footer__check-button"
  ])
});

export function isPracticumUrl(url) {
  return typeof url === "string" && url.startsWith(PRACTICUM_URL_PREFIX);
}

export function extractTaskIdFromUrl(url) {
  const match = url?.match(TASK_ID_PATTERN);
  return match ? match[1] : null;
}

export function createAutomationState(overrides = {}) {
  return {
    phase: AUTOMATION_PHASES.solving,
    lastSolvedTaskId: null,
    allowSameTaskId: false,
    stopRequested: false,
    ...overrides
  };
}
