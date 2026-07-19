ALTER TABLE "Booking"
ADD COLUMN "checkoutSessionId" TEXT,
ADD COLUMN "checkoutSessionExpiresAt" TIMESTAMPTZ(3);
