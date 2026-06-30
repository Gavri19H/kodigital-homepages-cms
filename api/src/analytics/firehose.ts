/**
 * AWS Firehose client for the homepage user-interaction analytics pipeline
 * (Cloudflare Worker).
 *
 * Uses aws4fetch for AWS Signature v4 signing. Copied verbatim from the
 * reference firehose helper in the sibling demo worker so the PutRecordBatch
 * wire format stays identical across both pipelines.
 */

import { AwsClient } from 'aws4fetch';

interface FirehoseConfig {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  streamName: string;
}

interface FirehoseRecord {
  Data: string; // Base64 encoded
}

interface PutRecordBatchInput {
  DeliveryStreamName: string;
  Records: FirehoseRecord[];
}

interface PutRecordBatchResult {
  FailedPutCount: number;
  RequestResponses: Array<{
    RecordId?: string;
    ErrorCode?: string;
    ErrorMessage?: string;
  }>;
}

/**
 * Send records to AWS Firehose
 */
export async function sendToFirehose(
  config: FirehoseConfig,
  records: unknown[]
): Promise<{ success: boolean; failedCount: number; error?: string }> {
  if (!config.accessKeyId || !config.secretAccessKey) {
    console.log('[firehose] AWS credentials not configured, skipping');
    return { success: true, failedCount: 0 };
  }

  if (records.length === 0) {
    return { success: true, failedCount: 0 };
  }

  try {
    const aws = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: config.region,
      service: 'firehose',
    });

    // Convert records to Firehose format
    // Each record is a JSON string followed by newline, base64 encoded
    const firehoseRecords: FirehoseRecord[] = records.map((record) => ({
      Data: btoa(unescape(encodeURIComponent(JSON.stringify(record) + '\n'))),
    }));

    // Firehose limits to 500 records per batch
    const batches: FirehoseRecord[][] = [];
    for (let i = 0; i < firehoseRecords.length; i += 500) {
      batches.push(firehoseRecords.slice(i, i + 500));
    }

    let totalFailed = 0;

    for (const batch of batches) {
      const input: PutRecordBatchInput = {
        DeliveryStreamName: config.streamName,
        Records: batch,
      };

      const response = await aws.fetch(
        `https://firehose.${config.region}.amazonaws.com/`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-amz-json-1.1',
            'X-Amz-Target': 'Firehose_20150804.PutRecordBatch',
          },
          body: JSON.stringify(input),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[firehose] Error: ${response.status} ${errorText}`);
        return {
          success: false,
          failedCount: batch.length,
          error: `HTTP ${response.status}: ${errorText}`,
        };
      }

      const result: PutRecordBatchResult = await response.json();
      totalFailed += result.FailedPutCount;

      if (result.FailedPutCount > 0) {
        console.warn(`[firehose] ${result.FailedPutCount} records failed`);
        result.RequestResponses.forEach((r, i) => {
          if (r.ErrorCode) {
            console.warn(`[firehose] Record ${i}: ${r.ErrorCode} - ${r.ErrorMessage}`);
          }
        });
      }
    }

    console.log(`[firehose] Sent ${records.length} records, ${totalFailed} failed`);
    return { success: true, failedCount: totalFailed };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[firehose] Exception: ${message}`);
    return { success: false, failedCount: records.length, error: message };
  }
}
