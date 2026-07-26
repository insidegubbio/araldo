/**
 * Run this ONCE (or whenever your app's domain changes) to configure CORS
 * on the S3 bucket, so the browser can upload files directly to S3 using
 * presigned PUT URLs without hitting a CORS error.
 */
import { configureBucketCors } from "../server/s3";
import { ENV } from "../server/_core/env";

async function main() {
  if (!ENV.s3Bucket) {
    console.error("S3_BUCKET is not set. Aborting.");
    process.exit(1);
  }

  const origins = ENV.corsAllowedOrigins.length > 0 ? ENV.corsAllowedOrigins : ["*"];

  if (origins.includes("*")) {
    console.warn(
      "[configure-s3-cors] No CORS_ALLOWED_ORIGINS set - allowing uploads from ANY origin (*). " +
        "Set CORS_ALLOWED_ORIGINS to your real domain(s) before going to production."
    );
  }

  console.log(`[configure-s3-cors] Configuring bucket "${ENV.s3Bucket}" to allow origins:`, origins);

  await configureBucketCors(origins);

  console.log("[configure-s3-cors] Done. The bucket now accepts PUT/GET/HEAD from the origins above.");
}

main().catch((err) => {
  console.error("[configure-s3-cors] Failed:", err);
  console.error(
    "\nIf this failed with an access-denied error, your S3 credentials likely lack " +
      "the s3:PutBucketCORS permission, or your provider doesn't expose this API - " +
      "in that case configure CORS manually via the provider's dashboard with a rule like:\n" +
      JSON.stringify(
        [
          {
            AllowedOrigins: ["https://your-app-domain.com"],
            AllowedMethods: ["GET", "PUT", "HEAD"],
            AllowedHeaders: ["*"],
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 3000,
          },
        ],
        null,
        2
      )
  );
  process.exit(1);
});
