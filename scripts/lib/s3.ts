import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";

export function makeS3Client(accessKey: string, secretKey: string, endpoint: string) {
  // Extract region from endpoint hostname (e.g. "nyc3" from "nyc3.digitaloceanspaces.com")
  const region = new URL(endpoint).hostname.split(".")[0];
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
