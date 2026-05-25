import { renderBudget } from "../src/budget-renderer.js";

export function testRenderBudget() {
  return renderBudget([{ amount: 2 }, { amount: 3 }]);
}
