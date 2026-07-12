"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain, Zap, Clock, CheckCircle2, XCircle, Loader2, Send, Lightbulb, Server, Settings, Key } from "lucide-react";

interface LlmStatus {
  configured: boolean;
  provider: string;
  model: string;
  baseUrl: string;
}

interface TestResult {
  success: boolean;
  response?: string;
  error?: string;
  durationMs: number;
  tokenEstimate?: number;
}

const QUICK_PROMPTS = [
  { label: "Training week summary", prompt: "Summarize a training week: 62km running, 1800m elevation, 5h 23min across 6 sessions. The athlete has a 100km trail race in 12 weeks. What should they focus on?" },
  { label: "Fatigue assessment", prompt: "An athlete reports feeling tired, with resting HR 5 bpm above baseline, and training monotony at 0.82. Their TSB is -15. What's your assessment and recommendation?" },
  { label: "Simple test", prompt: "In one sentence, what is the most important principle of endurance training?" },
];

export default function LlmTestPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null);
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/auth/signin");
    else if (status === "authenticated") {
      fetch("/api/llm-test")
        .then((r) => r.json())
        .then(setLlmStatus);
    }
  }, [status, router]);

  async function runTest(testPrompt?: string) {
    const p = testPrompt || prompt;
    if (!p.trim()) return;
    setTesting(true);
    setResult(null);
    setError(null);
    const start = Date.now();
    try {
      const res = await fetch("/api/llm-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: p }),
      });
      const data = await res.json();
      setResult(data);
    } catch {
      setError("Network error — is the server running?");
    } finally {
      setTesting(false);
    }
  }

  if (status === "loading") return <div className="container mx-auto px-4 py-8">Loading...</div>;

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <h1 className="text-3xl font-bold mb-2">LLM Connection Test</h1>
      <p className="text-muted-foreground mb-8">Verify that the configured LLM is reachable and responding correctly</p>

      {/* Status Card */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Server className="h-5 w-5" /> Connection Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!llmStatus ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading status...
            </div>
          ) : !llmStatus.configured ? (
            <div className="text-center py-6 space-y-4">
              <div className="flex justify-center">
                <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                  <Key className="h-6 w-6 text-muted-foreground" />
                </div>
              </div>
              <div>
                <p className="font-medium mb-1">No AI Provider Configured</p>
                <p className="text-sm text-muted-foreground mb-4">
                  You need to set up your own API key to use AI coaching features.
                </p>
                <Link href="/settings/credentials">
                  <Button variant="default" size="sm">
                    <Settings className="h-4 w-4 mr-2" /> Configure in Settings
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4 text-sm">
              <div className="flex items-center justify-between p-2 rounded bg-muted">
                <span className="text-muted-foreground">Provider</span>
                <Badge variant="outline">{llmStatus.provider || "—"}</Badge>
              </div>
              <div className="flex items-center justify-between p-2 rounded bg-muted">
                <span className="text-muted-foreground">Model</span>
                <Badge variant="outline">{llmStatus.model || "—"}</Badge>
              </div>
              <div className="flex items-center justify-between p-2 rounded bg-muted">
                <span className="text-muted-foreground">Base URL</span>
                <span className="font-mono text-xs truncate max-w-[200px]">{llmStatus.baseUrl || "—"}</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded bg-muted">
                <span className="text-muted-foreground">Configured</span>
                <Badge variant="success"><CheckCircle2 className="h-3 w-3 mr-1" /> Yes</Badge>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Prompts */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Lightbulb className="h-5 w-5" /> Quick Tests
          </CardTitle>
          <CardDescription>Click a prompt to test the LLM with a coaching-related query</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {QUICK_PROMPTS.map((qp, i) => (
              <Button
                key={i}
                variant="outline"
                size="sm"
                disabled={testing}
                onClick={() => {
                  setPrompt(qp.prompt);
                  runTest(qp.prompt);
                }}
              >
                <Zap className="h-3 w-3 mr-1" /> {qp.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Custom Prompt */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Brain className="h-5 w-5" /> Custom Prompt
          </CardTitle>
          <CardDescription>Write your own prompt to test the LLM</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Enter a test prompt..."
              onKeyDown={(e) => e.key === "Enter" && runTest()}
              disabled={testing}
            />
            <Button onClick={() => runTest()} disabled={testing || !prompt.trim()}>
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Result */}
      {(testing || result || error) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              {testing ? (
                <><Loader2 className="h-5 w-5 animate-spin" /> Testing...</>
              ) : result?.success ? (
                <><CheckCircle2 className="h-5 w-5 text-green-500" /> Response</>
              ) : (
                <><XCircle className="h-5 w-5 text-destructive" /> Failed</>
              )}
            </CardTitle>
            {result && !testing && (
              <CardDescription>
                <span className="flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {result.durationMs}ms</span>
                  {result.tokenEstimate && (
                    <span className="flex items-center gap-1"><Zap className="h-3 w-3" /> ~{result.tokenEstimate} tokens</span>
                  )}
                  {result.durationMs > 0 && result.tokenEstimate && (
                    <span className="text-muted-foreground">
                      ~{Math.round(result.tokenEstimate / (result.durationMs / 1000))} tok/s
                    </span>
                  )}
                </span>
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {testing ? (
              <div className="flex items-center gap-3 py-8 justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Waiting for LLM response... this can take 15-60s with local models</span>
              </div>
            ) : error ? (
              <div className="p-4 rounded-md bg-destructive/10 text-destructive text-sm">{error}</div>
            ) : result?.error ? (
              <div className="p-4 rounded-md bg-destructive/10 text-destructive text-sm">
                <p className="font-medium mb-1">Error</p>
                {result.error}
                {llmStatus?.provider === "ollama" && (
                  <p className="mt-3 text-muted-foreground">
                    <strong>Troubleshooting:</strong><br />
                    • Is the Ollama container running? Run <code className="bg-muted px-1 rounded">docker ps | grep ollama</code><br />
                    • Is the model pulled? Run <code className="bg-muted px-1 rounded">docker compose exec ollama ollama list</code><br />
                    • Pull the model: <code className="bg-muted px-1 rounded">docker compose exec ollama ollama pull {llmStatus.model}</code>
                  </p>
                )}
              </div>
            ) : result?.response ? (
              <div className="p-4 rounded-md bg-muted text-sm whitespace-pre-wrap leading-relaxed">
                {result.response}
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
