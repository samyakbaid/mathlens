// All the business settings in one place. Each one can be changed in .env.
// Getters read process.env every time, so values from .env are always picked up.

const number = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && process.env[name] !== '' ? value : fallback;
};

export const config = {
  // Free use
  /** AI answers someone can get without an account */
  get trialAnswers() { return number('TRIAL_ANSWERS', 2); },
  /** Extra free AI answers when someone signs up */
  get freeAnswersAfterSignup() { return number('FREE_ANSWERS_AFTER_SIGNUP', 3); },
  /** Anti-abuse: trial answers allowed per IP address per day (shared Wi-Fi gets a few people) */
  /** Follow-up questions inside a lesson that don't use a chat, per person per day */
  get freeQuestionsPerDay() { return number('FREE_QUESTIONS_PER_DAY', 10); },
  /** The same for everyone without an account on one network, so clearing cookies doesn't reset it */
  get freeQuestionsPerIpPerDay() { return number('FREE_QUESTIONS_PER_IP_PER_DAY', 30); },
  get trialPerIpPerDay() { return number('TRIAL_PER_IP_PER_DAY', 10); },
  /** Anti-abuse: new accounts per IP per day that get the free sign-up answers */
  get freeSignupsPerIpPerDay() { return number('FREE_SIGNUPS_PER_IP_PER_DAY', 3); },

  // Pricing (answers are billed at their real AI cost)
  /** Rupees per US dollar, used to convert the AI provider's price */
  get usdToInr() { return number('USD_TO_INR', 90); },
  /** Added on top of the AI cost to cover Razorpay's fee (about 2% + GST). 0.03 = 3% */
  get markup() { return number('PRICE_MARKUP', 0.03); },
  get minTopupRupees() { return number('MIN_TOPUP_RUPEES', 10); },
  get maxTopupRupees() { return number('MAX_TOPUP_RUPEES', 5000); },

  // Integrations (leave empty to turn the feature off)
  get googleClientId() { return process.env.GOOGLE_CLIENT_ID || ''; },
  get razorpayKeyId() { return process.env.RAZORPAY_KEY_ID || ''; },
  get razorpayKeySecret() { return process.env.RAZORPAY_KEY_SECRET || ''; },
  get razorpayWebhookSecret() { return process.env.RAZORPAY_WEBHOOK_SECRET || ''; },

  // Sending email (password reset links)
  get smtpHost() { return process.env.SMTP_HOST || ''; },
  get smtpPort() { return number('SMTP_PORT', 465); },
  get smtpUser() { return process.env.SMTP_USER || ''; },
  get smtpPass() { return process.env.SMTP_PASS || ''; },
  get mailFrom() { return process.env.MAIL_FROM || ''; },
  /** The site's real address, e.g. https://mathlens.in. Links in emails are built from this. */
  get publicUrl() { return process.env.PUBLIC_URL || ''; },

  // Business details shown on the policy pages, contact page and receipts (Razorpay checks these)
  get businessName() { return process.env.BUSINESS_NAME || ''; },
  get supportEmail() { return process.env.SUPPORT_EMAIL || ''; },
  get businessAddress() { return process.env.BUSINESS_ADDRESS || ''; },
  get businessPhone() { return process.env.BUSINESS_PHONE || ''; },
  get businessCity() { return process.env.BUSINESS_CITY || ''; },
  get businessGstin() { return process.env.BUSINESS_GSTIN || ''; },
  get policyUpdated() { return process.env.POLICY_UPDATED || '8 November 2026'; },

  /** Set COOKIE_SECURE=true when the site is served over HTTPS */
  get cookieSecure() { return process.env.COOKIE_SECURE === 'true'; },
};
