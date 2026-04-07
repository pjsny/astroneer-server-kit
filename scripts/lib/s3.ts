import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";

export function makeS3Client(accessKey: string, secretKey: string, endpoint: string) {
  const hostname = new URL(endpoint).hostname;
  /**
   * DigitalOcean Spaces: first label is often the region slug (e.g. nyc3.digitaloceanspaces.com).
   *
   * Vultr Object Storage: host is like ewr1.vultrobjects.com — the AWS v3 client would set
   * CreateBucket LocationConstraint to "ewr1", which Vultr rejects (InvalidLocationConstraint).
   * The cluster is already implied by the endpoint URL; use us-east-1 so the SDK omits LocationConstraint
   * (@aws-sdk/middleware-location-constraint only adds it when region !== "us-east-1").
   */
  const isVultrObjects = hostname.endsWith(".vultrobjects.com");
  const region = isVultrObjects ? "us-east-1" : hostname.split(".")[0];
  return new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    forcePathStyle: true,
  });
}

export async function ensureBucket(
  accessKey: string,
  secretKey: string,
  endpoint: string,
  bucket: string,
) {
  const s3 = makeS3Client(accessKey, secretKey, endpoint);
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return false; // already existed
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    return true; // created
  }
}
