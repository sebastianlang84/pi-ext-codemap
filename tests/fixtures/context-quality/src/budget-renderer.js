import appConfig from "../config/app.config.json";
import { formatBudget } from "./core/format.js";
import { addBudget } from "./core/math.js";

export function renderBudget(items) {
  const total = items.reduce((sum, item) => addBudget(sum, item.amount), 0);
  return formatBudget(total, appConfig.currency);
}
