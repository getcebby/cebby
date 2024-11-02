import React from "react";
import Head from "next/head";
import Logo from "../components/Logo";
import { app } from "@/config/app";

const PrivacyPolicy: React.FC = () => {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-8">
        <Head>
          <title>Privacy Policy - {app.title}</title>
          <meta name="description" content="Our privacy policy" />
        </Head>

        <div className="mb-8 flex justify-center">
          <Logo />
        </div>

        <div className="bg-white dark:bg-gray-800 shadow-lg rounded-lg p-8">
          <h2 className="text-3xl font-bold mb-6 text-center">
            Privacy Policy
          </h2>

          <section className="mb-6">
            <h2 className="text-2xl font-semibold mb-3">
              1. Information We Collect
            </h2>
            <p>
              We collect information you provide directly to us, such as when
              you create an account, use our services, or communicate with us.
            </p>
          </section>

          <section className="mb-6">
            <h2 className="text-2xl font-semibold mb-3">
              2. How We Use Your Information
            </h2>
            <p>
              We use the information we collect to provide, maintain, and
              improve our services, to communicate with you, and to comply with
              legal obligations.
            </p>
          </section>

          <section className="mb-6">
            <h2 className="text-2xl font-semibold mb-3">
              3. Sharing of Information
            </h2>
            <p>
              We do not share your personal information with third parties
              except as described in this policy or with your consent.
            </p>
          </section>

          <section className="mb-6">
            <h2 className="text-2xl font-semibold mb-3">4. Data Security</h2>
            <p>
              We take reasonable measures to help protect your personal
              information from loss, theft, misuse, and unauthorized access.
            </p>
          </section>

          <section className="mb-6">
            <h2 className="text-2xl font-semibold mb-3">5. Your Rights</h2>
            <p>
              You have the right to access, correct, or delete your personal
              information. Please contact us if you wish to exercise these
              rights.
            </p>
          </section>

          <p className="mt-8 text-sm text-gray-600 dark:text-gray-400 text-center">
            Last updated: {new Date().toLocaleDateString()}
          </p>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
