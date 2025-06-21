import 'dotenv/config';
import { Worker } from 'bullmq';
import { OpenAIEmbeddings } from '@langchain/openai';
import { QdrantVectorStore } from '@langchain/qdrant';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

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

const fileProcessingWorker = new Worker(
  'file-upload-queue',
  async (job) => {
    console.log(`Processing job ${job.id} for file: ${job.data.path}`);
    const { path: filePath } = job.data;

    try {
      // 1. Load the PDF document from the specified path
      const loader = new PDFLoader(filePath);
      const loadedDocs = await loader.load();
      console.log(`Loaded PDF: ${filePath}`);

      // 2. Split the document into smaller chunks for better processing
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200,
      });
      const chunks = await splitter.splitDocuments(loadedDocs);
      console.log(`Split document into ${chunks.length} chunks.`);

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

      // 5. Add the document chunks to the vector store
      await vectorStore.addDocuments(chunks);
      console.log(
        `Successfully added ${chunks.length} chunks to Qdrant for file: ${filePath}`,
      );
    } catch (error) {
      console.error(
        `Failed to process job ${job.id} for file ${filePath}:`,
        error,
      );
      // Re-throw the error to let BullMQ know the job failed and should be retried or moved to failed queue
      throw error;
    }
  },
  {
    concurrency: 5, // Set a reasonable concurrency level
    connection: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    },
  },
);

fileProcessingWorker.on('completed', (job) => {
  console.info(`Job ${job.id} has completed for file: ${job.data.path}`);
});

fileProcessingWorker.on('failed', (job, err) => {
  console.error(`Job ${job.id} has failed with ${err.message}`);
});

console.log('File processing worker started.');
