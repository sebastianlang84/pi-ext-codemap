export class NavigationEngine {
  answer(question: string) {
    return `navigation answer for ${question}`;
  }
}

export function createNavigationEngine() {
  return new NavigationEngine();
}
