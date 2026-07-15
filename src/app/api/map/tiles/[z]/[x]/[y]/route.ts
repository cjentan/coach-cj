import { NextResponse } from "next/server";
import { createCanvas } from "canvas";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { tileToBounds, latLngToTilePixel } from "@/lib/tile-math";

export const dynamic = "force-dynamic";

const HEAT_COLOR = "#ff3b00";
const TILE_SIZE = 256;

function drawRoute(
  ctx: any,
  coords: [number, number][],
  z: number,
  tileX: number,
  tileY: number,
) {
  if (coords.length < 3) return;

  ctx.beginPath();
  let started = false;

  for (let i = 0; i < coords.length; i++) {
    const [lat, lng] = coords[i];
    const { px, py } = latLngToTilePixel(lat, lng, z, tileX, tileY);

    if (px < -10 || px > TILE_SIZE + 10 || py < -10 || py > TILE_SIZE + 10) {
      started = false;
      continue;
    }

    if (!started) {
      ctx.moveTo(px, py);
      started = true;
    } else {
      ctx.lineTo(px, py);
    }
  }

  if (!started) return;
  ctx.stroke();
}

export async function GET(
  req: Request,
  { params }: { params: { z: string; x: string; y: string } },
) {
  const session = await auth();
  if (!session?.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const z = parseInt(params.z, 10);
  const x = parseInt(params.x, 10);
  const y = parseInt(params.y, 10);

  if (isNaN(z) || isNaN(x) || isNaN(y) || z < 1 || z > 19) {
    return new NextResponse("Invalid tile coordinates", { status: 400 });
  }

  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  // Only include activities with pre-built simplified trackpoints
  const where: Record<string, unknown> = {
    userId: session.user.id,
    mergedIntoId: null,
    simplifiedTrackPoints: { not: Prisma.DbNull },
  };
  if (type && type !== "all") where.type = type;
  if (from) where.startDate = { ...(where.startDate as object || {}), gte: new Date(from) };
  if (to) where.startDate = { ...(where.startDate as object || {}), lte: new Date(to) };

  const logs = await prisma.trainingLog.findMany({
    where,
    select: { simplifiedTrackPoints: true },
  });

  const canvas = createCanvas(TILE_SIZE, TILE_SIZE);
  const ctx = canvas.getContext("2d") as any;

  for (const log of logs) {
    const coords = log.simplifiedTrackPoints as [number, number][] | null;
    if (!Array.isArray(coords) || coords.length < 3) continue;

    ctx.beginPath();
    ctx.strokeStyle = HEAT_COLOR;
    ctx.globalAlpha = 0.12;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    drawRoute(ctx, coords, z, x, y);

    ctx.beginPath();
    ctx.globalAlpha = 0.06;
    ctx.lineWidth = 2;
    drawRoute(ctx, coords, z, x, y);
  }

  const buffer = canvas.toBuffer("image/png");
  const uint8 = new Uint8Array(buffer);

  return new NextResponse(uint8, {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": buffer.length.toString(),
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
