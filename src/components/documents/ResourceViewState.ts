/** Small session-only view state. No credentials or provider payloads. */
export interface ResourceViewState {
  slide?: number;
  sheet?: number;
  sheetPositions?: Record<string, { top: number; left: number; cell?: string }>;
  count?: number;
}
const states = new Map<string, ResourceViewState>();
export function resourceViewState(key: string): ResourceViewState {
  let state = states.get(key);
  if (!state) {
    state = {};
    if (states.size >= 100) states.delete(states.keys().next().value!);
    states.set(key, state);
  }
  return state;
}
const listeners = new WeakMap<ResourceViewState, Set<() => void>>();
export function notifyResourceViewState(state: ResourceViewState): void { listeners.get(state)?.forEach(listener => listener()); }
export function subscribeResourceViewState(state: ResourceViewState, listener: () => void): () => void {
  let group = listeners.get(state);
  if (!group) { group = new Set(); listeners.set(state, group); }
  group.add(listener);
  return () => { group.delete(listener); };
}
