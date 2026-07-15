-- AlterEnum
ALTER TYPE "ActivitySource" ADD VALUE 'coros';

-- CreateTable
CREATE TABLE "coros_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "coros_user_id" TEXT,
    "display_name" TEXT,
    "last_sync_at" TIMESTAMP(3),
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coros_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "coros_sessions_user_id_key" ON "coros_sessions"("user_id");

-- AddForeignKey
ALTER TABLE "coros_sessions" ADD CONSTRAINT "coros_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
