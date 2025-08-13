import { QueueMessage } from './types.ts';
import { supabasePgmqSchemaClient } from './client.ts';

// Types for queue operations based on official Supabase Queue API
export interface QueueSendResponse {
    data: number | null; // message_id
    error: unknown;
}

export interface QueueReadResponse<T> {
    data: QueueMessage<T>[] | null;
    error: unknown;
}

export interface QueueDeleteResponse {
    data: boolean | null;
    error: unknown;
}

// Queue processing utilities
export async function handleMaxRetries<T>(
    queueName: string,
    queueData: QueueMessage<T>,
    onMaxRetries?: () => Promise<void>,
) {
    if (queueData.read_ct > 3) {
        console.log('[INFO] Max retries reached. Marking as failed.');
        await deleteQueueMessage(queueName, queueData.msg_id);
        if (onMaxRetries) {
            await onMaxRetries();
        }
        throw new Error('Max retries reached. Marking as failed.');
    }
}

/**
 * Reads up to "n" Messages from the specified Queue with an optional "sleep_seconds" (visibility timeout).
 * Based on pgmq_public.read(queue_name, sleep_seconds, n)
 */
export async function readFromQueue<T>(
    queueName: string,
    sleepSeconds: number = 120,
    n: number = 1,
): Promise<QueueReadResponse<T>> {
    try {
        const response = await supabasePgmqSchemaClient.rpc('read', {
            queue_name: queueName,
            sleep_seconds: sleepSeconds,
            n,
        });

        console.log(
            `[INFO] Read ${response.data?.length || 0} messages from queue: ${queueName}`,
        );
        return response;
    } catch (error) {
        console.error(`[ERROR] Failed to read from queue ${queueName}:`, error);
        return { data: null, error };
    }
}

/**
 * Retrieves the next available message and deletes it from the specified Queue.
 * Based on pgmq_public.pop(queue_name)
 */
export async function popFromQueue<T>(
    queueName: string,
): Promise<QueueReadResponse<T>> {
    try {
        const response = await supabasePgmqSchemaClient.rpc('pop', {
            queue_name: queueName,
        });

        console.log(`[INFO] Popped message from queue: ${queueName}`);
        return response;
    } catch (error) {
        console.error(`[ERROR] Failed to pop from queue ${queueName}:`, error);
        return { data: null, error };
    }
}

/**
 * Adds a Message to the specified Queue, optionally delaying its visibility to all consumers by a number of seconds.
 * Based on pgmq_public.send(queue_name, message, sleep_seconds)
 */
export async function addToQueue<T>(
    queueName: string,
    message: T,
    sleepSeconds = 0,
): Promise<QueueSendResponse> {
    try {
        // Ensure queue exists before adding message
        await ensureQueueExists(queueName);

        const response = await supabasePgmqSchemaClient.rpc('send', {
            queue_name: queueName,
            message,
            sleep_seconds: sleepSeconds,
        });

        console.log(
            `[INFO] Added message to queue: ${queueName}, message_id: ${response.data}`,
        );
        return response;
    } catch (error) {
        console.error(
            `[ERROR] Failed to add message to queue ${queueName}:`,
            error,
        );
        return { data: null, error };
    }
}

/**
 * Adds a batch of Messages to the specified Queue, optionally delaying their availability to all consumers by a number of seconds.
 * Based on pgmq_public.send_batch(queue_name, messages, sleep_seconds)
 */
export async function addBatchToQueue<T>(
    queueName: string,
    messages: T[],
    sleepSeconds = 0,
): Promise<QueueSendResponse> {
    try {
        // Ensure queue exists before adding messages
        await ensureQueueExists(queueName);

        const response = await supabasePgmqSchemaClient.rpc('send_batch', {
            queue_name: queueName,
            messages,
            sleep_seconds: sleepSeconds,
        });

        console.log(
            `[INFO] Added ${messages.length} messages to queue: ${queueName}`,
        );
        return response;
    } catch (error) {
        console.error(
            `[ERROR] Failed to add batch messages to queue ${queueName}:`,
            error,
        );
        return { data: null, error };
    }
}

/**
 * Archives a Message by moving it from the Queue table to the Queue's archive table.
 * Based on pgmq_public.archive(queue_name, message_id)
 */
export async function archiveQueueMessage(
    queueName: string,
    messageId: string | number,
): Promise<QueueDeleteResponse> {
    try {
        if (!messageId) {
            console.log('[INFO] No message ID provided. Skipping action: archival!');
            return { data: false, error: 'No message ID provided' };
        }

        console.log(
            `[INFO] Archiving message ${messageId} from queue ${queueName}`,
        );
        const response = await supabasePgmqSchemaClient.rpc('archive', {
            queue_name: queueName,
            message_id: messageId,
        });

        console.log(
            `[INFO] Successfully archived message ${messageId} from queue ${queueName}`,
        );
        return response;
    } catch (error) {
        console.error(
            `[ERROR] Failed to archive message ${messageId} from queue ${queueName}:`,
            error,
        );
        return { data: false, error };
    }
}

/**
 * Permanently deletes a Message from the specified Queue.
 * Based on pgmq_public.delete(queue_name, message_id)
 */
export async function deleteQueueMessage(
    queueName: string,
    messageId: string | number,
): Promise<QueueDeleteResponse> {
    try {
        if (!messageId) {
            console.log('[INFO] No message ID provided. Skipping action: deletion!');
            return { data: false, error: 'No message ID provided' };
        }

        console.log(`[INFO] Deleting message ${messageId} from queue ${queueName}`);
        const response = await supabasePgmqSchemaClient.rpc('delete', {
            queue_name: queueName,
            message_id: messageId,
        });

        console.log(
            `[INFO] Successfully deleted message ${messageId} from queue ${queueName}`,
        );
        return response;
    } catch (error) {
        console.error(
            `[ERROR] Failed to delete message ${messageId} from queue ${queueName}:`,
            error,
        );
        return { data: false, error };
    }
}

// Ensure queue exists (create if not)
// Note: This function uses create_queue which is not part of pgmq_public schema
// but is needed for queue management in our implementation
export async function ensureQueueExists(queueName: string) {
    try {
        await supabasePgmqSchemaClient.rpc('create_queue', {
            queue_name: queueName,
        });
        console.log(`[INFO] Queue ${queueName} exists or was created successfully`);
    } catch (error) {
        // Queue might already exist, which is fine
        console.log(`[INFO] Queue ${queueName} management result:`, error);
    }
}

// Utility functions for common queue operations

/**
 * Process messages from a queue with automatic retry handling
 */
export async function processQueueMessages<T = unknown>(
    queueName: string,
    processor: (message: T) => Promise<void>,
    maxMessages: number = 1,
    visibilityTimeout: number = 120,
): Promise<void> {
    try {
        const { data: messages, error } = await readFromQueue(
            queueName,
            visibilityTimeout,
            maxMessages,
        );

        if (error) {
            throw new Error(`Failed to read from queue: ${error}`);
        }

        if (!messages || messages.length === 0) {
            console.log(`[INFO] No messages available in queue: ${queueName}`);
            return;
        }

        for (const message of messages) {
            try {
                await processor(message.message);

                // Successfully processed, delete the message
                await deleteQueueMessage(queueName, message.msg_id);

                console.log(
                    `[INFO] Successfully processed message ${message.msg_id} from queue ${queueName}`,
                );
            } catch (processingError) {
                console.error(
                    `[ERROR] Failed to process message ${message.msg_id}:`,
                    processingError,
                );

                // Handle retry logic
                try {
                    await handleMaxRetries(queueName, message);
                } catch (_retryError) {
                    console.log(
                        `[INFO] Message ${message.msg_id} exceeded max retries and was cleaned up`,
                    );
                }
            }
        }
    } catch (error) {
        console.error(`[ERROR] Error processing queue ${queueName}:`, error);
        throw error;
    }
}
