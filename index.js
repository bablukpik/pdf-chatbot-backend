import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { Queue } from 'bullmq';
import { OpenAIEmbeddings, ChatOpenAI } from '@langchain/openai';
import { Milvus } from '@langchain/community/vectorstores/milvus';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import MilvusManager from './utils/milvus-manager.js';

const chatRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 requests per windowMs
  message: 'Too many chat requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const PORT = process.env.PORT || 8000;

// Ensure required environment variables are set
if (!process.env.OPENAI_API_KEY) {
  throw new Error('Missing OPENAI_API_KEY in .env file');
}

// Available models configuration
const AVAILABLE_MODELS = {
  'gpt-4o': {
    name: 'GPT-4o',
    provider: 'openai',
    cost: 'paid',
    description: 'Most capable model, its context window: 128,000',
  },
  'gpt-4o-mini': {
    name: 'GPT-4o-mini',
    provider: 'openai',
    cost: 'paid',
    description: 'Most capable model, its context window: 128,000',
  },
};

const DEFAULT_MODEL = 'gpt-4o-mini';

// Function to get ChatOpenAI model based on selection
function getChatModel(modelName = DEFAULT_MODEL) {
  return new ChatOpenAI({
    modelName: modelName,
    temperature: 0.7,
    maxTokens: 1000,
    streaming: true,
  });
}

const fileUploadQueue = new Queue('file-upload-queue', {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
});

// Configure upload directory via environment variable and ensure it exists
const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads/'; // e.g: UPLOAD_DIR="/var/data/pdf-chat/uploads"
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  },
});

const upload = multer({ storage: storage });

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => {
  return res.status(404).json({ message: 'Not Found' });
});

app.post('/upload/pdf', upload.single('pdf'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }

  try {
    const job = await fileUploadQueue.add('process-file', {
      filename: req.file.originalname,
      destination: req.file.destination,
      path: req.file.path,
    });

    return res.json({
      message: 'uploaded',
      jobId: job.id,
      status: 'queued',
    });
  } catch (error) {
    console.error('Failed to queue PDF processing job:', error);
    return res.status(500).json({
      error: 'Failed to queue processing job',
    });
  }
});

// Update the chat endpoint to accept model parameter
app.post('/chat', chatRateLimit, async (req, res) => {
  const { message, conversationHistory = [], model = DEFAULT_MODEL } = req.body;

  // Input validation
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({
      error: 'Message is required and must be a non-empty string',
    });
  }

  if (message.length > 4000) {
    return res.status(400).json({
      error: 'Message too long. Maximum 4000 characters allowed.',
    });
  }

  if (!Array.isArray(conversationHistory) || conversationHistory.length > 20) {
    return res.status(400).json({
      error: 'Invalid conversation history. Maximum 20 messages allowed.',
    });
  }

  // Validate model selection
  if (!AVAILABLE_MODELS[model]) {
    return res.status(400).json({
      error: 'Invalid model selection',
      availableModels: Object.keys(AVAILABLE_MODELS),
    });
  }

  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*'); // should control from env variable
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  try {
    // Sanitize user input
    const sanitizedMessage = message.trim().substring(0, 4000);

    // RAG Logic with error handling
    let retrievedDocs = [];
    try {
      const embeddings = new OpenAIEmbeddings({
        model: 'text-embedding-3-small',
        apiKey: process.env.OPENAI_API_KEY,
      });

      const vectorStore = await Milvus.fromExistingCollection(embeddings, {
        address: process.env.MILVUS_URL || 'localhost:19530',
        collectionName: process.env.MILVUS_COLLECTION_NAME,
      });

      // Vector retriever
      const retriever = vectorStore.asRetriever({
        k: 5, // Retrieve the top 5 most relevant document chunks
        searchType: 'similarity',
        searchKwargs: {
          scoreThreshold: 0.7, // At least 70% similar and filter out irrelevant chunks
        },
      });

      retrievedDocs = await retriever.invoke(sanitizedMessage);

      // Log retrieval success
      console.log(`Retrieved ${retrievedDocs.length} relevant documents`);
    } catch (ragError) {
      console.error('RAG retrieval error:', ragError);
      // Continue without RAG context rather than failing completely
      retrievedDocs = [];
    }

    // Build a more robust, context-aware system prompt
    let SYSTEM_PROMPT;
    if (retrievedDocs.length > 0) {
      const contextText = retrievedDocs
        .map((doc) => doc.pageContent)
        .join('\n\n');

      SYSTEM_PROMPT = `
        You are a helpful AI assistant. Use the following context from PDF documents to answer the user's question. 
        If the answer is not in the context, you may use your own knowledge, but prefer the context when possible.

        Context:
        ---
        ${contextText}
        ---

        Instructions:
        - If the context contains the answer, use it and cite the source if possible.
        - If the context does not contain the answer, answer from your own knowledge.
        - Be concise and helpful.
        - Format your answer in markdown.
      `;
    } else {
      SYSTEM_PROMPT = `
        You are a helpful AI assistant. There is no relevant context from PDF documents for this question.
        Please answer the user's question using your own knowledge.
        - Be concise and helpful.
        - Format your answer in markdown.
      `;
    }

    // Build conversation messages
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...conversationHistory.slice(-10), // Keep last 10 messages for context
      { role: 'user', content: sanitizedMessage },
    ];

    // Use ChatOpenAI for dynamic model selection
    const chatModel = getChatModel(model);
    const chatResult = await chatModel.stream(messages);

    let fullResponse = '';

    for await (const chunk of chatResult) {
      const content = chunk.content;
      if (content) {
        fullResponse += content;
        // Stream each chunk to client
        res.write(
          `data: ${JSON.stringify({
            type: 'stream',
            content,
          })}\n\n`,
        );
      }
    }

    // Send done event with metadata when complete to client
    res.write(
      `data: ${JSON.stringify({
        type: 'done',
        metadata: {
          model: model,
          documentsUsed: retrievedDocs.length,
          responseLength: fullResponse.length,
        },
      })}\n\n`,
    );

    // End of response with disconnection from client
    res.end();
  } catch (error) {
    console.error('Chat error:', error);
    res.write(
      `data: ${JSON.stringify({
        type: 'error',
        error:
          'An error occurred while processing your request. Please try again.',
      })}\n\n`,
    );
    res.end();
  }
});

// Add endpoint to get available models
app.get('/models', (req, res) => {
  res.json({
    models: AVAILABLE_MODELS,
    default: DEFAULT_MODEL,
  });
});

// Add endpoint to check job status
app.get('/upload/status/:jobId', async (req, res) => {
  try {
    const job = await fileUploadQueue.getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const state = await job.getState();
    res.json({
      id: job.id,
      status: state,
      progress: job.progress,
      filename: job.data.filename,
      result: job.returnvalue,
      error: job.failedReason,
      createdAt: new Date(job.timestamp),
      processedAt: job.processedOn ? new Date(job.processedOn) : null,
      finishedAt: job.finishedOn ? new Date(job.finishedOn) : null,
    });
  } catch (error) {
    console.error('Error getting job status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add endpoint to get queue statistics
app.get('/upload/queue/stats', async (req, res) => {
  try {
    const waiting = await fileUploadQueue.getWaiting();
    const active = await fileUploadQueue.getActive();
    const completed = await fileUploadQueue.getCompleted();
    const failed = await fileUploadQueue.getFailed();

    res.json({
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      total: waiting.length + active.length + completed.length + failed.length,
    });
  } catch (error) {
    console.error('Error getting queue stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add endpoint to list collections
app.get('/collections', async (req, res) => {
  try {
    const manager = new MilvusManager();
    const result = await manager.listCollections();
    await manager.close();

    if (result.success) {
      res.json({
        collections: result.collections,
        count: result.count,
        currentCollection: process.env.MILVUS_COLLECTION_NAME,
      });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error listing collections:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add endpoint to get collection statistics
app.get('/collections/:collectionName/stats', async (req, res) => {
  try {
    const { collectionName } = req.params;
    const manager = new MilvusManager();

    const result = await manager.getCollectionInfo(collectionName);
    await manager.close();

    if (result.success) {
      res.json({
        collectionName: result.collectionName,
        info: result.info,
        statistics: result.statistics,
        status: 'active',
      });
    } else {
      res.status(404).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error getting collection stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add endpoint to delete specific vectors by metadata
app.delete('/collections/:collectionName/vectors', async (req, res) => {
  try {
    const { collectionName } = req.params;
    const { filter } = req.body; // e.g., { filename: "example.pdf" }

    if (!filter) {
      return res.status(400).json({
        error:
          'Filter is required. Provide metadata filter to identify vectors to delete.',
        example: { filename: 'example.pdf' },
      });
    }

    const manager = new MilvusManager();
    const result = await manager.deleteVectorsByFilter(collectionName, filter);
    await manager.close();

    if (result.success) {
      res.json({
        message: 'Vectors deleted successfully',
        collectionName,
        filter,
        result: result.result,
      });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error deleting vectors:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add endpoint to delete entire collection
app.delete('/collections/:collectionName', async (req, res) => {
  try {
    const { collectionName } = req.params;
    const { confirm } = req.query;

    if (confirm !== 'true') {
      return res.status(400).json({
        error: 'Collection deletion requires confirmation',
        message: 'Add ?confirm=true to the URL to confirm deletion',
        warning:
          'This action will permanently delete the entire collection and all vectors',
      });
    }

    const manager = new MilvusManager();
    const result = await manager.dropCollection(collectionName, true);
    await manager.close();

    if (result.success) {
      res.json({
        message: 'Collection dropped successfully',
        collectionName,
      });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error deleting collection:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add endpoint to empty collection (delete all vectors but keep collection)
app.delete('/collections/:collectionName/vectors/all', async (req, res) => {
  try {
    const { collectionName } = req.params;
    const { confirm } = req.query;

    if (confirm !== 'true') {
      return res.status(400).json({
        error: 'Collection emptying requires confirmation',
        message: 'Add ?confirm=true to the URL to confirm emptying',
        warning: 'This action will delete all vectors in the collection',
      });
    }

    const manager = new MilvusManager();
    const result = await manager.emptyCollection(collectionName);
    await manager.close();

    if (result.success) {
      res.json({
        message: 'Collection emptied successfully',
        collectionName,
        result: result.result,
      });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error emptying collection:', error);
    res.status(500).json({ error: error.message });
  }
});

// Partition Management Endpoints

// Add endpoint to list partitions in a collection
app.get('/collections/:collectionName/partitions', async (req, res) => {
  try {
    const { collectionName } = req.params;
    const manager = new MilvusManager();
    const result = await manager.listPartitions(collectionName);
    await manager.close();

    if (result.success) {
      res.json({
        collectionName: result.collectionName,
        partitions: result.partitions,
        count: result.count,
      });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error listing partitions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add endpoint to get partition statistics
app.get(
  '/collections/:collectionName/partitions/:partitionName/stats',
  async (req, res) => {
    try {
      const { collectionName, partitionName } = req.params;
      const manager = new MilvusManager();
      const result = await manager.getPartitionStats(
        collectionName,
        partitionName,
      );
      await manager.close();

      if (result.success) {
        res.json({
          collectionName: result.collectionName,
          partitionName: result.partitionName,
          rowCount: result.rowCount,
          dataSize: result.dataSize,
        });
      } else {
        res.status(404).json({ error: result.error });
      }
    } catch (error) {
      console.error('Error getting partition stats:', error);
      res.status(500).json({ error: error.message });
    }
  },
);

// Add endpoint to create a new partition
app.post('/collections/:collectionName/partitions', async (req, res) => {
  try {
    const { collectionName } = req.params;
    const { partitionName, description = '' } = req.body;

    if (!partitionName) {
      return res.status(400).json({
        error: 'Partition name is required',
        example: {
          partitionName: 'new_partition',
          description: 'Optional description',
        },
      });
    }

    const manager = new MilvusManager();
    const result = await manager.createPartition(
      collectionName,
      partitionName,
      description,
    );
    await manager.close();

    if (result.success) {
      res.json({
        message: 'Partition created successfully',
        collectionName: result.collectionName,
        partitionName: result.partitionName,
        description: result.description,
      });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error creating partition:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add endpoint to empty a partition (delete all vectors but keep partition)
app.delete(
  '/collections/:collectionName/partitions/:partitionName/vectors',
  async (req, res) => {
    try {
      const { collectionName, partitionName } = req.params;
      const { confirm } = req.query;

      if (confirm !== 'true') {
        return res.status(400).json({
          error: 'Partition emptying requires confirmation',
          message: 'Add ?confirm=true to the URL to confirm emptying',
          warning: 'This action will delete all vectors in the partition',
        });
      }

      const manager = new MilvusManager();
      const result = await manager.emptyPartition(
        collectionName,
        partitionName,
      );
      await manager.close();

      if (result.success) {
        res.json({
          message: 'Partition emptied successfully',
          collectionName: result.collectionName,
          partitionName: result.partitionName,
          result: result.result,
        });
      } else {
        res.status(500).json({ error: result.error });
      }
    } catch (error) {
      console.error('Error emptying partition:', error);
      res.status(500).json({ error: error.message });
    }
  },
);

// Add endpoint to drop a partition
app.delete(
  '/collections/:collectionName/partitions/:partitionName',
  async (req, res) => {
    try {
      const { collectionName, partitionName } = req.params;
      const { confirm } = req.query;

      if (confirm !== 'true') {
        return res.status(400).json({
          error: 'Partition deletion requires confirmation',
          message: 'Add ?confirm=true to the URL to confirm deletion',
          warning:
            'This action will permanently delete the partition and all its vectors',
        });
      }

      const manager = new MilvusManager();
      const result = await manager.dropPartition(
        collectionName,
        partitionName,
        true,
      );
      await manager.close();

      if (result.success) {
        res.json({
          message: 'Partition dropped successfully',
          collectionName: result.collectionName,
          partitionName: result.partitionName,
        });
      } else {
        res.status(500).json({ error: result.error });
      }
    } catch (error) {
      console.error('Error dropping partition:', error);
      res.status(500).json({ error: error.message });
    }
  },
);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(PORT, () => console.log(`Server started on PORT:${PORT}`));
