import Stripe from "stripe";
import { getServerEnv } from "./env";

let stripe: Stripe | null = null;

export function getStripe() {
  if (!stripe) {
    stripe = new Stripe(getServerEnv("STRIPE_SECRET_KEY"));
  }

  return stripe;
}
