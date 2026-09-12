import { describe, expect, it } from "vitest";

import {
  apiErrorSchema,
  emailCodeRequestSchema,
  emailCodeVerifySchema,
  paymentInitializationSchema,
  productModerationSchema,
  publicConfigSchema,
  storeOrderSchema,
  tutorialListingSchema,
  tutorialResourceSchema,
  tutorialReviewSchema,
} from "./index";

describe("shared API contracts", () => {
  it("normalizes existing-account email-code requests", () => {
    expect(emailCodeRequestSchema.parse({ email: "  Student@Example.COM " })).toEqual({
      email: "student@example.com",
    });
    expect(emailCodeVerifySchema.parse({
      email: "student@example.com",
      code: "123456",
      deviceLabel: "KampusOne agent portal",
    }).code).toBe("123456");
    expect(() => emailCodeVerifySchema.parse({
      email: "student@example.com",
      code: "12345",
    })).toThrow();
  });

  it("accepts a deliberately gated public configuration", () => {
    const value = publicConfigSchema.parse({
      environment: "staging",
      maintenance: false,
      minimumAppVersion: "0.1.0",
      features: {
        academicCore: true,
        socialFeed: false,
        tutorials: true,
        store: false,
        logistics: false,
        marketplace: false,
        payments: false,
        aiAssistant: false,
      },
    });

    expect(value.features.academicCore).toBe(true);
    expect(value.features.payments).toBe(false);
  });

  it("rejects an unstable error shape", () => {
    expect(() =>
      apiErrorSchema.parse({ error: { code: "WHOOPS", message: "No" } }),
    ).toThrow();
  });

  it("accepts a free tutorial pilot listing", () => {
    const listing = tutorialListingSchema.parse({
      courseCode: "CSC101",
      title: "Python foundations lab",
      description: "Work through beginner Python examples with a small campus study group.",
      format: "HYBRID",
      priceKobo: 0,
      capacity: 16,
      locationText: "Computer laboratory / online",
      cancellationCutoffHours: 0,
    });

    expect(listing.priceKobo).toBe(0);
    expect(listing.cancellationCutoffHours).toBe(0);
  });

  it("validates learning-resource and verified-review boundaries", () => {
    expect(() => tutorialResourceSchema.parse({
      courseCode: "PHY101",
      title: "Motion in 18 minutes",
      description: "An audio revision companion for displacement, velocity and acceleration.",
      resourceType: "AUDIOBOOK",
      accessModel: "FREE",
      priceKobo: 0,
    })).toThrow();

    expect(() => tutorialResourceSchema.parse({
      courseCode: "MAT111",
      title: "Differentiation notes",
      description: "Worked examples for the free tutorial pilot.",
      resourceType: "PDF",
      accessModel: "FREE",
      priceKobo: 500,
      fileUrl: "https://files.example.com/mat111.pdf",
    })).toThrow();

    expect(() => tutorialResourceSchema.parse({
      courseCode: "MAT111",
      title: "Differentiation notes",
      description: "Worked examples for the free tutorial pilot.",
      resourceType: "PDF",
      accessModel: "FREE",
      priceKobo: 0,
      fileUrl: "http://files.example.com/mat111.pdf",
    })).toThrow();

    expect(tutorialReviewSchema.parse({
      bookingId: "00000000-0000-4000-8000-000000000001",
      rating: 5,
      body: "Clear examples and a useful revision pace.",
    }).rating).toBe(5);
  });

  it("requires payment idempotency before calling a provider", () => {
    expect(() => paymentInitializationSchema.parse({
      resourceType: "TUTORIAL_BOOKING",
      resourceId: "00000000-0000-4000-8000-000000000001",
    })).toThrow();
  });

  it("requires an immutable Phase 3 delivery snapshot", () => {
    const order = storeOrderSchema.parse({
      vendorProfileId: "00000000-0000-4000-8000-000000000001",
      deliveryZoneId: "00000000-0000-4000-8000-000000000002",
      recipientName: "Ada Student",
      recipientPhoneE164: "+2348031234567",
      deliveryLocation: "Hall 2 main entrance",
      deliveryLandmark: "Beside the porter lodge",
      items: [{ productId: "00000000-0000-4000-8000-000000000003", quantity: 2 }],
    });

    expect(order.recipientPhoneE164).toBe("+2348031234567");
    expect(() => storeOrderSchema.parse({
      ...order,
      recipientPhoneE164: "08031234567",
    })).toThrow();
    expect(() => storeOrderSchema.parse({
      ...order,
      deliveryLatitude: 6.335,
    })).toThrow();
  });

  it("requires a documented product moderation decision", () => {
    expect(productModerationSchema.parse({
      status: "PUBLISHED",
      note: "Approved for the low-risk pilot catalogue.",
    }).status).toBe("PUBLISHED");
    expect(() => productModerationSchema.parse({
      status: "PUBLISHED",
      note: "",
    })).toThrow();
  });
});
