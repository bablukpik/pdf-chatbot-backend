import 'dotenv/config';
import { Worker } from 'bullmq';
import { OpenAIEmbeddings } from '@langchain/openai';
import { QdrantVectorStore } from '@langchain/qdrant';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import fs from 'fs/promises';

// Ensure required environment variables are set
if (
  !process.env.OPENAI_API_KEY ||
  !process.env.QDRANT_URL ||
  !process.env.QDRANT_COLLECTION_NAME
) {
  throw new Error(
    'Missing required environment variables for worker (OPENAI_API_KEY, QDRANT_URL, QDRANT_COLLECTION_NAME)',
  );
}

const concurrency = process.env.CONCURRENCY || 5;

const fileProcessingWorker = new Worker(
  'file-upload-queue',
  async (job) => {
    console.log(`Processing job ${job.id} for file: ${job.data.path}`);
    const { path: filePath, filename } = job.data;

    try {
      // Update progress: 10% - Starting
      await job.updateProgress(10);
      console.log(`[${job.id}] Starting processing for: ${filename}`);

      // 1. Load the PDF document from the specified path
      const loader = new PDFLoader(filePath);
      const loadedDocs = await loader.load();
      console.log(
        `[${job.id}] Loaded PDF: ${filename} (${loadedDocs.length} pages)`,
      );

      // Update progress: 30% - PDF loaded
      await job.updateProgress(30);

      // 2. Split the document into smaller chunks for better processing
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 150,
      });
      const chunks = await splitter.splitDocuments(loadedDocs);
      console.log(`[${job.id}] Split document into ${chunks.length} chunks`);

      // Update progress: 50% - Document split
      await job.updateProgress(50);

      // 3. Initialize OpenAI embeddings model
      const embeddings = new OpenAIEmbeddings({
        model: 'text-embedding-3-small',
        apiKey: process.env.OPENAI_API_KEY,
      });

      // 4. Get the vector store instance
      const vectorStore = new QdrantVectorStore(embeddings, {
        url: process.env.QDRANT_URL,
        collectionName: process.env.QDRANT_COLLECTION_NAME,
      });

      // Update progress: 70% - Starting vectorization
      await job.updateProgress(70);

      // 5. Add the document chunks to the vector store
      await vectorStore.addDocuments(chunks);
      console.log(
        `[${job.id}] Successfully added ${chunks.length} chunks to Qdrant for file: ${filename}`,
      );

      // Update progress: 100% - Complete
      await job.updateProgress(100);

      return {
        filename,
        chunksProcessed: chunks.length,
        pagesProcessed: loadedDocs.length,
        processedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error(
        `[${job.id}] Failed to process job for file ${filename}:`,
        error,
      );

      // Attempt to clean up file even on failure
      try {
        await fs.unlink(filePath);
        console.log(`[${job.id}] Cleaned up file after error: ${filePath}`);
      } catch (cleanupError) {
        console.warn(
          `[${job.id}] Failed to cleanup file after error ${filePath}:`,
          cleanupError,
        );
      }

      // Re-throw the error to let BullMQ know the job failed and should be retried or moved to failed queue
      throw error;
    }
  },
  {
    concurrency, // Set a reasonable concurrency level
    connection: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    },
  },
);

fileProcessingWorker.on('completed', (job) => {
  console.info(
    `Job ${job.id} completed successfully for file: ${job.data.filename}`,
  );
});

fileProcessingWorker.on('failed', (job, err) => {
  console.error(`Job ${job.id} failed for file: ${job.data.filename}`);
  console.error('Error:', err.message);
  console.error('Stack:', err.stack);
});

fileProcessingWorker.on('stalled', (jobId) => {
  console.warn(`Job ${jobId} stalled - may need manual intervention`);
});

fileProcessingWorker.on('progress', (job, progress) => {
  console.log(`Job ${job.id} Progress: ${progress}% - ${job.data.filename}`);
});

console.log('🚀 File processing worker started successfully');
