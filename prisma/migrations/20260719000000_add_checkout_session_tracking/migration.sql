ALTER TABLE "Booking"
ADD COLUMN "checkoutSessionId" TEXT,
ADD COLUMN "checkoutSessionExpiresAt" TIMESTAMP(3);
