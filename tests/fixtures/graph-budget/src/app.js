import { add } from "./core/math.js";
import { formatTotal } from "./core/format.js";

export function renderBudgetTotal(a, b) {
  return formatTotal(add(a, b));
}
