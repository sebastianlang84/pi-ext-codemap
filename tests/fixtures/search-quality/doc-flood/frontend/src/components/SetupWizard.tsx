import { useState } from "react";

interface SetupStep {
  id: string;
  label: string;
}

const STEPS: SetupStep[] = [
  { id: "catalog", label: "Catalog" },
  { id: "units", label: "Units" },
  { id: "review", label: "Review" },
];

export function SetupWizard({ onDone }: { onDone: () => void }) {
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex];

  function next() {
    if (stepIndex === STEPS.length - 1) onDone();
    else setStepIndex((index) => index + 1);
  }

  return (
    <form>
      <h2>Setup — {step.label}</h2>
      <button type="button" onClick={next}>
        Next
      </button>
    </form>
  );
}
