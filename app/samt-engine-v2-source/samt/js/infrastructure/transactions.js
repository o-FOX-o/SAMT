import { deepClone } from "../shared/validation.js";

export async function runLogicalTransaction({ state, mutate, validate, commit }) {
  const previous = deepClone(state);
  const candidate = deepClone(state);
  const value = await mutate(candidate);
  validate(candidate);
  await commit(candidate, previous);
  return { state: candidate, value };
}
