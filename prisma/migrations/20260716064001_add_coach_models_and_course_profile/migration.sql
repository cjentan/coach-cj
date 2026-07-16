-- AlterTable
ALTER TABLE "race_goals" ADD COLUMN     "course_profile" JSONB;

-- CreateTable
CREATE TABLE "coach_conversations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "context_snapshot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coach_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "suggestion_id" TEXT,
    "token_count" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coach_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_suggestions" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "suggestion_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_at" TIMESTAMP(3),

    CONSTRAINT "coach_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coach_conversations_user_id_updated_at_idx" ON "coach_conversations"("user_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "coach_messages_conversation_id_created_at_idx" ON "coach_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "coach_suggestions_conversation_id_idx" ON "coach_suggestions"("conversation_id");

-- CreateIndex
CREATE INDEX "coach_suggestions_user_id_status_idx" ON "coach_suggestions"("user_id", "status");

-- AddForeignKey
ALTER TABLE "coach_conversations" ADD CONSTRAINT "coach_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_messages" ADD CONSTRAINT "coach_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "coach_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_suggestions" ADD CONSTRAINT "coach_suggestions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "coach_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_suggestions" ADD CONSTRAINT "coach_suggestions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
