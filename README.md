# PDF Chatbot Backend

This is the Express.js backend for a scalable PDF chat RAG application. It uses LangChain for document processing and Qdrant for vector storage. The backend supports PDF upload, chunking, embedding, retrieval, and streaming chat responses.

**Frontend repo:** [pdf-chatbot-frontend](https://github.com/bablukpik/pdf-chatbot-frontend)

## Features

- Upload PDF files
- Chunk and embed documents using LangChain
- Store and retrieve embeddings with Qdrant
- Streaming chat responses (SSE)
- Queue-based processing with BullMQ

## Setup

1. **Install dependencies:**
   ```sh
   npm install
   ```
2. **Copy and configure environment variables:**
   ```sh
   cp .env.example .env
   # Edit .env and add your OpenAI API key and other settings
   ```
3. **Start Qdrant and Valkey (Redis alternative):**
   ```sh
   docker-compose up -d
   ```
4. **Start the backend server:**
   ```sh
   npm run dev
   ```
5. **Start the worker:**
   ```sh
   npm run dev:worker
   ```

## Environment Variables

See `.env.example` for all required variables:

- `OPENAI_API_KEY`: Your OpenAI API key
- `QDRANT_URL`: Qdrant instance URL (e.g., http://localhost:6333)
- `QDRANT_COLLECTION_NAME`: Name of the Qdrant collection
- `REDIS_HOST`: Redis/Valkey host
- `REDIS_PORT`: Redis/Valkey port

## API Endpoints

### `POST /upload/pdf`

Upload a PDF file. The file will be processed and added to the vector store asynchronously.

- **Body:** `multipart/form-data` with a `pdf` field
- **Response:** `{ message: 'uploaded' }`

### `POST /chat`

Chat with your PDF using streaming responses (SSE).

- **Body:** `{ messages: [{ role: 'user', content: 'your question' }, ...] }`
- **Response:** Server-Sent Events (SSE) streaming the AI's response and source documents

## Streaming Chat Usage

- The `/chat` endpoint streams responses using SSE. The frontend should consume the stream and display the response as it arrives.

## Worker

- The worker processes uploaded PDFs, splits them, creates embeddings, and stores them in Qdrant.
- Start the worker with `npm run dev:worker`.

## License

MIT
