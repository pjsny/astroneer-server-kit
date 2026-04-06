import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";

const ENDPOINT = "https://fsn1.your-objectstorage.com";
const BUCKET = "astro-server-tf-state";

export function makeS3Client(accessKey: string, secretKey: string) {
  return new S3Client({
    endpoint: ENDPOINT,
    region: "fsn1",
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    forcePathStyle: true,
  });
}

export async function ensureBucket(accessKey: string, secretKey: string) {
  const s3 = makeS3Client(accessKey, secretKey);

  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    return false; // already existed
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
    return true; // created
  }
}
