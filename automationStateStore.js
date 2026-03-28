import { AUTOMATION_STATE_KEY } from "./config.js";

function toTabKey(tabId) {
  return String(tabId);
}

async function readAutomationStates() {
  const data = await chrome.storage.session.get(AUTOMATION_STATE_KEY);
  return data[AUTOMATION_STATE_KEY] || {};
}

async function writeAutomationStates(states) {
  await chrome.storage.session.set({
    [AUTOMATION_STATE_KEY]: states
  });
}

export async function getAutomationState(tabId) {
  const states = await readAutomationStates();
  return states[toTabKey(tabId)] || null;
}

export async function setAutomationState(tabId, state) {
  const states = await readAutomationStates();
  states[toTabKey(tabId)] = state;
  await writeAutomationStates(states);
}

export async function clearAutomationState(tabId) {
  const states = await readAutomationStates();
  const key = toTabKey(tabId);

  if (!(key in states)) {
    return;
  }

  delete states[key];
  await writeAutomationStates(states);
}
