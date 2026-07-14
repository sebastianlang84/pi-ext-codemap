import { useState } from "react";

interface Settings {
  currency: string;
  unitSystem: "metric" | "imperial";
}

export function ConfigPanel({ initial }: { initial: Settings }) {
  const [settings, setSettings] = useState<Settings>(initial);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <section>
      <h2>Config</h2>
      <label>
        Currency
        <input value={settings.currency} onChange={(e) => update("currency", e.target.value)} />
      </label>
    </section>
  );
}
