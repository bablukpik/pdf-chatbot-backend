# PDF Chatbot Backend

This is the Express.js backend for a scalable PDF chat RAG application. It uses LangChain for document processing and Qdrant for vector storage. The backend supports PDF upload, chunking, embedding, retrieval, and streaming chat responses.

**Frontend repo:** [pdf-chatbot-frontend](https://github.com/bablukpik/pdf-chatbot-frontend)

## Features

- AI-powered chat with PDF documents
- Chunk and embed documents using LangChain
- Store and retrieve embeddings with Qdrant vector database
- Real-time streaming responses (SSE)
- Queue-based processing with BullMQ
- Rate limiting and input validation
- Conversation history support
- Request cancellation support

## Tech Stack

- Node.js with Express
- LangChain for RAG
- OpenAI API
- Qdrant Vector Database
- Rate limiting with express-rate-limit
- SSE
- BullMQ

## Security Features

- Rate limiting (50 requests per 15 minutes)
- Input validation and sanitization
- CORS protection
- Request timeout handling

## RAG Implementation

- Uses OpenAI embeddings for document retrieval
- Qdrant vector database for similarity search
- Context-aware responses with source citations

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

Chat with PDF documents using RAG.

**Request Body:**

```json
{
  "message": "Your question here",
  "conversationHistory": [
    {
      "role": "user",
      "content": "Previous message"
    }
  ]
}
```

**Response:** Server-Sent Events (SSE) stream with:

- `type: "docs"` - Retrieved documents
- `type: "stream"` - Streaming response content
- `type: "done"` - Completion signal
- `type: "error"` - Error information

## Streaming Chat Usage

- The `/chat` endpoint streams responses using SSE. The frontend should consume the stream and display the response as it arrives.

## Worker

- The worker processes uploaded PDFs, splits them, creates embeddings, and stores them in Qdrant.
- Start the worker with `npm run dev:worker`.

## Conversation History (Optional Advanced Feature)

By default, the LLM (like GPT-4, GPT-3.5, etc) does not remember previous chat messages. LLMs are stateless, they do not remember previous conversations unless you explicitly provide the chat history with each prompt. If you want the AI to have conversational memory, you must save and send the chat history with each request.

### Why Save Conversation History?

- To allow the LLM to answer in a context-aware, conversational way.
- To support multi-turn Q&A, follow-ups, and clarifications.

### How to Implement

1. **Save each message to your database** (e.g., MongoDB, PostgreSQL, etc.) with fields like `user_id`, `role` (`user` or `assistant`), `content`, and `timestamp`.
2. **When handling a chat request:**
   - Retrieve the conversation history for the user/session from the database (as an array of `{ role, content }` objects).
   - Append the latest user message if it is not already in the history.
   - Retrieve context from Qdrant as usual.
   - Build the `messages` array for the LLM as shown below.

### Example: Using Conversation History

```js
// Example: conversation history from DB
const conversationHistory = [
  { role: 'user', content: 'What is the document about?' },
  { role: 'assistant', content: 'It is a bio-data of John Doe.' },
];

// The latest user message (not yet in history)
const userQuery = 'What is his date of birth?';

const SYSTEM_PROMPT = `
You are a helpful AI Assistant who answers the user query based on the available context from PDF File.\nContext:\n${JSON.stringify(
  retrievedDocs,
)}
`;

const messages = [
  { role: 'system', content: SYSTEM_PROMPT },
  ...conversationHistory,
  { role: 'user', content: userQuery },
];

const chatResult = await openAIClient.chat.completions.create({
  model: 'gpt-4o',
  messages,
  stream: true,
});
```

- If your frontend already sends the full chat history (including the latest user message), you can use it directly.
- If you store chat history in a database, always retrieve and append the latest message before sending to the LLM.

**This approach enables the LLM to answer in a way that is aware of the ongoing conversation and the document context.**

### Roles in the Chat Message Array

When sending messages to the LLM, each message has a `role` field. Here's what each role means:

- **system**: Provides instructions or context to the LLM. Used to set behavior, rules, or inject context (such as retrieved PDF chunks). Usually appears only once at the start of the message array.
- **user**: Represents a message from the end user (the person chatting with the bot).
- **assistant**: Represents a message from the AI assistant (the LLM's previous responses).

**Example:**

```js
const messages = [
  { role: 'system', content: 'You are a helpful assistant. Context: ...' },
  { role: 'user', content: 'What is the document about?' },
  { role: 'assistant', content: 'It is a bio-data of John Doe.' },
  { role: 'user', content: 'What is his date of birth?' },
];
```

- The LLM will use the system prompt for instructions/context, and the rest to "remember" the conversation so far.

## Performance and Cost Considerations for Conversation History

Including conversation history in each LLM call improves conversational quality, but:

- **Increases response time:** The more history you send, the more tokens the LLM must process, which can slow down responses.
- **Increases cost:** Most LLM APIs (like OpenAI) charge per token. More history = more tokens = higher cost per request.
- **Token limits:** Each LLM has a maximum context window (e.g., 8k, 16k, or 128k tokens). If you exceed this, you must truncate or summarize history.

### Best Practices

1. **Limit the number of messages:**
   - Only send the most recent N messages (e.g., last 10–20 turns) to keep the prompt size reasonable.
   - Example:
     ```js
     // Keep only the last 10 messages
     const limitedHistory = conversationHistory.slice(-10);
     ```
2. **Summarize older history:**

   - For very long conversations, you can use the LLM itself to summarize earlier messages and include the summary in the system prompt.
   - Example:

     ```js
     // Select old messages (all but the last 10)
     const oldHistory = conversationHistory.slice(0, -10);
     // Build a summarization prompt
     const summarizationPrompt = `
     Summarize the following conversation between a user and an assistant in a concise way, preserving important facts and context for future questions.
     
     Conversation:
     ${oldHistory.map((m) => `${m.role}: ${m.content}`).join('\n')}
     `;
     // Call the LLM to get the summary
     const summaryResult = await openAIClient.chat.completions.create({
       model: 'gpt-4o',
       messages: [
         {
           role: 'system',
           content:
             'You are a helpful assistant that summarizes conversations.',
         },
         { role: 'user', content: summarizationPrompt },
       ],
     });
     const conversationSummary = summaryResult.choices[0].message.content;
     // Use the summary in your system prompt
     const SYSTEM_PROMPT = `
     You are a helpful AI assistant. Use the following information to answer the user's question.
     
     Conversation summary so far:
     ${conversationSummary}
     
     Relevant document context:
     ${documentContext}
     `;

     const messages = [
       { role: 'system', content: SYSTEM_PROMPT },
       ...oldHistory, // last 10 messages (optional)
       { role: 'user', content: userQuery },
     ];

     const chatResult = await openAIClient.chat.completions.create({
       model: 'gpt-4o',
       messages,
       stream: true,
     });
     ```

3. **Monitor token usage:**
   - Track the total number of tokens sent to the LLM to avoid hitting limits and to control latency/cost.

### Summary Table

| History Length       | Impact on Speed     | Impact on Cost |
| -------------------- | ------------------- | -------------- |
| Short (few turns)    | Negligible          | Low            |
| Medium (10–20)       | Slightly slower     | Moderate       |
| Long (many turns)    | Noticeably slower   | Higher         |
| Very long (hundreds) | May hit token limit | Expensive      |

**Recommendation:**

- For most use cases, include only the most recent 10–20 messages in each LLM call.
- Summarize or truncate older history to keep prompts efficient and costs manageable.

## What is Context Window, Token, and Token Limit?

- **Context window:** The maximum amount of text (prompt + chat history + context + answer) that an LLM can "see" and process in a single request. If you exceed this, the oldest content is truncated or the request fails.

Simply context window means LLM's input and output data/token processing capability or working memory.

- **Token:** A token is a chunk of text (roughly 3-4 characters or 0.75 words in English). LLMs process text in tokens, not characters or words. For example, "ChatGPT is great!" is 5 tokens.
- **Token limit:** Each LLM model has a maximum number of tokens it can process at once (context window size). For example:
  - GPT-3.5-turbo: 4,096 tokens
  - GPT-4o: 128,000 tokens
  - GPT-4-turbo: 128,000 tokens
  - Claude 3 Opus: 200,000 tokens

**If your prompt + chat history + context + expected answer exceeds the token limit, you must truncate or summarize.**

**Why it matters:**

- More tokens = higher cost and slower response
- Exceeding the limit means you lose earlier context or the request fails

**Tip:** Use tools like [OpenAI's tokenizer](https://platform.openai.com/tokenizer) to estimate token counts for your prompts.

## License

MIT

## Contact

If you'd like to discuss this project or collaborate:

- Email: bablukpik@gmail.com
- LinkedIn: https://www.linkedin.com/in/bablukpik/
