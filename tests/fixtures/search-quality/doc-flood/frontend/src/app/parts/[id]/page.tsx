import { useState } from "react";
import { Card, CardTitle, CardContent } from "@/components/ui/card";
import { PartStockControl } from "@/components/PartStockControl";

interface Part {
  id: string;
  mpn: string;
  description: string;
  storageLocation?: { name: string };
}

function PartDetailContent({ part }: { part: Part }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [stock, setStock] = useState({ onHand: 0, reserved: 0, available: 0 });

  return (
    <div>
      <nav>
        <button onClick={() => setActiveTab("overview")}>Overview</button>
        <button onClick={() => setActiveTab("history")}>History</button>
      </nav>

      {/* Overview tab: Stock / Identity / Location cards */}
      {activeTab === "overview" && (
        <div className="grid">
          <Card>
            <CardTitle>Stock</CardTitle>
            <CardContent>
              <PartStockControl partId={part.id} stock={stock} onCompleted={setStock} />
            </CardContent>
          </Card>
          <Card>
            <CardTitle>Identity</CardTitle>
            <CardContent>
              <dl>
                <dt>MPN</dt>
                <dd>{part.mpn}</dd>
                <dt>Description</dt>
                <dd>{part.description}</dd>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardTitle>Location</CardTitle>
            <CardContent>{part.storageLocation?.name ?? "—"}</CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function PartDetailPage({ part }: { part: Part }) {
  return <PartDetailContent part={part} />;
}
