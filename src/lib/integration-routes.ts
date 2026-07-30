/**
 * Shared integration route handler for Garmin and COROS providers.
 *
 * Consolidates 10 route files (5 per provider) into a single dynamic route:
 *   /api/integrations/[provider]/[action]
 *
 * Supported providers: garmin, coros
 * Supported actions: connect, disconnect, reset-sync, status, sync
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  connectGarmin,
  disconnectGarmin,
  getGarminClient,
  syncGarminActivities,
  syncGarminHealthData,
  GarminMFARequiredError,
} from "@/lib/garmin";
import {
  connectCoros,
  disconnectCoros,
  getCorosClient,
  syncCorosActivities,
} from "@/lib/coros";
import { scheduleBatchAnalysis } from "@/lib/activity-analysis-queue";

type Provider = "garmin" | "coros";
type Action = "connect" | "disconnect" | "reset-sync" | "status" | "sync";

const VALID_PROVIDERS: Provider[] = ["garmin", "coros"];
const VALID_ACTIONS: Action[] = [
  "connect",
  "disconnect",
  "reset-sync",
  "status",
  "sync",
];

function isValidProvider(p: string): p is Provider {
  return VALID_PROVIDERS.includes(p as Provider);
}

function isValidAction(a: string): a is Action {
  return VALID_ACTIONS.includes(a as Action);
}

// ─── Dispatch ───────────────────────────────────────────────────────

async function handleConnect(
  provider: Provider,
  req: Request,
  userId: string
): Promise<NextResponse> {
  try {
    const { email, password, mfaCode } = await req.json();
    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    if (provider === "garmin") {
      await connectGarmin(userId, email, password, mfaCode);
    } else {
      await connectCoros(userId, email, password);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const providerLabel = provider === "garmin" ? "Garmin" : "COROS";

    // Garmin MFA
    if (provider === "garmin" && err instanceof GarminMFARequiredError) {
      return NextResponse.json(
        { mfaRequired: true, error: "MFA code required" },
        { status: 400 }
      );
    }

    const message =
      err instanceof Error ? err.message : `Failed to connect ${providerLabel}`;
    console.error(`[${provider}-connect]`, message);

    // Rate-limiting
    if (message.includes("429") || message.includes("too many")) {
      return NextResponse.json(
        {
          error:
            "Too many login attempts. Please wait a few minutes and try again.",
        },
        { status: 429 }
      );
    }

    // Credential errors — each provider reports different error patterns
    if (provider === "garmin") {
      if (message.includes("401") || message.includes("credentials")) {
        return NextResponse.json(
          {
            error:
              "Invalid email or password. Please check your Garmin Connect credentials.",
          },
          { status: 401 }
        );
      }
    } else {
      if (
        message.includes("1030") ||
        message.includes("LoginError") ||
        message.includes("credentials")
      ) {
        return NextResponse.json(
          {
            error:
              "Invalid email or password. Please check your COROS Training Hub credentials.",
          },
          { status: 401 }
        );
      }
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handleDisconnect(
  provider: Provider,
  _req: Request,
  userId: string
): Promise<NextResponse> {
  try {
    if (provider === "garmin") {
      await disconnectGarmin(userId);
    } else {
      await disconnectCoros(userId);
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    const providerLabel = provider === "garmin" ? "Garmin" : "COROS";
    const message =
      err instanceof Error
        ? err.message
        : `Failed to disconnect ${providerLabel}`;
    console.error(`[${provider}-disconnect]`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handleResetSync(
  provider: Provider,
  _req: Request,
  userId: string
): Promise<NextResponse> {
  try {
    if (provider === "garmin") {
      await prisma.garminSession.update({
        where: { userId },
        data: {
          lastSyncAt: null,
          lastHealthSyncAt: null,
        },
      });
    } else {
      await prisma.corosSession.update({
        where: { userId },
        data: {
          lastSyncAt: null,
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to reset sync state";
    console.error(`[${provider}-reset-sync]`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handleStatus(
  provider: Provider,
  _req: Request,
  userId: string
): Promise<NextResponse> {
  if (provider === "garmin") {
    const garminSession = await prisma.garminSession.findUnique({
      where: { userId },
      select: {
        displayName: true,
        lastSyncAt: true,
        lastHealthSyncAt: true,
        connectedAt: true,
      },
    });

    const garminActivityCount = await prisma.trainingLog.count({
      where: { userId, source: "garmin" },
    });

    return NextResponse.json({
      connected: !!garminSession,
      displayName: garminSession?.displayName ?? null,
      lastSyncAt: garminSession?.lastSyncAt?.toISOString() ?? null,
      lastHealthSyncAt:
        garminSession?.lastHealthSyncAt?.toISOString() ?? null,
      connectedAt: garminSession?.connectedAt?.toISOString() ?? null,
      garminActivityCount,
    });
  }

  // COROS status
  const corosSession = await prisma.corosSession.findUnique({
    where: { userId },
    select: {
      displayName: true,
      lastSyncAt: true,
      connectedAt: true,
      corosUserId: true,
    },
  });

  const corosActivityCount = await prisma.trainingLog.count({
    where: { userId, source: "coros" },
  });

  return NextResponse.json({
    connected: !!corosSession,
    displayName: corosSession?.displayName ?? null,
    corosUserId: corosSession?.corosUserId ?? null,
    lastSyncAt: corosSession?.lastSyncAt?.toISOString() ?? null,
    connectedAt: corosSession?.connectedAt?.toISOString() ?? null,
    corosActivityCount,
  });
}

async function handleSync(
  provider: Provider,
  req: Request,
  userId: string
): Promise<NextResponse> {
  try {
    const { fromDate, toDate, tzOffset: rawTz } = await req.json().catch(() => ({}));
    const tzOffset = parseInt(String(rawTz || "0"), 10);

    if (provider === "garmin") {
      const client = await getGarminClient(userId);
      if (!client) {
        return NextResponse.json(
          {
            error:
              "Garmin not connected. Connect your Garmin account in Settings first.",
          },
          { status: 400 }
        );
      }

      const [activitiesResult, healthDaysSynced] = await Promise.all([
        syncGarminActivities(
          client,
          userId,
          true,
          undefined,
          fromDate,
          toDate,
          tzOffset
        ),
        syncGarminHealthData(client, userId),
      ]);

      const { count: activitiesImported, newActivityIds } = activitiesResult;

      if (newActivityIds.length > 0) {
        scheduleBatchAnalysis(
          newActivityIds,
          userId,
          activitiesImported
        ).catch(() => {});
      }

      return NextResponse.json({
        success: true,
        activitiesImported,
        healthDaysSynced,
      });
    }

    // COROS sync
    const client = await getCorosClient(userId);
    if (!client) {
      return NextResponse.json(
        {
          error:
            "COROS not connected. Connect your COROS Training Hub account in Settings first.",
        },
        { status: 400 }
      );
    }

    const { count: activitiesImported, newActivityIds } =
      await syncCorosActivities(client, userId, true, fromDate, toDate, tzOffset);

    if (newActivityIds.length > 0) {
      scheduleBatchAnalysis(
        newActivityIds,
        userId,
        activitiesImported
      ).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      activitiesImported,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Sync failed";
    console.error(`[${provider}-sync]`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Map action to its handler function and expected HTTP method
const ACTION_DISPATCH: Record<
  Action,
  {
    handler: (
      provider: Provider,
      req: Request,
      userId: string
    ) => Promise<NextResponse>;
    method: "GET" | "POST" | "DELETE";
  }
> = {
  connect: { handler: handleConnect, method: "POST" },
  disconnect: { handler: handleDisconnect, method: "DELETE" },
  "reset-sync": { handler: handleResetSync, method: "POST" },
  status: { handler: handleStatus, method: "GET" },
  sync: { handler: handleSync, method: "POST" },
};

// ─── Exported entry point ───────────────────────────────────────────

export async function handleIntegrationRoute(
  req: Request,
  provider: string,
  action: string
): Promise<NextResponse> {
  // Validate provider
  if (!isValidProvider(provider)) {
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
  }

  // Validate action
  if (!isValidAction(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  // Authenticate
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Validate HTTP method matches expected method for this action
  const dispatch = ACTION_DISPATCH[action];
  if (req.method !== dispatch.method) {
    return NextResponse.json(
      { error: `Method ${req.method} not allowed for action "${action}"` },
      { status: 405 }
    );
  }

  return dispatch.handler(provider, req, session.user.id);
}
