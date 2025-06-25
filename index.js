import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { Queue } from 'bullmq';
import { OpenAIEmbeddings } from '@langchain/openai';
import { QdrantVectorStore } from '@langchain/qdrant';
import OpenAI from 'openai';
import rateLimit from 'express-rate-limit';

const chatRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 requests per windowMs
  message: 'Too many chat requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const PORT = process.env.PORT || 8000;
const CHAT_TIMEOUT_MS = process.env.CHAT_TIMEOUT_MS
  ? parseInt(process.env.CHAT_TIMEOUT_MS)
  : 60000;

// Ensure required environment variables are set
if (!process.env.OPENAI_API_KEY) {
  throw new Error('Missing OPENAI_API_KEY in .env file');
}

const openAIClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const fileUploadQueue = new Queue('file-upload-queue', {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
});

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
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
  await fileUploadQueue.add('process-file', {
    filename: req.file.originalname,
    destination: req.file.destination,
    path: req.file.path,
  });
  return res.json({ message: 'uploaded' });
});

// Old version of chat endpoint
app.get('/chat', chatRateLimit, async (req, res) => {
  const userQuery = req.query.message;

  if (!userQuery || typeof userQuery !== 'string') {
    return res.status(400).json({ message: 'Missing message in query params' });
  }

  // Set headers for SSE or streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  let clientDisconnected = false;

  req.on('close', () => {
    console.log('Client disconnected');
    clientDisconnected = true;
  });

  try {
    const embeddings = new OpenAIEmbeddings({
      model: 'text-embedding-3-small',
      apiKey: process.env.OPENAI_API_KEY,
    });

    const vectorStore = await QdrantVectorStore.fromExistingCollection(
      embeddings,
      {
        url: process.env.QDRANT_URL,
        collectionName: process.env.QDRANT_COLLECTION_NAME,
      },
    );

    const retriever = vectorStore.asRetriever({ k: 2 });
    const retrievedDocs = await retriever.invoke(userQuery);

    // Send retrieved documents (optional)
    // res.write(
    //   `data: ${JSON.stringify({ type: 'docs', documents: retrievedDocs })}\n\n`,
    // );

    const SYSTEM_PROMPT = `
    You are a helpful AI Assistant who answers the user query based on the available context from PDF File.
    Context:
    ${JSON.stringify(retrievedDocs)}
    `;

    const chatResult = await openAIClient.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userQuery },
      ],
      stream: true,
    });

    // Send llm response at once without streaming
    // return res.json({
    //   message: chatResult.choices[0].message.content,
    //   docs: retrievedDocs,
    // });

    // Send llm response chunk by chunk
    for await (const chunk of chatResult) {
      if (clientDisconnected) break;

      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        res.write(`data: ${JSON.stringify({ type: 'stream', content })}\n\n`);
      }
    }

    if (!clientDisconnected) {
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    }
  } catch (error) {
    console.error('Chat error:', error);
    if (!clientDisconnected) {
      res.write(
        `data: ${JSON.stringify({
          type: 'error',
          error: error.message || 'Unknown error',
        })}\n\n`,
      );
      res.end();
    }
  }
});

// New version of chat endpoint
app.post('/chat', chatRateLimit, async (req, res) => {
  const { message, conversationHistory = [] } = req.body;

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

  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*'); // should control from env variable
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  let clientDisconnected = false;
  const cleanup = () => {
    clientDisconnected = true;
  };

  req.on('close', cleanup);
  req.on('aborted', cleanup);

  // Add timeout if it takes so long to complete the answer to prevent hanging connections if something goes wrong
  const timeout = setTimeout(() => {
    if (!clientDisconnected) {
      console.log('Request timeout');
      res.write(
        `data: ${JSON.stringify({
          type: 'error',
          error: 'Request timeout',
        })}\n\n`,
      );
      res.end();
    }
  }, CHAT_TIMEOUT_MS);

  try {
    // Sanitize user input
    const sanitizedMessage = message.trim().substring(0, 4000);

    console.log(`Processing query: ${sanitizedMessage.substring(0, 30)}...`);

    // RAG Logic with error handling
    let retrievedDocs = [];
    try {
      const embeddings = new OpenAIEmbeddings({
        model: 'text-embedding-3-small',
        apiKey: process.env.OPENAI_API_KEY,
      });

      const vectorStore = await QdrantVectorStore.fromExistingCollection(
        embeddings,
        {
          url: process.env.QDRANT_URL,
          collectionName: process.env.QDRANT_COLLECTION_NAME,
        },
      );

      const retriever = vectorStore.asRetriever({
        k: 3, // Increased for better context
        searchType: 'similarity',
        searchKwargs: {
          scoreThreshold: 0.7, // Only include relevant results
        },
      });

      // Retrieve relevant documents from the Vector DB by user query
      retrievedDocs = await retriever.invoke(sanitizedMessage);

      // Log retrieval success
      console.log(`Retrieved ${retrievedDocs.length} relevant documents`);
    } catch (ragError) {
      console.error('RAG retrieval error:', ragError);
      // Continue without RAG context rather than failing completely
      retrievedDocs = [];
    }

    // Build context-aware system prompt
    const contextText =
      retrievedDocs.length > 0
        ? `Answer the user query based on the following context from PDF documents:\n${retrievedDocs
            .map((doc) => doc.pageContent)
            .join('\n\n')}`
        : 'No specific context available from PDF documents.';

    const SYSTEM_PROMPT = `You are a helpful AI Assistant. ${contextText}

    Instructions:
    - If the context doesn't contain relevant information, clearly state that
    - Be concise and helpful
    `;

    // Build conversation messages
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...conversationHistory.slice(-10), // Keep last 10 messages for context
      { role: 'user', content: sanitizedMessage },
    ];

    // Send documents info (optional)
    if (retrievedDocs.length > 0) {
      res.write(
        `data: ${JSON.stringify({
          type: 'docs',
          documents: retrievedDocs,
        })}\n\n`,
      );
    }

    const chatResult = await openAIClient.chat.completions.create({
      model: 'gpt-4o',
      messages,
      stream: true,
      max_completion_tokens: 1000,
      temperature: 0.7,
    });

    let fullResponse = '';

    for await (const chunk of chatResult) {
      if (clientDisconnected) break;

      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullResponse += content;
        res.write(
          `data: ${JSON.stringify({
            type: 'stream',
            content,
          })}\n\n`,
        );
      }
    }

    if (!clientDisconnected) {
      // Send completion with metadata
      res.write(
        `data: ${JSON.stringify({
          type: 'done',
          metadata: {
            documentsUsed: retrievedDocs.length,
            responseLength: fullResponse.length,
          },
        })}\n\n`,
      );
      res.end();
    }
  } catch (error) {
    console.error('Chat error:', error);
    if (!clientDisconnected) {
      res.write(
        `data: ${JSON.stringify({
          type: 'error',
          error:
            'An error occurred while processing your request. Please try again.',
        })}\n\n`,
      );
      res.end();
    }
  } finally {
    clearTimeout(timeout);
  }
});

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
