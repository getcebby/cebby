import React from "react";
import Head from "next/head";
import Logo from "../components/Logo";
import { app } from "@/config/app";

const TermsOfService: React.FC = () => {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-8">
        <Head>
          <title>Terms of Service - {app.title}</title>
          <meta name="description" content="Our terms of service" />
        </Head>

        <div className="mb-8 flex justify-center">
          <Logo />
        </div>

        <div className="bg-white dark:bg-gray-800 shadow-lg rounded-lg p-8">
          <h2 className="text-3xl font-bold mb-6 text-center">
            Terms of Service
          </h2>

          <section className="mb-6">
            <h2 className="text-2xl font-semibold mb-3">
              1. Acceptance of Terms
            </h2>
            <p>
              By accessing or using our service, you agree to be bound by these
              Terms of Service.
            </p>
          </section>

          <section className="mb-6">
            <h2 className="text-2xl font-semibold mb-3">2. Use of Service</h2>
            <p>
              You agree to use our service only for lawful purposes and in
              accordance with these Terms.
            </p>
          </section>

          <section className="mb-6">
            <h2 className="text-2xl font-semibold mb-3">3. User Accounts</h2>
            <p>
              You are responsible for maintaining the confidentiality of your
              account and password.
            </p>
          </section>

          <section className="mb-6">
            <h2 className="text-2xl font-semibold mb-3">
              4. Intellectual Property
            </h2>
            <p>
              The service and its original content, features, and functionality
              are owned by us and are protected by international copyright,
              trademark, patent, trade secret, and other intellectual property
              laws.
            </p>
          </section>

          <section className="mb-6">
            <h2 className="text-2xl font-semibold mb-3">5. Termination</h2>
            <p>
              We may terminate or suspend your account and bar access to the
              service immediately, without prior notice or liability, under our
              sole discretion, for any reason whatsoever.
            </p>
          </section>

          <section className="mb-6">
            <h2 className="text-2xl font-semibold mb-3">
              6. Limitation of Liability
            </h2>
            <p>
              In no event shall we be liable for any indirect, incidental,
              special, consequential or punitive damages, including without
              limitation, loss of profits, data, use, goodwill, or other
              intangible losses.
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

export default TermsOfService;
