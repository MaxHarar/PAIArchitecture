"use client";

import { Component, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <Card className="border-red-500/30 bg-red-500/10 m-4">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-2xl">⚠️</span>
              <h3 className="font-semibold text-red-400">Something went wrong</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              An error occurred while rendering this component.
            </p>
            {this.state.error && (
              <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-32">
                {this.state.error.message}
              </pre>
            )}
            <button
              onClick={() => this.setState({ hasError: false, error: undefined })}
              className="mt-3 px-3 py-1 bg-pai-500 hover:bg-pai-600 text-white rounded text-sm"
            >
              Try Again
            </button>
          </CardContent>
        </Card>
      );
    }

    return this.props.children;
  }
}
