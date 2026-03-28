export async function submitSolutionsInPage(previousTaskId, allowSameTaskId, rules) {
  const entries = [];
  // executeScript serializes only this function body, so page helpers stay local.
  const log = (message, details = undefined, level = "info") => {
    entries.push({
      timestamp: new Date().toISOString(),
      origin: "page",
      scope: "submit",
      level,
      message,
      details: details ?? null
    });

    if (!rules?.debug) {
      return;
    }

    if (details === undefined) {
      console.info("[TaskSolver:submit]", message);
      return;
    }

    console.info("[TaskSolver:submit]", message, details);
  };

  function withLogs(payload) {
    return {
      ...payload,
      logs: entries
    };
  }

  try {
    function extractTaskId(url) {
      const match = url?.match(/\/task\/([a-f0-9-]+)/i);
      return match ? match[1] : null;
    }

    function wait(timeoutMs) {
      return new Promise((resolve) => {
        window.setTimeout(() => {
          resolve();
        }, timeoutMs);
      });
    }

    async function sendRequest(taskId) {
      try {
        const response = await fetch(rules.requestPathTemplate.replace("{taskId}", taskId), {
          method: "POST",
          credentials: "include",
          mode: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rules.requestBody)
        });

        const responseText = await response.text();
        let responseData = null;

        try {
          responseData = responseText ? JSON.parse(responseText) : null;
        } catch (_error) {
          responseData = responseText || null;
        }

        return {
          ok: response.ok,
          status: response.status,
          data: responseData
        };
      } catch (error) {
        return {
          ok: false,
          status: null,
          error: error.message
        };
      }
    }

    const taskId = extractTaskId(window.location.href);
    log("Начинаю отправку решений", {
      url: window.location.href,
      previousTaskId,
      allowSameTaskId,
      taskId
    });

    if (!taskId) {
      log("Не найден task_id в URL", { url: window.location.href });
      return withLogs({ success: false, error: "Не удалось найти task_id в URL" });
    }

    if (previousTaskId && previousTaskId === taskId && !allowSameTaskId) {
      log("Следующая задача не загрузилась", { previousTaskId, taskId });
      return withLogs({
        success: false,
        error: "Следующая задача не загрузилась",
        taskId
      });
    }

    const results = [];

    for (let index = 0; index < rules.requestCount; index += 1) {
      if (index > 0 && rules.requestSpacingMs > 0) {
        await wait(rules.requestSpacingMs);
      }

      results.push(await sendRequest(taskId));
    }

    console.log("Все запросы выполнены:", results);
    log("Запросы завершены", { taskId, results });

    if (results.some((result) => result.status !== null)) {
      return withLogs({ success: true, taskId, results });
    }

    const networkErrors = results
      .map((result) => result.error)
      .filter(Boolean)
      .join("; ");

    return withLogs({
      success: false,
      error: networkErrors || "Не удалось отправить запросы",
      taskId,
      results
    });
  } catch (error) {
    log("Неожиданная ошибка в submitSolutionsInPage", {
      message: error?.message,
      stack: error?.stack
    }, "error");
    return withLogs({
      success: false,
      error: error?.message || "Неизвестная ошибка при отправке решений"
    });
  }
}

export async function advanceThroughPageInPage(previousTaskId, rules) {
  const entries = [];
  const THEORY_ACTIONS_EXHAUSTED = Symbol("theory-actions-exhausted");
  // executeScript serializes only this function body, so page helpers stay local.
  const log = (message, details = undefined, level = "info") => {
    entries.push({
      timestamp: new Date().toISOString(),
      origin: "page",
      scope: "navigate",
      level,
      message,
      details: details ?? null
    });

    if (!rules?.debug) {
      return;
    }

    if (details === undefined) {
      console.info("[TaskSolver:navigate]", message);
      return;
    }

    console.info("[TaskSolver:navigate]", message, details);
  };

  function withLogs(payload) {
    return {
      ...payload,
      logs: entries
    };
  }

  try {
    function normalizeText(value) {
      return (value || "").replace(/\s+/g, " ").trim().toLowerCase();
    }

    function getElementText(element) {
      return normalizeText(
        element.textContent ||
        element.value ||
        element.getAttribute("aria-label") ||
        element.getAttribute("title")
      );
    }

    function describeElement(element) {
      if (!element) {
        return null;
      }

      return {
        text: getElementText(element),
        dataTestId: element.getAttribute("data-test-id"),
        className: element.className
      };
    }

    function getElementSignature(element) {
      return [
        element?.getAttribute("data-test-id") || "",
        element?.className || "",
        element?.textContent?.trim() || ""
      ].join("|");
    }

    function isAllowedContinueText(text) {
      const normalizedText = normalizeText(text);

      if (!normalizedText) {
        return false;
      }

      if (rules.exactContinueTexts.includes(normalizedText)) {
        return true;
      }

      return rules.continueTextPrefixes.some((prefix) => normalizedText.startsWith(prefix));
    }

    function isVisible(element) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    }

    function isBlockedElement(element) {
      return rules.blockedContinueSelectors.some((selector) => element.matches(selector));
    }

    function findMatchingElements(selectors, textMatcher = null) {
      const matches = [];
      const seen = new Set();

      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);

        for (const element of elements) {
          const clickableElement = element.closest("button, a, [role='button']") || element;

          if (
            !clickableElement ||
            clickableElement.disabled ||
            clickableElement.getAttribute("aria-disabled") === "true" ||
            !isVisible(clickableElement) ||
            isBlockedElement(clickableElement)
          ) {
            continue;
          }

          if (textMatcher && !textMatcher(getElementText(clickableElement))) {
            continue;
          }

          if (seen.has(clickableElement)) {
            continue;
          }

          seen.add(clickableElement);
          matches.push(clickableElement);
        }
      }

      return matches;
    }

    function findMatchingElement(selectors, textMatcher = null) {
      return findMatchingElements(selectors, textMatcher)[0] || null;
    }

    function findSingleTheoryActionElement(triedTheoryActionSignatures) {
      const exactMatches = findMatchingElements(rules.theoryActionSelectors);
      log("Проверяю диалоговые кнопки", {
        exactMatches: exactMatches.map(describeElement)
      });

      if (exactMatches.length === 1) {
        const singleMatch = exactMatches[0];

        if (triedTheoryActionSignatures.has(getElementSignature(singleMatch))) {
          log("Единственная диалоговая кнопка уже была нажата в этом проходе", {
            selected: describeElement(singleMatch)
          });
          return THEORY_ACTIONS_EXHAUSTED;
        }

        return singleMatch;
      }

      if (exactMatches.length > 1) {
        const prioritizedMatches = exactMatches
          .map((element, index) => ({
            element,
            score: getTheoryActionScore(getElementText(element)),
            signature: getElementSignature(element),
            index
          }))
          .filter(({ signature }) => !triedTheoryActionSignatures.has(signature))
          .sort((left, right) => right.score - left.score);
        const selectedMatch = prioritizedMatches[0];
        const nextMatch = prioritizedMatches[1];

        log("Найдено несколько диалоговых кнопок, оцениваю приоритет", {
          candidates: prioritizedMatches.map(({ element, score }) => ({
            ...describeElement(element),
            score
          }))
        });

        if (
          selectedMatch &&
          selectedMatch.score > 0 &&
          (!nextMatch || selectedMatch.score > nextMatch.score)
        ) {
          log("Выбрана приоритетная диалоговая кнопка", {
            selected: describeElement(selectedMatch.element),
            score: selectedMatch.score
          });
          return selectedMatch.element;
        }

        if (prioritizedMatches.length > 0) {
          const latestMatch = [...prioritizedMatches].sort((left, right) => right.index - left.index)[0];
          log("Приоритеты равны, выбираю самую новую диалоговую кнопку", {
            selected: describeElement(latestMatch.element),
            score: latestMatch.score
          });
          return latestMatch.element;
        }

        log("Все видимые диалоговые кнопки уже были испробованы", {
          exactMatches: exactMatches.map(describeElement)
        });
        return THEORY_ACTIONS_EXHAUSTED;
      }

      const fallbackMatches = findMatchingElements(rules.genericSingleChoiceSelectors || []);
      log("Проверяю fallback single-choice кнопки", {
        fallbackMatches: fallbackMatches.map(describeElement)
      });

      return fallbackMatches.length === 1 ? fallbackMatches[0] : null;
    }

    function findContinueTarget(triedTheoryActionSignatures) {
      const standardContinueElement = findMatchingElement(
        rules.standardContinueSelectors,
        isAllowedContinueText
      );

      if (standardContinueElement) {
        return {
          element: standardContinueElement,
          kind: "standard"
        };
      }

      const theoryActionElement = findSingleTheoryActionElement(triedTheoryActionSignatures);

      if (theoryActionElement === THEORY_ACTIONS_EXHAUSTED) {
        return {
          element: null,
          kind: "theory-exhausted"
        };
      }

      if (!theoryActionElement) {
        return null;
      }

      return {
        element: theoryActionElement,
        kind: "theory"
      };
    }

    function findCheckElement() {
      return findMatchingElement(rules.checkSelectors);
    }

    function getTaskIdFromUrl() {
      const match = window.location.href.match(/\/task\/([a-f0-9-]+)/i);
      return match ? match[1] : null;
    }

    function wait(timeoutMs) {
      return new Promise((resolve) => {
        window.setTimeout(() => {
          resolve();
        }, timeoutMs);
      });
    }

    function getTheoryActionScore(text) {
      const normalizedText = normalizeText(text);

      if (!normalizedText) {
        return 0;
      }

      if (normalizedText.includes("следующ")) {
        return 100;
      }

      if (normalizedText.includes("дальше")) {
        return 90;
      }

      if (normalizedText.includes("понятно")) {
        return 80;
      }

      if (normalizedText.includes("спасибо")) {
        return 70;
      }

      if (normalizedText.endsWith("?")) {
        return 0;
      }

      return 10;
    }

    function getReadyState(hasClickedContinue) {
      const currentTaskId = getTaskIdFromUrl();

      if (hasClickedContinue && currentTaskId && (!previousTaskId || currentTaskId !== previousTaskId)) {
        return {
          ready: true,
          taskId: currentTaskId,
          reason: previousTaskId ? "url-changed" : "task-page-found"
        };
      }

      if (hasClickedContinue && currentTaskId && findCheckElement()) {
        return {
          ready: true,
          taskId: currentTaskId,
          reason: "check-button-found"
        };
      }

      return null;
    }

    const deadline = Date.now() + rules.continueTimeoutMs;
    let hasClickedContinue = false;
    let lastClickedSignature = null;
    let lastClickAt = 0;
    const triedTheoryActionSignatures = new Set();

    log("Начинаю навигацию по странице", {
      previousTaskId,
      url: window.location.href
    });

    while (Date.now() < deadline) {
      const readyState = getReadyState(hasClickedContinue);

      if (readyState) {
        log("Найден готовый следующий шаг", readyState);
        return withLogs({
          success: true,
          taskId: readyState.taskId,
          reason: readyState.reason
        });
      }

      const continueTarget = findContinueTarget(triedTheoryActionSignatures);
      const continueButton = continueTarget?.element || null;

      if (continueTarget?.kind === "theory-exhausted") {
        log("Диалоговые кнопки исчерпаны, но новый шаг не появился");
        return withLogs({
          success: false,
          error: "Все видимые диалоговые кнопки уже нажаты, а следующий шаг не появился"
        });
      }

      if (!continueButton) {
        log("Подходящая кнопка продолжения не найдена, жду перед следующей проверкой");
        await wait(rules.domMutationWaitMs);
        continue;
      }

      const signature = getElementSignature(continueButton);

      if (
        signature === lastClickedSignature &&
        Date.now() - lastClickAt < rules.duplicateClickCooldownMs
      ) {
        log("Пропускаю повторный клик по той же кнопке", { signature });
        await wait(Math.max(100, rules.duplicateClickCooldownMs - (Date.now() - lastClickAt)));
        continue;
      }

      log("Кликаю по кнопке продолжения", {
        ...describeElement(continueButton),
        kind: continueTarget?.kind || "unknown"
      });
      continueButton.scrollIntoView({ block: "center", inline: "center" });

      if (rules.preClickDelayMs > 0) {
        await wait(rules.preClickDelayMs);
      }

      if (
        !continueButton.isConnected ||
        continueButton.disabled ||
        continueButton.getAttribute("aria-disabled") === "true" ||
        !isVisible(continueButton)
      ) {
        log("Кнопка продолжения исчезла или стала недоступна до клика", {
          signature
        });
        await wait(rules.domMutationWaitMs);
        continue;
      }

      continueButton.click();

      hasClickedContinue = true;
      lastClickedSignature = signature;
      lastClickAt = Date.now();

      if (continueTarget?.kind === "theory") {
        triedTheoryActionSignatures.add(signature);
      }

      await wait(rules.postClickWaitMs || rules.domMutationWaitMs);
    }

    log("Не удалось перейти к следующему шагу в пределах таймаута", {
      previousTaskId,
      url: window.location.href
    });
    return withLogs({
      success: false,
      error: "Не удалось перейти к следующему шагу или задаче"
    });
  } catch (error) {
    log("Неожиданная ошибка в advanceThroughPageInPage", {
      message: error?.message,
      stack: error?.stack
    }, "error");
    return withLogs({
      success: false,
      error: error?.message || "Неизвестная ошибка при навигации по странице"
    });
  }
}
