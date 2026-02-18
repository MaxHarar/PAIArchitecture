"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface ServiceHealth {
  name: string;
  status: "healthy" | "unhealthy" | "unknown";
  latency?: number;
  message?: string;
}

interface HealthResponse {
  overall: "healthy" | "degraded" | "unhealthy";
  services: ServiceHealth[];
  timestamp: string;
}

const STATUS_STYLES = {
  healthy: {
    badge: "success" as const,
    dot: "bg-green-400",
    text: "text-green-400",
  },
  degraded: {
    badge: "warning" as const,
    dot: "bg-yellow-400",
    text: "text-yellow-400",
  },
  unhealthy: {
    badge: "error" as const,
    dot: "bg-red-400",
    text: "text-red-400",
  },
  unknown: {
    badge: "warning" as const,
    dot: "bg-yellow-400",
    text: "text-yellow-400",
  },
};

export function HealthPanel() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = async () => {
    try {
      const res = await fetch("/api/health");
      if (!res.ok) throw new Error("Failed to fetch health status");
      const data = await res.json();
      setHealth(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/3"></div>
          <div className="h-24 bg-muted rounded"></div>
          <div className="h-24 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Card className="border-red-500/30 bg-red-500/10">
          <CardContent className="pt-4">
            <p className="text-red-400">Error: {error}</p>
            <button
              onClick={fetchHealth}
              className="mt-2 text-sm text-pai-400 hover:underline"
            >
              Retry
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Overall Status */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">System Health</h2>
        <Badge variant={STATUS_STYLES[health?.overall || "unknown"].badge}>
          <span className={`w-2 h-2 rounded-full mr-1.5 ${STATUS_STYLES[health?.overall || "unknown"].dot}`} />
          {health?.overall || "unknown"}
        </Badge>
      </div>

      {/* Services */}
      <div className="space-y-3">
        {health?.services.map((service) => {
          const styles = STATUS_STYLES[service.status];
          return (
            <Card key={service.name}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${styles.dot}`} />
                    <CardTitle className="text-sm">{service.name}</CardTitle>
                  </div>
                  <Badge variant={styles.badge} className="text-xs">
                    {service.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{service.message || "No details"}</span>
                  {service.latency !== undefined && (
                    <span>{service.latency}ms</span>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Last Updated */}
      {health?.timestamp && (
        <p className="text-xs text-muted-foreground text-center">
          Last updated: {new Date(health.timestamp).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
