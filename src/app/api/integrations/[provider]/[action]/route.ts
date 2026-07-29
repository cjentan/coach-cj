import { NextRequest } from "next/server";
import { handleIntegrationRoute } from "@/lib/integration-routes";

export async function GET(
  req: NextRequest,
  { params }: { params: { provider: string; action: string } }
) {
  return handleIntegrationRoute(req, params.provider, params.action);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { provider: string; action: string } }
) {
  return handleIntegrationRoute(req, params.provider, params.action);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { provider: string; action: string } }
) {
  return handleIntegrationRoute(req, params.provider, params.action);
}
